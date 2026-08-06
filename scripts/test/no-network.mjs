import { Socket } from "node:net";

if (process.env.COHUB_TEST_ALLOW_NETWORK !== "1") {
  Socket.prototype.connect = function connect() {
    throw new Error(
      "Network access is disabled in unit tests; inject an in-memory fake instead",
    );
  };
}
