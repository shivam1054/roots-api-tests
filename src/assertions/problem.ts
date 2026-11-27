import { expect } from '@playwright/test';
import type { ApiResult } from '../http/RootsHttp';

/**
 * Asserts an RFC 9457 problem response with a stable `code`.
 * Roots says: branch on `code`, never on `detail` text.
 */
export function expectProblem(res: ApiResult<unknown>, status: number, code: string) {
  expect(res.status, `expected ${status} ${code}, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(status);
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.problem).toMatchObject({ status, code });
  expect(res.problem?.title, 'problem.title').toBeTruthy();
  expect(res.problem?.trace_id, 'problem.trace_id for support').toBeTruthy();
  // Errors must never leak internals.
  expect(JSON.stringify(res.body)).not.toMatch(/Exception|stack|\.java:|\.ts:\d+|SELECT |password/i);
}

export function expectStatus(res: ApiResult<unknown>, status: number) {
  expect(res.status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(status);
}
