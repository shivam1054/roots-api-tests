import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance } from '../../src/assertions/money';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { idempotencyKey } from '../../src/utils/ids';
import { usd } from '../../src/money/money';

/** Each test maps to a row of the Roots idempotency guide. */
test.describe('Idempotency on POST /transfers', () => {
  test('same key + same bytes = same transfer, money moves once', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const first = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('25.00')).build());
    expectStatus(first, 201);

    // A client retry after a timeout: identical key and identical bytes.
    const replay = await api.http.request<any>('POST', '/api/v1/transfers', { idempotencyKey: first.sent.idempotencyKey, rawBody: first.sent.rawBody });
    expectStatus(replay, 201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);

    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('75.00') }); // held once, not twice
    const holds = (await api.transfers.transactions(first.body.id)).body.data.filter((e) => e.type === 'hold');
    expect(holds).toHaveLength(1);
  });

  test('same key + different amount = 409 conflict, no second transfer', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const key = idempotencyKey();
    const body = aTransfer().from(from.id).toAccount(to.id).amount(usd('10.00'));
    expectStatus(await api.transfers.create(body.build(), { idempotencyKey: key }), 201);

    expectProblem(await api.transfers.create(body.amount(usd('90.00')).build(), { idempotencyKey: key }), 409, 'idempotency_key_conflict');
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('90.00') });
  });

  test('comparison is byte-exact: same JSON, different key order = conflict', { tag: ['@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const key = idempotencyKey();
    const fields = { source: { type: 'account', id: from.id }, destination: { type: 'account', id: to.id }, amount_minor: '500' };
    expectStatus(await api.http.request('POST', '/api/v1/transfers', { idempotencyKey: key, rawBody: JSON.stringify(fields) }), 201);

    const reordered = JSON.stringify({ amount_minor: '500', destination: fields.destination, source: fields.source });
    // Lesson for SDK authors: serialise once, store the bytes, resend them unchanged.
    expectProblem(await api.http.request('POST', '/api/v1/transfers', { idempotencyKey: key, rawBody: reordered }), 409, 'idempotency_key_conflict');
  });

  test('missing Idempotency-Key is refused', { tag: ['@p0', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('1000');
    const to = await world.activeAccount(from.person_id);
    expectProblem(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').build(), { idempotencyKey: null }), 422, 'validation');
  });

  test('same key sent twice at once: one transfer, never two', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const key = idempotencyKey();
    const rawBody = JSON.stringify(aTransfer().from(from.id).toAccount(to.id).amount(usd('40.00')).build());

    const [a, b] = await Promise.all([
      api.http.request<any>('POST', '/api/v1/transfers', { idempotencyKey: key, rawBody }),
      api.http.request<any>('POST', '/api/v1/transfers', { idempotencyKey: key, rawBody }),
    ]);
    const created = [a, b].filter((r) => r.status === 201);
    const inProgress = [a, b].filter((r) => r.problem?.code === 'idempotency_key_in_progress');
    expect(created.length + inProgress.length).toBe(2);
    expect(new Set(created.map((r) => r.body.id)).size).toBe(1);
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('60.00') });
  });

  test('a refused transfer replays its refusal with the same key', { tag: ['@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('5.00'));
    const to = await world.activeAccount(from.person_id);
    const key = idempotencyKey();
    const body = aTransfer().from(from.id).toAccount(to.id).amount(usd('50.00')).build();
    expectProblem(await api.transfers.create(body, { idempotencyKey: key }), 422, 'insufficient_funds');

    // Topping up does not make the same key succeed: a replacement needs a new key.
    await api.sandbox.deposit(from.id, usd('100.00'));
    await world.waitForAccount(from.id, (a) => a.balance.available_minor === usd('105.00'));
    expectProblem(await api.transfers.create(body, { idempotencyKey: key }), 422, 'insufficient_funds');
    expectStatus(await api.transfers.create(body), 201);
  });
});
