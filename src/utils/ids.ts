import { randomUUID } from 'node:crypto';

export const idempotencyKey = (): string => randomUUID();

/** Unique, readable external_id so a failed test can be traced back in the Roots portal. */
export const externalId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
