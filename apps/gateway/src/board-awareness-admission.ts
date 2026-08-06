export const BOARD_AWARENESS_MAX_EVENTS_PER_SECOND = 60;
export const BOARD_AWARENESS_MAX_PENDING = 32;

export type BoardAwarenessRate = {
  startedAt: number;
  count: number;
};

/** Consume one event from a fixed one-second admission window. */
export function consumeBoardAwarenessRate(
  rate: BoardAwarenessRate,
  now = Date.now(),
): boolean {
  if (now - rate.startedAt >= 1_000) {
    rate.startedAt = now;
    rate.count = 1;
    return true;
  }
  rate.count += 1;
  return rate.count <= BOARD_AWARENESS_MAX_EVENTS_PER_SECOND;
}

/** Transient awareness is dropped instead of building an unbounded publish tail. */
export function hasBoardAwarenessCapacity(
  pending: number,
  maxPending = BOARD_AWARENESS_MAX_PENDING,
): boolean {
  return pending < maxPending;
}
