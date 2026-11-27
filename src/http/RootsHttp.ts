import { APIRequestContext, APIResponse } from '@playwright/test';
import type { Problem } from '../models/types';
import { idempotencyKey } from '../utils/ids';

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T;
  /** Set when the response is an RFC 9457 problem document. */
  problem?: Problem;
  headers: Record<string, string>;
  /** The exact key and bytes sent, so a test can replay the identical request. */
  sent: { method: string; path: string; idempotencyKey?: string; rawBody?: string };
}

export interface RequestOptions {
  body?: unknown;
  /** Send this exact JSON string instead of serialising `body` (for byte-exact idempotency replays). */
  rawBody?: string;
  /** undefined = generate a fresh key, string = use it, null = send no key at all. */
  idempotencyKey?: string | null;
  query?: Record<string, string | string[]>;
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  /** Override the bearer token (e.g. to test auth). null = no Authorization header. */
  token?: string | null;
  /** Extra headers, e.g. X-Request-ID for log correlation. */
  headers?: Record<string, string>;
}

/**
 * Thin HTTP layer shared by all clients. It adds auth and Idempotency-Key headers,
 * keeps the exact bytes sent, and parses problem+json errors. It never throws on 4xx/5xx:
 * tests assert on status codes explicitly.
 */
export class RootsHttp {
  constructor(private readonly ctx: APIRequestContext, private readonly token: string) {}

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const token = opts.token === undefined ? this.token : opts.token;
    if (token !== null) headers.Authorization = `Bearer ${token}`;

    let key: string | undefined;
    if (method === 'POST' && opts.idempotencyKey !== null) {
      key = opts.idempotencyKey ?? idempotencyKey();
      headers['Idempotency-Key'] = key;
    }

    let rawBody: string | undefined;
    if (opts.multipart === undefined && (opts.body !== undefined || opts.rawBody !== undefined)) {
      rawBody = opts.rawBody ?? JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }

    const url = path + toQuery(opts.query);
    const res = await this.ctx.fetch(url, {
      method,
      headers,
      data: rawBody,
      multipart: opts.multipart,
      failOnStatusCode: false,
    });
    return toResult<T>(res, { method, path, idempotencyKey: key, rawBody });
  }
}

function toQuery(q?: Record<string, string | string[]>): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) for (const item of Array.isArray(v) ? v : [v]) p.append(k, item);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function toResult<T>(res: APIResponse, sent: ApiResult<T>['sent']): Promise<ApiResult<T>> {
  const headers = res.headers();
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  const isProblem = (headers['content-type'] ?? '').includes('application/problem+json');
  return { status: res.status(), ok: res.ok(), body, problem: isProblem ? body : undefined, headers, sent };
}
