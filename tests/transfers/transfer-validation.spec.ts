import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance } from '../../src/assertions/money';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';

/**
 * POST /transfers body rules from the API reference (TransferCreateRequest is strict:
 * unknown fields are rejected). Every refusal must leave the balance untouched.
 */
test.describe('Transfer request validation', () => {
  test('client cannot set the fee, total or rate: unknown fields are rejected', { tag: ['@p0', '@money', '@security'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    for (const [field, value] of [['fee_minor', '0'], ['total_minor', '1'], ['rate', '1.0'], ['fee_mode', 'deducted']] as const) {
      const res = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('50.00')).with(field, value).build());
      expectProblem(res, 422, 'validation');
      expect(res.problem!.violations!.map((v) => v.path)).toContain(field);
    }
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00') });
  });

  test('purpose is required and must be a known value', { tag: ['@p0', '@compliance', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('5000');
    const to = await world.activeAccount(from.person_id);
    const missing = aTransfer().from(from.id).toAccount(to.id).amount('100').build();
    delete missing.purpose;
    const r1 = await api.transfers.create(missing);
    expectProblem(r1, 422, 'validation');
    expect(r1.problem!.violations!.map((v) => v.path)).toContain('purpose');

    expectProblem(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').with('purpose', 'gift').build()), 422, 'validation');
  });

  test('purpose "other" needs a description', { tag: ['@compliance', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('5000');
    const to = await world.activeAccount(from.person_id);
    const res = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').with('purpose', 'other').build());
    expectProblem(res, 422, 'validation');
    expect(res.problem!.violations!.map((v) => v.path)).toContain('description');

    expectStatus(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').with('purpose', 'other').with('description', 'Refund of deposit').build()), 201);
  });

  test('ACH memo: at most 80 printable ASCII characters', { tag: ['@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const ach = (memo: string) => aTransfer().from(from.id).toCounterparty(cpty.id, 'ach').amount('1000').with('memo', memo).build();

    expectStatus(await api.transfers.create(ach('X'.repeat(80))), 201);
    for (const memo of ['X'.repeat(81), 'Paiement reçu', 'Invoice 881 ✅', 'line1\nline2']) {
      const res = await api.transfers.create(ach(memo));
      expectProblem(res, 422, 'validation');
      expect(res.problem!.violations!.map((v) => v.path)).toContain('memo');
    }
  });

  test('external_id allows only letters, digits and ._:-', { tag: ['@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('5000');
    const to = await world.activeAccount(from.person_id);
    for (const bad of ['inv 881', 'inv/881', 'x'.repeat(65)]) {
      expectProblem(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').with('external_id', bad).build()), 422, 'validation');
    }
  });

  test('a rail that is not available is refused and nothing is held', { tag: ['@money', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const res = await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id).with('rail', 'swift').amount(usd('10.00')).build());
    // 501 rail_not_supported (not built yet) or 409 rail_not_enabled (not enabled for this client).
    expect([501, 409]).toContain(res.status);
    expect(['rail_not_supported', 'rail_not_enabled']).toContain(res.problem?.code);
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00'), pending_minor: '0' });
  });

  test('X-Request-ID is echoed back for log correlation', { tag: ['@contract'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    const res = await api.http.request('GET', `/api/v1/accounts/${acct.id}`, { headers: { 'X-Request-ID': 'qa-trace-12345' } });
    expect(res.headers['x-request-id']).toBe('qa-trace-12345');
  });
});
