const randomId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
import {
  REALTIME_ROOM_EVENT_NAME_PATTERN,
  REALTIME_ROOM_MAX_PAYLOAD_BYTES,
} from "@cohub/protocol/realtime";
import type {
  RealtimeRoomDescriptor,
  RealtimeRoomEvent,
  RealtimeRoomMember,
  RealtimeRoomRequestEvent,
} from "@cohub/protocol/realtime";
import type { WorkRuntimeContext } from "../work-runtime.js";
import type { HttpTransport } from "../transport.js";
import type { WebsocketClient, WebsocketEventPayload } from "../websocket.js";

export type WorkRoomEventMap = object;

export type WorkRoomCreateInput = {
  code?: string;
  expiresInSeconds?: number;
  maxParticipants?: number;
  /**
   * Give each viewer at most one seat, so a second tab or a rejoin after an unclean
   * disconnect takes it over. Defaults to false: every connection is a participant.
   */
  seatPerUser?: boolean;
};

export type WorkRoomAdmissionResponse = {
  room: RealtimeRoomDescriptor;
  participantId: string;
  userKey: string;
  ticket: string;
};

export type WorkRoomState = "connecting" | "joined" | "reconnecting" | "expired" | "closed";

export type WorkRoomEvent<T = unknown> = {
  id: string;
  timestamp: number;
  roomId: string;
  sequence: number;
  type: string;
  data: T;
  clientEventId: string | null;
  sender: { participantId: string };
  self: boolean;
};

export type WorkRoomPublishResult = {
  eventId: string;
  sequence: number;
  clientEventId: string | null;
};

type PendingRequest = {
  expected: Set<string>;
  resolve: (event: WebsocketEventPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type EventHandler<T> = (event: WorkRoomEvent<T>) => void;
type StateHandler = (state: WorkRoomState) => void;
type MembersHandler = (members: RealtimeRoomMember[]) => void;

const textEncoder = new TextEncoder();
const byteLength = (text: string) => textEncoder.encode(text).byteLength;

/**
 * Ceiling on deltas held during a join, so a stalled handshake cannot buffer without
 * limit. Dropping the tail needs no extra signal: the gap detection below reports it.
 */
const WORK_ROOM_MAX_JOIN_BUFFER = 512;

/** Room events that mutate state, so they must not be applied before the join snapshot. */
const WORK_ROOM_DELTA_EVENTS = new Set([
  "realtime.room.event",
  "realtime.room.member.joined",
  "realtime.room.member.left",
  "realtime.room.presence.updated",
]);

const requestError = (event: WebsocketEventPayload) => {
  const payload = event.payload as { code?: unknown; message?: unknown };
  return new Error(
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.code === "string"
        ? payload.code
        : "room request failed",
  );
};

const isRoomEvent = (event: WebsocketEventPayload, roomId: string) => {
  if (event.domain !== "room") return false;
  const payload = event.payload as { roomId?: unknown };
  return payload.roomId === roomId || event.rooms?.includes(`room:${roomId}`);
};

export class WorkRoom<Events extends WorkRoomEventMap = WorkRoomEventMap> {
  readonly id: string;
  readonly code: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly maxParticipants: number;
  readonly seatPerUser: boolean;
  /** Opaque, stable identity of this viewer inside the room. */
  readonly userKey: string;
  private _participantId: string;

  private _state: WorkRoomState = "connecting";
  private _members: RealtimeRoomMember[] = [];
  private joinBuffer: WebsocketEventPayload[] | null = null;
  private lastSequence = 0;
  private hasJoined = false;
  private explicitLeave = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();
  private readonly allHandlers = new Set<EventHandler<unknown>>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly membersHandlers = new Set<MembersHandler>();
  private readonly outOfSyncHandlers = new Set<(expected: number, actual: number) => void>();
  private readonly sendErrorHandlers = new Set<(error: Error) => void>();
  private readonly offEvent: () => void;
  private readonly offOpen: () => void;
  private readonly offClose: () => void;
  private readonly offReconnecting: () => void;

  constructor(
    private readonly websocket: WebsocketClient,
    private readonly admission: WorkRoomAdmissionResponse,
  ) {
    this.id = admission.room.id;
    this.code = admission.room.code;
    this.createdAt = admission.room.createdAt;
    this.expiresAt = admission.room.expiresAt;
    this.maxParticipants = admission.room.maxParticipants;
    this.seatPerUser = admission.room.seatPerUser === true;
    this.userKey = admission.userKey;
    this._participantId = admission.participantId;

    this.offEvent = websocket.on("event", (event) => this.handleEvent(event));
    this.offOpen = websocket.on("open", () => {
      if (!this.hasJoined || this.explicitLeave || this._state === "expired" || this._state === "closed") return;
      void this.rejoin();
    });
    this.offReconnecting = websocket.on("reconnecting", () => {
      if (this.hasJoined && !this.explicitLeave) this.setState("reconnecting");
    });
    this.offClose = websocket.on("close", ({ willReconnect }) => {
      this.rejectPending(new Error("room connection closed"));
      if (this.explicitLeave || !willReconnect) {
        if (this._state !== "expired") this.setState("closed");
        // Nothing will reopen this room, so stop holding socket listeners and
        // the expiry timer, which can otherwise sit for the room's full 24h life.
        this.hasJoined = false;
        this.dispose();
      } else if (this.hasJoined) {
        this.setState("reconnecting");
      }
    });

    const delay = Math.max(0, Date.parse(this.expiresAt) - Date.now());
    this.expiryTimer = setTimeout(() => this.expire(), Math.min(delay, 2_147_000_000));
  }

  get state() {
    return this._state;
  }

  /**
   * Identity of this connection inside the room. A `seatPerUser` join can take over a
   * seat the viewer already holds, so this may differ from the id issued at admission.
   */
  get participantId() {
    return this._participantId;
  }

  get members() {
    return this._members.slice();
  }

  async connect() {
    await this.joinOverWebsocket(false);
    return this;
  }

  subscribe<K extends Extract<keyof Events, string>>(type: K, handler: EventHandler<Events[K]>) {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler as EventHandler<unknown>);
  }

  subscribeAll(handler: (event: WorkRoomEvent<unknown>) => void) {
    this.allHandlers.add(handler as EventHandler<unknown>);
    return () => this.allHandlers.delete(handler as EventHandler<unknown>);
  }

  onStateChange(handler: StateHandler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onMembersChanged(handler: MembersHandler) {
    this.membersHandlers.add(handler);
    return () => this.membersHandlers.delete(handler);
  }

  onOutOfSync(handler: (expected: number, actual: number) => void) {
    this.outOfSyncHandlers.add(handler);
    return () => this.outOfSyncHandlers.delete(handler);
  }

  /** Reports failures of {@link send}, which has no ack to reject. */
  onSendError(handler: (error: Error) => void) {
    this.sendErrorHandlers.add(handler);
    return () => this.sendErrorHandlers.delete(handler);
  }

  /**
   * Publishes without waiting for the server ack, for high-frequency traffic such as
   * input frames. Awaiting {@link publish} instead caps a loop at `1000 / rtt` events
   * per second. Ordering still holds, but failures surface through
   * {@link onSendError} rather than a rejected promise, and calls are ignored while
   * the room is not joined; watch {@link onStateChange} to know when it resumes.
   */
  send<K extends Extract<keyof Events, string>>(type: K, data: Events[K]) {
    if (this._state !== "joined" || !this.hasJoined) return;
    // Checked locally: the Gateway rejects a malformed frame before it knows which room
    // it came from, so the failure would be lost.
    const failure = this.validateSend(type, data);
    if (failure) {
      for (const handler of this.sendErrorHandlers) handler(failure);
      return;
    }
    void this.websocket
      .publishRealtimeRoom({ roomId: this.id, event: type, data })
      .catch((error) => {
        const reason = error instanceof Error ? error : new Error(String(error));
        for (const handler of this.sendErrorHandlers) handler(reason);
      });
  }

  private validateSend(type: string, data: unknown) {
    if (!REALTIME_ROOM_EVENT_NAME_PATTERN.test(type)) {
      return new Error(`invalid room event name: ${type}`);
    }
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(data);
    } catch {
      return new Error("room event data is not serializable");
    }
    // Encodes to nothing, so the data key would vanish from the frame and the server
    // would reject it. Covers undefined, functions, symbols and toJSON() => undefined.
    if (encoded === undefined) {
      return new Error("room event data is not serializable");
    }
    if (byteLength(encoded) > REALTIME_ROOM_MAX_PAYLOAD_BYTES) {
      return new Error("room event payload is too large");
    }
    return null;
  }

  async publish<K extends Extract<keyof Events, string>>(type: K, data: Events[K], options?: { clientEventId?: string }) {
    this.assertJoined();
    const failure = this.validateSend(type, data);
    if (failure) throw failure;
    const requestId = randomId();
    const response = await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
      this.websocket.publishRealtimeRoom({
        roomId: this.id,
        event: type,
        data,
        clientEventId: options?.clientEventId,
        requestId,
      }),
    );
    const payload = response.payload as RealtimeRoomRequestEvent["payload"];
    return {
      eventId: typeof payload.eventId === "string" ? payload.eventId : response.id,
      sequence: typeof payload.sequence === "number" ? payload.sequence : 0,
      clientEventId: typeof payload.clientEventId === "string" ? payload.clientEventId : null,
    } satisfies WorkRoomPublishResult;
  }

  async setPresence(presence: Record<string, unknown> | null) {
    this.assertJoined();
    const requestId = randomId();
    await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
      this.websocket.updateRealtimeRoomPresence({ roomId: this.id, presence, requestId }),
    );
  }

  async leave() {
    if (this.explicitLeave || this._state === "closed" || this._state === "expired") return;
    this.explicitLeave = true;
    try {
      if (this.hasJoined && this.websocket.state === "open") {
        const requestId = randomId();
        await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
          this.websocket.leaveRealtimeRoom({ roomId: this.id, requestId }),
        );
      }
    } finally {
      this.hasJoined = false;
      this.setState("closed");
      this.dispose();
    }
  }

  private async rejoin() {
    if (this.explicitLeave || this._state === "expired" || this._state === "closed") return;
    try {
      await this.joinOverWebsocket(true);
    } catch (error) {
      if (this.state === "expired") return;
      this.setState("closed");
      this.dispose();
      console.warn("[Cohub WorkRoom] failed to rejoin room", error);
    }
  }

  private async joinOverWebsocket(isReconnect: boolean) {
    if (!this.websocket.supportsCapability("realtime.room.v1") && this.websocket.state === "open") {
      throw new Error("Realtime rooms are not supported by the Gateway");
    }
    this.setState(isReconnect ? "reconnecting" : "connecting");
    const requestId = randomId();
    this.joinBuffer = [];
    try {
      const response = await this.request(requestId, new Set(["realtime.room.joined"]), () =>
        this.websocket.joinRealtimeRoom({ roomId: this.id, ticket: this.admission.ticket, requestId }),
      );
      const payload = response.payload as {
        participantId?: unknown;
        members?: unknown;
        sequence?: unknown;
      };
      if (typeof payload.participantId !== "string" || !Array.isArray(payload.members)) {
        throw new Error("invalid room join response");
      }
      // A seatPerUser room may hand back a seat this viewer already holds.
      this._participantId = payload.participantId;
      this._members = payload.members as RealtimeRoomMember[];
      this.lastSequence = typeof payload.sequence === "number" ? payload.sequence : 0;
    } catch (error) {
      this.joinBuffer = null;
      throw error;
    }
    this.hasJoined = true;
    this.setState("joined");
    this.notifyMembers();

    // Deltas held during the handshake. Pub/sub can deliver an event published before
    // the snapshot only after we subscribed, so anything at or below the snapshot
    // sequence is already reflected and is dropped rather than replayed.
    const buffered = this.joinBuffer ?? [];
    this.joinBuffer = null;
    for (const item of buffered) {
      const sequence = (item.payload as { sequence?: unknown }).sequence;
      if (typeof sequence === "number" && sequence <= this.lastSequence) continue;
      this.handleEvent(item);
    }
  }

  private request(requestId: string, expected: Set<string>, send: () => Promise<void>) {
    return new Promise<WebsocketEventPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("room request timed out"));
      }, 20_000);
      this.pending.set(requestId, { expected, resolve, reject, timer });
      void send().catch((error) => {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Detaches the entry awaiting this requestId, so the caller can settle it. */
  private takePending(requestId: string | null | undefined) {
    const pending = requestId ? this.pending.get(requestId) : undefined;
    if (!pending || !requestId) return null;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    return pending;
  }

  private handleEvent(event: WebsocketEventPayload) {
    if (!isRoomEvent(event, this.id)) {
      // Connection-level errors stay in the system domain. Without a requestId they
      // cannot be attributed, so they are left alone rather than blamed on this room.
      if (event.type === "system.request.error") {
        this.takePending(event.requestId)?.reject(requestError(event));
      }
      return;
    }

    if (event.type === "realtime.room.request.error") {
      const failure = requestError(event);
      if (event.requestId) {
        // Belongs to a request. With no pending entry it is late or another room's, so
        // it is not a send() failure either way.
        this.takePending(event.requestId)?.reject(failure);
        return;
      }
      // Only an unattributed error can be a fire-and-forget send().
      for (const handler of this.sendErrorHandlers) handler(failure);
      return;
    }

    const awaiting = event.requestId ? this.pending.get(event.requestId) : undefined;
    if (awaiting?.expected.has(event.type)) {
      this.takePending(event.requestId);
      awaiting.resolve(event);
    }

    // The server subscribes before it answers the join, so deltas can arrive first.
    // Applying them now would let the older snapshot overwrite them.
    if (this.joinBuffer && WORK_ROOM_DELTA_EVENTS.has(event.type)) {
      if (this.joinBuffer.length < WORK_ROOM_MAX_JOIN_BUFFER) this.joinBuffer.push(event);
      return;
    }

    const payload = event.payload as Record<string, unknown>;
    const sequence = typeof payload.sequence === "number" ? payload.sequence : null;
    if (sequence !== null) this.observeSequence(sequence);

    if (event.type === "realtime.room.member.joined" || event.type === "realtime.room.member.left" || event.type === "realtime.room.presence.updated") {
      const member = payload.member as RealtimeRoomMember | undefined;
      if (member?.participantId) {
        const members = new Map(this._members.map((item) => [item.participantId, item]));
        if (event.type === "realtime.room.member.left") members.delete(member.participantId);
        else members.set(member.participantId, member);
        this._members = [...members.values()];
        this.notifyMembers();
      }
      return;
    }

    if (event.type === "realtime.room.closed") {
      this.hasJoined = false;
      if (payload.reason === "expired") this.setState("expired");
      else this.setState("closed");
      // Listeners come off next, so nothing would be left to answer an in-flight request.
      this.rejectPending(new Error(`room closed: ${typeof payload.reason === "string" ? payload.reason : "unknown"}`));
      this.dispose();
      return;
    }

    if (event.type !== "realtime.room.event") return;
    const roomEvent = event as RealtimeRoomEvent;
    const roomPayload = roomEvent.payload;
    const item: WorkRoomEvent<unknown> = {
      id: roomEvent.id,
      timestamp: roomEvent.timestamp,
      roomId: roomPayload.roomId,
      sequence: roomPayload.sequence,
      type: roomPayload.event,
      data: roomPayload.data,
      clientEventId: roomPayload.clientEventId,
      sender: roomPayload.sender,
      self: roomPayload.sender.participantId === this.participantId,
    };
    this.handlers.get(item.type)?.forEach((handler) => {
      handler(item);
    });
    this.allHandlers.forEach((handler) => {
      handler(item);
    });
  }

  private observeSequence(sequence: number) {
    if (this.lastSequence > 0 && sequence > this.lastSequence + 1) {
      for (const handler of this.outOfSyncHandlers) handler(this.lastSequence + 1, sequence);
    }
    if (sequence > this.lastSequence) this.lastSequence = sequence;
  }

  private assertJoined() {
    if (this._state !== "joined" || !this.hasJoined) throw new Error("room is not joined");
  }

  private setState(state: WorkRoomState) {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  private notifyMembers() {
    const members = this.members;
    for (const handler of this.membersHandlers) handler(members);
  }

  private rejectPending(error: Error) {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private expire() {
    if (this.explicitLeave || this._state === "closed" || this._state === "expired") return;
    this.hasJoined = false;
    this.setState("expired");
    this.rejectPending(new Error("room expired"));
    this.dispose();
  }

  private dispose() {
    this.offEvent();
    this.offOpen();
    this.offClose();
    this.offReconnecting();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}

export class WorkRealtimeApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly websocket: WebsocketClient,
    private readonly getContext: () => Promise<WorkRuntimeContext | null>,
  ) {}

  async createRoom<Events extends WorkRoomEventMap = WorkRoomEventMap>(input: WorkRoomCreateInput = {}) {
    const admission = await this.transport.request<WorkRoomAdmissionResponse>(
      `/api/works/${encodeURIComponent(await this.requireWorkId())}/realtime/rooms`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
    return this.openRoom<Events>(admission);
  }

  async joinRoom<Events extends WorkRoomEventMap = WorkRoomEventMap>(input: { code: string }) {
    const admission = await this.transport.request<WorkRoomAdmissionResponse>(
      `/api/works/${encodeURIComponent(await this.requireWorkId())}/realtime/rooms/join`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
    return this.openRoom<Events>(admission);
  }

  private async requireWorkId() {
    const context = await this.getContext();
    if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
    return context.work.id;
  }

  private async openRoom<Events extends WorkRoomEventMap>(admission: WorkRoomAdmissionResponse) {
    const room = new WorkRoom<Events>(this.websocket, admission);
    try {
      await room.connect();
      return room;
    } catch (error) {
      await room.leave().catch(() => undefined);
      throw error;
    }
  }
}
