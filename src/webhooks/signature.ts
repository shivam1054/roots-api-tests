import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Roots webhook signatures: header `Roots-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`
 * computed over `${t}.${rawBody}` with the full secret (including "whsec_").
 * Used by a webhook receiver and by our tests of that receiver.
 */
export function sign(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'bad_signature' | 'stale_timestamp' };

export function verify(rawBody: string, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): VerifyResult {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!header || !Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'))) return { ok: false, reason: 'bad_signature' };
  if (Math.abs(now / 1000 - t) > toleranceSec) return { ok: false, reason: 'stale_timestamp' };
  return { ok: true };
}

/** At-least-once delivery means duplicates: a receiver must process each event id once. */
export class EventDeduplicator {
  private seen = new Set<string>();
  /** Returns true the first time an id is seen. */
  accept(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}
