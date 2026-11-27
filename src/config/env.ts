/**
 * Single place for environment configuration.
 * ROOTS_TARGET=mock    -> tests run against the local mock server (no key needed)
 * ROOTS_TARGET=sandbox -> tests run against the real Roots sandbox
 */
export type Target = 'mock' | 'sandbox';

const target = (process.env.ROOTS_TARGET ?? 'mock') as Target;
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4010);

export const env = {
  target,
  isMock: target === 'mock',
  mockPort: MOCK_PORT,
  baseURL:
    target === 'mock'
      ? `http://localhost:${MOCK_PORT}`
      : process.env.ROOTS_BASE_URL ?? 'https://api.sandbox.roots.finance',
  token: process.env.ROOTS_API_TOKEN ?? 'rts_live_mock_client_a',
  otherClientToken:
    process.env.ROOTS_OTHER_CLIENT_TOKEN ?? (target === 'mock' ? 'rts_live_mock_client_b' : ''),
  webhookSecret: process.env.ROOTS_WEBHOOK_SECRET ?? 'whsec_test_secret',
  /** How long to wait for async status changes (settlement, provisioning). */
  pollTimeoutMs: Number(process.env.POLL_TIMEOUT_MS ?? (target === 'mock' ? 10_000 : 60_000)),
};

if (env.target === 'sandbox' && !process.env.ROOTS_API_TOKEN) {
  throw new Error('ROOTS_TARGET=sandbox needs ROOTS_API_TOKEN. Copy .env.example to .env and fill it in.');
}
