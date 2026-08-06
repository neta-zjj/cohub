import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WorkRoom, type WorkRoomAdmissionResponse } from "../src/apis/work-realtime.js";
import { WebsocketClient, type WebSocketLike } from "../src/websocket.js";

type SentFrame = {
  type: string;
  requestId?: string;
  payload: Record<string, unknown> & { roomId?: string; data?: unknown };
};

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.({ code, reason } as CloseEvent));
  }

  /** Frames this connection sent, decoded. */
  frames(type?: string) {
    const items = this.sent.map((raw) => JSON.parse(raw) as SentFrame);
    return type ? items.filter((item) => item.type === type) : items;
  }
}

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  assert.fail("condition was not met");
};

const envelope = (input: Record<string, unknown>) => ({
  id: "event-id",
  timestamp: Date.now(),
  domain: "room",
  rooms: [`room:${(input.roomId as string) ?? (input.payload as { roomId?: string })?.roomId ?? "room-1"}`],
  ...input,
});

const authOk = {
  id: "auth-id",
  timestamp: Date.now(),
  domain: "system",
  type: "system.auth.ok",
  payload: {
    connectionId: "connection-1",
    user: {},
    capabilities: ["realtime.room.v1"],
  },
};

const descriptor = (overrides: Record<string, unknown> = {}) => ({
  id: "room-1",
  code: "TEAM-ALPHA",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxParticipants: 16,
  seatPerUser: false,
  ...overrides,
});

const admission = (overrides: Partial<WorkRoomAdmissionResponse> = {}): WorkRoomAdmissionResponse => ({
  room: descriptor(),
  participantId: "participant-1",
  userKey: "user-key-1",
  ticket: "ticket",
  ...overrides,
});

const member = (participantId: string, overrides: Record<string, unknown> = {}) => ({
  participantId,
  joinedAt: new Date().toISOString(),
  presence: null,
  ...overrides,
});

const openSocket = () => {
  FakeWebSocket.instances = [];
  const websocket = new WebsocketClient({
    url: "ws://localhost",
    autoReconnect: false,
    WebSocketImpl: FakeWebSocket,
    getAccessToken: () => "work-token",
  });
  return websocket;
};

/** Opens the transport and completes authentication, leaving no room joined. */
const authenticate = async (connect: () => Promise<unknown>) => {
  const pending = connect();
  const socket = FakeWebSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await waitFor(() => socket.frames("auth").length > 0);
  socket.receive(authOk);
  return { socket, pending };
};

/** Waits for the join request of one room and returns it. */
const awaitJoinRequest = async (socket: FakeWebSocket, roomId = "room-1") => {
  await waitFor(() => socket.frames("realtime.room.join").some((item) => item.payload.roomId === roomId));
  const request = socket.frames("realtime.room.join").find((item) => item.payload.roomId === roomId);
  assert.ok(request);
  return request;
};

/** Answers a join request with a member snapshot. */
const answerJoin = (
  socket: FakeWebSocket,
  requestId: string | undefined,
  payload: { roomId?: string; participantId?: string; members?: unknown[]; sequence?: number; room?: Record<string, unknown> } = {},
) => {
  const roomId = payload.roomId ?? "room-1";
  const participantId = payload.participantId ?? "participant-1";
  socket.receive(envelope({
    type: "realtime.room.joined",
    requestId: requestId ?? null,
    roomId,
    payload: {
      roomId,
      room: payload.room ?? descriptor({ id: roomId }),
      participantId,
      members: payload.members ?? [member(participantId)],
      sequence: payload.sequence ?? 1,
    },
  }));
};

/** The whole handshake for a room that needs no interference in the middle. */
const joinRoom = async <T extends { connect: () => Promise<unknown> }>(
  room: T,
  payload: Parameters<typeof answerJoin>[2] = {},
) => {
  const { socket, pending } = await authenticate(() => room.connect());
  const request = await awaitJoinRequest(socket, payload.roomId);
  answerJoin(socket, request.requestId, payload);
  await pending;
  return socket;
};

test("WorkRoom publishes typed custom events and acknowledges them", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ "custom.event": { value: number } }>(websocket, admission());
  const received: number[] = [];
  room.subscribe("custom.event", (event) => received.push(event.data.value));

  const socket = await joinRoom(room);
  assert.equal(room.state, "joined");

  const publishing = room.publish("custom.event", { value: 7 }, { clientEventId: "client-1" });
  await waitFor(() => socket.frames("realtime.room.publish").length > 0);
  const publishRequest = socket.frames("realtime.room.publish")[0];
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 2,
      event: "custom.event",
      data: { value: 7 },
      clientEventId: "client-1",
      sender: { participantId: "participant-1" },
    },
  }));
  socket.receive(envelope({
    type: "realtime.room.request.ok",
    requestId: publishRequest?.requestId,
    roomId: "room-1",
    payload: { roomId: "room-1", sequence: 2, eventId: "event-2", clientEventId: "client-1" },
  }));
  assert.deepEqual(await publishing, { eventId: "event-2", sequence: 2, clientEventId: "client-1" });
  assert.deepEqual(received, [7]);

  const leaving = room.leave();
  await waitFor(() => socket.frames("realtime.room.leave").length > 0);
  socket.receive(envelope({
    type: "realtime.room.request.ok",
    requestId: socket.frames("realtime.room.leave")[0]?.requestId,
    roomId: "room-1",
    payload: { roomId: "room-1" },
  }));
  await leaving;
  await websocket.disconnect();
});

test("WorkRoom releases socket listeners when a close will not reconnect", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ "custom.event": { value: number } }>(websocket, admission());
  const received: number[] = [];
  room.subscribe("custom.event", (event) => received.push(event.data.value));

  const socket = await joinRoom(room);
  assert.equal(room.state, "joined");

  socket.close();
  await waitFor(() => room.state === "closed");

  // dispose() detached the event listener, so a late frame must not be routed.
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 2,
      event: "custom.event",
      data: { value: 99 },
      clientEventId: null,
      sender: { participantId: "participant-2" },
    },
  }));
  await delay(5);
  assert.deepEqual(received, [], "a disposed room must not receive further events");
});

test("send() puts no ack on the wire and refuses what the server could not attribute", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ "input.frame": unknown }>(websocket, admission());
  const sendErrors: string[] = [];
  room.onSendError((error) => sendErrors.push(error.message));

  room.send("input.frame", { pad: 1 });
  assert.equal(FakeWebSocket.instances.length, 0, "send() must not force a connection");

  const socket = await joinRoom(room);
  for (let frame = 0; frame < 5; frame += 1) room.send("input.frame", { pad: frame });
  await waitFor(() => socket.frames("realtime.room.publish").length === 5);
  const sends = socket.frames("realtime.room.publish");
  assert.deepEqual(sends.map((item) => (item.payload.data as { pad: number }).pad), [0, 1, 2, 3, 4]);
  assert.ok(sends.every((item) => item.requestId === undefined), "send() carries no requestId");

  // Each of these is rejected before the Gateway knows which room it came from, so the
  // failure would be lost on the wire. `undefined` and friends encode to nothing, which
  // would drop the data key from the frame.
  const before = socket.sent.length;
  room.send("bad name!" as "input.frame", { pad: 1 });
  room.send("input.frame", { blob: "x".repeat(17 * 1024) });
  room.send("input.frame", undefined);
  room.send("input.frame", () => 1);
  room.send("input.frame", { toJSON: () => undefined });
  await waitFor(() => sendErrors.length === 5);
  assert.match(sendErrors[0] ?? "", /invalid room event name/);
  assert.match(sendErrors[1] ?? "", /payload is too large/);
  for (const message of sendErrors.slice(2)) assert.match(message, /not serializable/);
  assert.equal(socket.sent.length, before, "nothing malformed reaches the wire");
  await assert.rejects(room.publish("bad name!" as "input.frame", { pad: 1 }), /invalid room event name/);

  // null is a legitimate payload and must still go out with the key present.
  room.send("input.frame", null);
  await waitFor(() => socket.sent.length === before + 1);
  const frame = socket.frames("realtime.room.publish").at(-1);
  assert.ok(frame && "data" in frame.payload);
  assert.equal(frame.payload.data, null);
  assert.equal(sendErrors.length, 5);

  socket.close();
  await waitFor(() => room.state === "closed");
  await websocket.disconnect();
});

test("a send() failure reaches only the room it belongs to", async () => {
  const websocket = openSocket();
  const open = async (roomId: string, existing?: FakeWebSocket) => {
    const room = new WorkRoom(websocket, admission({
      room: descriptor({ id: roomId }),
      participantId: `participant-${roomId}`,
    }));
    if (!existing) return { room, socket: await joinRoom(room, { roomId, participantId: `participant-${roomId}` }) };
    const pending = room.connect();
    const request = await awaitJoinRequest(existing, roomId);
    answerJoin(existing, request.requestId, { roomId, participantId: `participant-${roomId}` });
    await pending;
    return { room, socket: existing };
  };

  const first = await open("room-1");
  const second = await open("room-2", first.socket);
  const socket = first.socket;
  const firstErrors: string[] = [];
  const secondErrors: string[] = [];
  first.room.onSendError((error) => firstErrors.push(error.message));
  second.room.onSendError((error) => secondErrors.push(error.message));

  socket.receive(envelope({
    type: "realtime.room.request.error",
    requestId: null,
    roomId: "room-1",
    payload: { roomId: "room-1", code: "RATE_LIMITED", message: "room event rate exceeded" },
  }));
  await waitFor(() => firstErrors.length === 1);
  assert.deepEqual(secondErrors, [], "a sibling room must not see another room's failure");

  // Carries a requestId, so it is late or another room's; either way not a send() failure.
  socket.receive(envelope({
    type: "realtime.room.request.error",
    requestId: "stale-request-id",
    roomId: "room-1",
    payload: { roomId: "room-1", code: "ROOM_PUBLISH_FAILED", message: "late rejection" },
  }));
  // Unattributable, so no room may claim it.
  socket.receive({
    id: "err-2",
    timestamp: Date.now(),
    domain: "system",
    type: "system.request.error",
    requestId: null,
    payload: { code: "INTERNAL_ERROR", message: "internal error" },
  });
  await delay(10);
  assert.equal(firstErrors.length, 1);
  assert.equal(secondErrors.length, 0);

  socket.close();
  await waitFor(() => first.room.state === "closed" && second.room.state === "closed");
  await websocket.disconnect();
});

test("closing a room settles in-flight requests instead of leaving them to time out", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ move: { x: number } }>(websocket, admission());
  const socket = await joinRoom(room);

  const first = room.publish("move", { x: 1 });
  const second = room.setPresence({ ready: true });
  await waitFor(() => socket.frames("realtime.room.publish").length === 1
    && socket.frames("realtime.room.presence.update").length === 1);

  socket.receive(envelope({
    type: "realtime.room.closed",
    payload: { roomId: "room-1", reason: "superseded" },
  }));

  // Listeners come off with the close, so these would otherwise hang for the full 20s.
  await assert.rejects(first, /superseded/);
  await assert.rejects(second, /superseded/);
  assert.equal(room.state, "closed");
  await websocket.disconnect();
});

test("the join snapshot does not discard deltas that raced it", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ tick: { n: number } }>(websocket, admission({
    participantId: "participant-a",
  }));
  const outOfSync: string[] = [];
  const received: number[] = [];
  room.onOutOfSync((expected, actual) => outOfSync.push(`${expected}:${actual}`));
  room.subscribe("tick", (event) => received.push(event.data.n));

  const { socket, pending } = await authenticate(() => room.connect());
  const request = await awaitJoinRequest(socket);

  // The server subscribes before it answers, so these land first. The snapshot below is
  // older: read at sequence 5, and it does not know participant-b yet.
  socket.receive(envelope({
    type: "realtime.room.member.joined",
    payload: { roomId: "room-1", sequence: 6, member: member("participant-b") },
  }));
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 7,
      event: "tick",
      data: { n: 7 },
      clientEventId: null,
      sender: { participantId: "participant-b" },
    },
  }));
  answerJoin(socket, request.requestId, { participantId: "participant-a", sequence: 5 });
  await pending;

  assert.deepEqual(
    room.members.map((item) => item.participantId).sort(),
    ["participant-a", "participant-b"],
    "a peer that joined mid-handshake must survive the snapshot",
  );
  assert.deepEqual(received, [7], "a raced event is delivered once, after the snapshot");

  // Sequence must have advanced past the snapshot rather than been walked back to it.
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 8,
      event: "tick",
      data: { n: 8 },
      clientEventId: null,
      sender: { participantId: "participant-b" },
    },
  }));
  await waitFor(() => received.length === 2);
  assert.deepEqual(outOfSync, [], "a contiguous replay is not a gap");

  socket.close();
  await waitFor(() => room.state === "closed");
  await websocket.disconnect();
});

test("the join snapshot drops buffered deltas it already reflects", async () => {
  const websocket = openSocket();
  const room = new WorkRoom<{ tick: { n: number } }>(websocket, admission({
    participantId: "participant-a",
  }));
  const received: number[] = [];
  room.subscribe("tick", (event) => received.push(event.data.n));

  const { socket, pending } = await authenticate(() => room.connect());
  const request = await awaitJoinRequest(socket);

  // Pub/sub can deliver an event published before the snapshot only after we
  // subscribed. These are at or below the snapshot sequence, so the snapshot already
  // reflects them: the event is history and the presence would revert a fresher seat.
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 4,
      event: "tick",
      data: { n: 4 },
      clientEventId: null,
      sender: { participantId: "participant-b" },
    },
  }));
  socket.receive(envelope({
    type: "realtime.room.presence.updated",
    payload: { roomId: "room-1", sequence: 5, member: member("participant-b", { presence: { ready: false } }) },
  }));
  answerJoin(socket, request.requestId, {
    participantId: "participant-a",
    sequence: 5,
    members: [member("participant-a"), member("participant-b", { presence: { ready: true } })],
  });
  await pending;

  assert.deepEqual(received, [], "a delta at or below the snapshot is not replayed");
  assert.deepEqual(
    room.members.find((item) => item.participantId === "participant-b")?.presence,
    { ready: true },
    "the snapshot presence is not clobbered by an older buffered update",
  );

  socket.close();
  await waitFor(() => room.state === "closed");
  await websocket.disconnect();
});

test("WorkRoom adopts the server seat in a seatPerUser room", async () => {
  const websocket = openSocket();
  const room = new WorkRoom(websocket, admission({
    room: descriptor({ seatPerUser: true }),
    participantId: "participant-new",
  }));
  const socket = await joinRoom(room, {
    room: descriptor({ seatPerUser: true }),
    participantId: "participant-existing",
    members: [member("participant-existing", { userKey: "user-key-1" })],
  });

  assert.equal(room.participantId, "participant-existing", "the server seat wins over the admission id");
  assert.equal(room.members[0]?.userKey, "user-key-1", "userKey lets an app group a viewer's participants");

  socket.close();
  await waitFor(() => room.state === "closed");
  await websocket.disconnect();
});
