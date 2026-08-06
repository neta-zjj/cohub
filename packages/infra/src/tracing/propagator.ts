import { propagation, context, trace, type SpanOptions, SpanStatusCode, type Tracer, type Span } from "@opentelemetry/api";

/** Standard W3C trace propagation carrier for Redis messages. */
type TraceCarrier = Record<string, string>;

const TRACE_CARRIER_KEY = "_trace";

// ---------------------------------------------------------------------------
// Inject / Extract helpers for Redis Stream/List payloads
// ---------------------------------------------------------------------------

/**
 * Inject the current trace context into a plain object that will be JSON-serialized
 * and sent over Redis. The carrier is stored under `_trace`.
 *
 * Usage:
 *   const payload = { ...event, ...injectTrace() };
 *   await redis.xadd(stream, "*", "payload", JSON.stringify(payload));
 */
export function injectTrace(): Record<string, unknown> {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  if (Object.keys(carrier).length === 0) return {};
  return { [TRACE_CARRIER_KEY]: carrier };
}

/**
 * Extract trace context from a parsed Redis message payload.
 * Returns the parent Context to use with `runInSpanWithParent`.
 *
 * Usage:
 *   const event = JSON.parse(payload);
 *   const parentCtx = extractTrace(event);
 *   await runInSpanWithParent(tracer, "name", opts, parentCtx, async (span) => { ... });
 */
export function extractTrace(payload: Record<string, unknown>) {
  const carrier = payload[TRACE_CARRIER_KEY] as TraceCarrier | undefined;
  if (!carrier) return context.active();
  return propagation.extract(context.active(), carrier);
}

// ---------------------------------------------------------------------------
// Convenient span creators
// ---------------------------------------------------------------------------

/** Get the global tracer for a given service. */
export function getTracer(serviceName: string): Tracer {
  return trace.getTracer(serviceName);
}

/**
 * Run `fn` inside a span. The span is ended when `fn` resolves or throws.
 * Errors are recorded and the span status is set to ERROR.
 * The span is NOT set as the active context — use `runInActiveSpan` for that.
 */
export async function runInSpan<T>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  try {
    const result = await fn(span);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error);
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Run `fn` inside an active span (span becomes the active context).
 * Errors are recorded, the span is ended, and the error is re-thrown.
 * Use `parentCtx` to set a parent context (e.g. extracted from a message).
 */
export async function runInActiveSpan<T>(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  parentCtx: ReturnType<typeof context.active>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, options, parentCtx);
  const activeCtx = trace.setSpan(parentCtx, span);
  return context.with(activeCtx, async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
