export type StreamFlushUrgency = "immediate" | "text" | "tool";

/** Text / thinking stay near frame-time. */
export const STREAM_TEXT_DEBOUNCE_MS = 24;

/** Tool progress / partialResult can be coarser. */
export const STREAM_TOOL_DEBOUNCE_MS = 250;

export function resolveStreamFlushDelayMs(urgency: StreamFlushUrgency): number {
  if (urgency === "immediate") return 0;
  if (urgency === "tool") return STREAM_TOOL_DEBOUNCE_MS;
  return STREAM_TEXT_DEBOUNCE_MS;
}

/** Replace only when the new request is strictly more urgent (lower delay). */
export function shouldReplaceStreamFlushTimer(
  existingDelayMs: number | null | undefined,
  nextDelayMs: number,
): boolean {
  return existingDelayMs == null || nextDelayMs < existingDelayMs;
}
