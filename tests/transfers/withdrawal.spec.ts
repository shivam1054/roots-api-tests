import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { SANDBOX_ACCOUNTS } from '../../src/builders/counterparty.builder';
import { expectBalance, expectBalanceInvariant, expectFeeMatchesLedger, expectSourceCost } from '../../src/assertions/money';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { add, sub, usd } from '../../src/money/money';

test.describe('Withdrawals to external bank accounts', () => {
  test('ACH withdrawal settles and the fee is posted exactly once', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('1000.00'));
    const cpty = await world.counterparty(from.person_id);

    const res = await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id, 'ach').amount(usd('250.00')).build());
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ direction: 'withdrawal', rail: 'ach', status: 'pending', fee_charged_minor: '0' });

    const t = await world.waitForTransfer(res.body.id, 'settled');
    expect(t.submitted_at && t.settled_at).toBeTruthy();
    expect(t.fee_charged_minor).toBe(t.fee_quoted_minor);

    const entries = (await api.transfers.transactions(t.id)).body.data;
    const cost = add(t.amount_minor, t.fee_charged_minor); // fee_mode on_top
    expectSourceCost(entries, from.id, cost);
    expectFeeMatchesLedger(t, entries);

    const bal = (await api.accounts.get(from.id)).body.balance;
    expectBalance(bal, { current_minor: sub(usd('1000.00'), cost), pending_minor: '0' });
    expectBalanceInvariant(bal);
  });

  test('rejected at submission: failed, hold released, no fee', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id, (b) => b.withAccountNumber(SANDBOX_ACCOUNTS.failsAtSubmission));

    const { body } = await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id).amount(usd('40.00')).build());
    const t = await world.waitForTransfer(body.id, 'failed');
    expect(t.failure).toMatchObject({ code: 'rail_rejected' });
    expect(t.fee_charged_minor).toBe('0');
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00'), pending_minor: '0', current_minor: usd('100.00') });
  });

  test('settled then returned (R03): principal back, fee kept, settled_at kept', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id, (b) => b.withAccountNumber(SANDBOX_ACCOUNTS.settlesThenReturnedR03));

    const { body } = await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id).amount(usd('60.00')).build());
    const settled = await world.waitForTransfer(body.id, 'settled', 'returned');
    const returned = await world.waitForTransfer(body.id, 'returned');

    expect(returned.failure).toMatchObject({ code: 'invalid_bank_details', return_code: 'R03' });
    expect(returned.returned_at).toBeTruthy();
    expect(returned.settled_at, 'settled_at is set once and never cleared').toBe(settled.settled_at);

    // Roots: returned withdrawals are credited back, but the fee is not refunded.
    const bal = (await api.accounts.get(from.id)).body.balance;
    expectBalance(bal, { current_minor: sub(usd('100.00'), returned.fee_charged_minor), pending_minor: '0' });
    expectBalanceInvariant(bal);
  });

  test('sanctioned counterparty is blocked and cannot be paid', { tag: ['@p0', '@compliance', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id, (b) => b.sanctioned());
    expect(cpty).toMatchObject({ status: 'blocked', status_detail: 'screening_rejected' });

    const res = await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id).amount(usd('10.00')).build());
    expect(res.status).toBe(409);
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00') });
  });

  test('rail the counterparty does not support is refused', { tag: ['@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id, (b) => b.withRails('ach'));
    expectProblem(await api.transfers.create(aTransfer().from(from.id).toCounterparty(cpty.id, 'fedwire').amount('1000').build()), 422, 'validation');
  });

  test('counterparty account number is masked in responses', { tag: ['@security'] }, async ({ world }) => {
    const from = await world.activeAccount();
    const cpty = await world.counterparty(from.person_id);
    expect(cpty.external_account_information.account_number).toMatch(/^\*{4}\d{4}$/);
    expect(JSON.stringify(cpty)).not.toContain(SANDBOX_ACCOUNTS.settles);
  });
});
