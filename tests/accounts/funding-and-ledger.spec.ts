import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';

test.describe('Account funding details and ledger', () => {
  test('active account exposes funding details payers can use', { tag: ['@smoke', '@contract'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    const res = await api.accounts.fundingDetails(acct.id);
    expectStatus(res, 200);
    expect(res.body.id).toBe(acct.id);
    expect(res.body.routing_number).toMatch(/^\d{9}$/); // ABA routing number
    expect(res.body.account_number).toBeTruthy();
    expect(res.body.account_holder).toBeTruthy();
    expect(res.body.institution_name).toBeTruthy();
  });

  test('account still opening has no funding details yet (409)', { tag: ['@contract', '@mock-only'] }, async ({ api, world }) => {
    const person = await world.activeCustomer();
    const created = await api.accounts.create(person.id);
    expect(created.body.status).toBe('pending');
    expect(created.body.capabilities.send).not.toBe('active');
    expectProblem(await api.accounts.fundingDetails(created.body.id), 409, 'account_not_provisioned');
    expectProblem(await api.accounts.setStatus(created.body.id, 'closed'), 409, 'provisioning_in_progress');
  });

  test('label: 1 to 60 characters, unknown fields rejected', { tag: ['@contract'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    expect((await api.accounts.patch(acct.id, { label: 'Operating' })).body.label).toBe('Operating');
    expectProblem(await api.accounts.patch(acct.id, { label: 'x'.repeat(61) }), 422, 'validation');
    expectProblem(await api.accounts.patch(acct.id, { balance: { available_minor: '99999999' } }), 422, 'validation');
  });

  test('ledger filters: by transfer, credit vs debit, and single-entry lookup', { tag: ['@money', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const { body: t } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('25.00')).build());
    await world.waitForTransfer(t.id, 'submitted');
    await api.sandbox.settle(t.id);
    await world.waitForTransfer(t.id, 'settled');

    const debits = (await api.accounts.transactions(from.id, { types: ['principal'], direction: 'debit' })).body;
    expect(debits.data.map((e) => e.amount_minor)).toEqual([usd('-25.00')]);
    const credits = (await api.accounts.transactions(from.id, { types: ['principal'], direction: 'credit' })).body;
    expect(credits.data.map((e) => e.amount_minor)).toEqual([usd('100.00')]); // the deposit

    const byTransfer = (await api.accounts.transactions(from.id, { transferId: t.id, types: ['principal'] })).body.data;
    expect(byTransfer).toHaveLength(1);
    const one = await api.accounts.transaction(from.id, byTransfer[0].id);
    expectStatus(one, 200);
    expect(one.body).toMatchObject({ id: byTransfer[0].id, transfer_id: t.id, type: 'principal', amount_minor: usd('-25.00'), currency: 'usd' });
    expect(one.body.posted_at).toBeTruthy();
  });

  test('a transaction id from another account is not found', { tag: ['@security'] }, async ({ api, world }) => {
    const a = await world.fundedAccount('1000');
    const b = await world.activeAccount(a.person_id);
    const entry = (await api.accounts.transactions(a.id, ['principal'])).body.data[0];
    expectProblem(await api.accounts.transaction(b.id, entry.id), 404, 'not_found');
  });

  test('page_size over 100 is refused', { tag: ['@contract'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    expectProblem(await api.accounts.transactions(acct.id, { pageSize: 101 }), 422, 'validation');
  });
});
