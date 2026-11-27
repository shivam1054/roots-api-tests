import { env } from '../config/env';

/**
 * Polls until `predicate` is true. Money movements in Roots are asynchronous:
 * a 201 means "accepted", not "settled", so tests must wait on state, never sleep.
 */
export async function pollUntil<T>(
  fetch: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = env.pollTimeoutMs, intervalMs = 200, description = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fetch();
  while (!predicate(last)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}. Last value:\n${JSON.stringify(last, null, 2)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fetch();
  }
  return last;
}
