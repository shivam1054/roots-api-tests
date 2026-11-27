import { test, expect } from '../../src/fixtures/test';
import { aCustomer } from '../../src/builders/person.builder';
import { DOCUMENT_TYPES } from '../../src/models/types';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { env } from '../../src/config/env';
import { idempotencyKey } from '../../src/utils/ids';

/**
 * POST /api/v1/documents (API reference: "Upload a document").
 * Multipart form: subject_type=person, subject_id, type (19 values), optional
 * document_number (1-64) and issued_country (ISO 3166-1 alpha-2), and a file.
 */
test.describe('Document upload', () => {
  test('uploads a passport with number and issuing country', { tag: ['@smoke', '@contract'] }, async ({ api }) => {
    const person = (await api.persons.create(aCustomer().build())).body;
    const res = await api.documents.upload(person.id, 'passport', { document_number: 'X12345678', issued_country: 'US' });

    expectStatus(res, 201);
    expect(res.body.id).toMatch(/^doc_/);
    expect(res.body).toMatchObject({ subject_type: 'person', subject_id: person.id, type: 'passport', status: 'uploaded', content_type: 'application/pdf' });
    expect(res.body.size_bytes).toBeGreaterThan(0);

    const list = await api.documents.list(person.id);
    expectStatus(list, 200);
    expect(list.body.data.map((d) => d.id)).toContain(res.body.id);
  });

  test('accepts every documented document type', { tag: ['@contract'] }, async ({ api }) => {
    const person = (await api.persons.create(aCustomer().build())).body;
    for (const type of DOCUMENT_TYPES) {
      expectStatus(await api.documents.upload(person.id, type), 201);
    }
  });

  // Each row: what we send, which field the API must name in `violations`.
  const invalid: [string, () => { type?: string; extra?: Record<string, string>; subjectType?: string; omitFile?: boolean }, string][] = [
    ['unknown document type', () => ({ type: 'selfie' }), 'type'],
    ['subject_type other than person', () => ({ subjectType: 'account' }), 'subject_type'],
    ['3-letter country code', () => ({ extra: { issued_country: 'USA' } }), 'issued_country'],
    ['2 letters but not a country', () => ({ extra: { issued_country: 'XX' } }), 'issued_country'],
    ['lowercase country code', () => ({ extra: { issued_country: 'us' } }), 'issued_country'],
    ['document number over 64 characters', () => ({ extra: { document_number: 'A'.repeat(65) } }), 'document_number'],
    ['document number with a control character', () => ({ extra: { document_number: 'X123\u0007456' } }), 'document_number'],
    ['no file attached', () => ({ omitFile: true }), 'file'],
  ];
  for (const [name, make, field] of invalid) {
    test(`rejects ${name}`, { tag: ['@contract'] }, async ({ api }) => {
      const person = (await api.persons.create(aCustomer().build())).body;
      const { type = 'passport', extra = {}, subjectType, omitFile } = make();
      const res = await api.documents.upload(person.id, type, extra, { subjectType, omitFile });

      expectProblem(res, 422, 'validation');
      expect(res.problem!.violations!.map((v) => v.path)).toContain(field);
    });
  }

  test('missing Idempotency-Key is refused', { tag: ['@contract'] }, async ({ api }) => {
    const person = (await api.persons.create(aCustomer().build())).body;
    expectProblem(await api.documents.upload(person.id, 'passport', {}, { idempotencyKey: null }), 422, 'validation');
  });

  test('retrying the same upload with the same key returns the same document', { tag: ['@p0'] }, async ({ api }) => {
    const person = (await api.persons.create(aCustomer().build())).body;
    const key = idempotencyKey();
    const first = await api.documents.upload(person.id, 'utility_bill', {}, { idempotencyKey: key });
    // Multipart boundaries differ between requests; Roots compares the fields and file, not the raw bytes.
    const retry = await api.documents.upload(person.id, 'utility_bill', {}, { idempotencyKey: key });

    expectStatus(first, 201);
    expectStatus(retry, 201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
  });

  test('same key with a different document type is a conflict', { tag: ['@contract'] }, async ({ api }) => {
    const person = (await api.persons.create(aCustomer().build())).body;
    const key = idempotencyKey();
    expectStatus(await api.documents.upload(person.id, 'utility_bill', {}, { idempotencyKey: key }), 201);
    expectProblem(await api.documents.upload(person.id, 'bank_statement', {}, { idempotencyKey: key }), 409, 'idempotency_key_conflict');
  });

  test.describe('client isolation', () => {
    test.skip(!env.otherClientToken, 'Set ROOTS_OTHER_CLIENT_TOKEN to run against the sandbox');
    test("cannot upload to another client's person: 404", { tag: ['@p0', '@security'] }, async ({ api, otherClientApi }) => {
      const person = (await api.persons.create(aCustomer().build())).body;
      expectProblem(await otherClientApi.documents.upload(person.id, 'passport'), 404, 'not_found');
    });
  });
});
