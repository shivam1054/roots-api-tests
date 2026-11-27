import { test, expect } from '@playwright/test';
import { EventDeduplicator, sign, verify } from '../../src/webhooks/signature';

/**
 * Tests of our webhook receiver logic (no network). Roots signs with
 * `Roots-Signature: t=..,v1=HMAC-SHA256(secret, t + "." + raw_body)` and delivers at least once.
 */
const secret = 'whsec_test_secret';
const body = JSON.stringify({ id: 'evt_1', type: 'transfer.status.changed', occurred_at: '2026-11-24T10:00:00Z', data: { id: 'xfer_1', status: 'settled' } });

test.describe('Webhook receiver', { tag: ['@security', '@webhooks'] }, () => {
  test('accepts a valid signature', () => {
    expect(verify(body, sign(body, secret), secret)).toEqual({ ok: true });
  });

  test('rejects a tampered body (e.g. status changed to settled by an attacker)', () => {
    const header = sign(body, secret);
    expect(verify(body.replace('settled', 'failed'), header, secret)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('rejects the wrong secret', () => {
    expect(verify(body, sign(body, 'whsec_other'), secret)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('rejects a captured message replayed after the 5-minute tolerance', () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    expect(verify(body, sign(body, secret, tenMinutesAgo), secret)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  test('cannot refresh an old message with a new timestamp, because t is signed', () => {
    const old = sign(body, secret, Math.floor(Date.now() / 1000) - 600);
    const forged = old.replace(/t=\d+/, `t=${Math.floor(Date.now() / 1000)}`);
    expect(verify(body, forged, secret)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  for (const header of [undefined, '', 'v1=abc', 't=abc,v1=xyz']) {
    test(`rejects malformed header: ${JSON.stringify(header)}`, () => {
      expect(verify(body, header, secret).ok).toBe(false);
    });
  }

  test('processes a duplicated event only once', () => {
    const dedupe = new EventDeduplicator();
    expect([dedupe.accept('evt_1'), dedupe.accept('evt_1'), dedupe.accept('evt_2')]).toEqual([true, false, true]);
  });
});
