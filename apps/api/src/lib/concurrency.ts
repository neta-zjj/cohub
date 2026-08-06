/**
 * Maps `items` through `worker` with a bounded worker pool.
 *
 * Used to fan out upstream requests from public endpoints without letting the
 * caller's input size dictate how many connections we open at once. Results
 * keep the input order; the first rejection propagates.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(1, limit), items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index] as T);
      }
    }),
  );
  return results;
}
