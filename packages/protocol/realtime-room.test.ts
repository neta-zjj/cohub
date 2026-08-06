import assert from "node:assert/strict";
import test from "node:test";
import { realtimeEnvelopeSchema, wsClientEventSchema } from "./src/realtime/schema.js";

test("accepts generic realtime room events and room routes", () => {
  const request = wsClientEventSchema.safeParse({
    type: "realtime.room.publish",
    requestId: "request-1",
    payload: {
      roomId: "00000000-0000-4000-8000-000000000001",
      event: "shared.state.updated",
      data: { value: 1 },
    },
  });
  assert.equal(request.success, true);

  const event = realtimeEnvelopeSchema.safeParse({
    id: "event-1",
    timestamp: Date.now(),
    domain: "room",
    type: "realtime.room.event",
    rooms: ["room:00000000-0000-4000-8000-000000000001"],
    payload: {
      roomId: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      event: "shared.state.updated",
      data: { value: 1 },
      sender: { participantId: "participant-1" },
      clientEventId: null,
    },
  });
  assert.equal(event.success, true);
});
