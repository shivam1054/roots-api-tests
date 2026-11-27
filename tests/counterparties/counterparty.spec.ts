import { test, expect } from '../../src/fixtures/test';
import { aCounterpartyFor } from '../../src/builders/counterparty.builder';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance } from '../../src/assertions/money';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';

/** Counterparties are screened bank destinations. Only `active` ones can be paid. */
test.describe('Counterparties', () => {
  test('frozen counterparty cannot be paid; unfreezing restores it', { tag: ['@p0', '@compliance', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);

    const frozen = await api.counterparties.patch(cpty.id, { status: 'frozen' });
    expectStatus(frozen, 200);
    expect(frozen.body).toMatchObject({ status: 'frozen', status_detail: 'manual_freeze' });
    const refused = await world.withdrawal(from.id, cpty.id, usd('10.00'));
    expect(refused.status).toBe(409);
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00'), pending_minor: '0' });

    expectStatus(await api.counterparties.patch(cpty.id, { status: 'active' }), 200);
    expectStatus(await world.withdrawal(from.id, cpty.id, usd('10.00')), 201);
  });

  test('deleted counterparty stays readable for history but cannot be paid', { tag: ['@p0', '@compliance', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const paid = await world.withdrawal(from.id, cpty.id, usd('10.00'));
    await world.waitForTransfer(paid.body.id, 'settled');

    expectStatus(await api.counterparties.delete(cpty.id), 204);
    expect((await api.counterparties.get(cpty.id)).body.status).toBe('deleted');
    // Old payments still resolve to it.
    expect((await api.transfers.get(paid.body.id)).body.destination).toMatchObject({ type: 'counterparty', id: cpty.id });
    expect((await world.withdrawal(from.id, cpty.id, usd('10.00'))).status).toBe(409);
  });

  test('bank account details are immutable after creation', { tag: ['@p0', '@security'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    const cpty = await world.counterparty(acct.person_id);
    // Redirecting an approved payee to a new account would bypass screening: must be refused.
    expectProblem(await api.counterparties.patch(cpty.id, { external_account_information: { account_number: '000999999999' } }), 409, 'conflict');
    expectProblem(await api.counterparties.patch(cpty.id, { external_account_information: { routing_number: '026009593' } }), 409, 'conflict');
    expect((await api.counterparties.get(cpty.id)).body.external_account_information.account_number).toBe('****6789');
  });

  test('a screening block cannot be lifted through the API', { tag: ['@p0', '@compliance'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    const cpty = await world.counterparty(acct.person_id, (b) => b.sanctioned());
    expect(cpty.status).toBe('blocked');
    expectProblem(await api.counterparties.patch(cpty.id, { status: 'active' }), 409, 'illegal_transition');
    expect((await api.counterparties.get(cpty.id)).body.status).toBe('blocked');
  });

  const invalid: [string, (b: any) => void, string][] = [
    ['routing number with 8 digits', (b) => { b.external_account_information.routing_number = '02100002'; }, 'external_account_information.routing_number'],
    ['routing number with letters', (b) => { b.external_account_information.routing_number = '02100002X'; }, 'external_account_information.routing_number'],
    ['Fedwire without the bank name', (b) => { b.external_account_information.supported_rails = ['fedwire']; delete b.external_account_information.institution_name; }, 'external_account_information.institution_name'],
    ['unknown rail', (b) => { b.external_account_information.supported_rails = ['swift']; }, 'external_account_information.supported_rails'],
    ['unknown top-level field', (b) => { b.iban_override = 'GB00'; }, 'iban_override'],
    ['unknown relationship', (b) => { b.relationship_to_person = 'friend'; }, 'relationship_to_person'],
  ];
  for (const [name, mutate, field] of invalid) {
    test(`rejects ${name}`, { tag: ['@contract'] }, async ({ api, world }) => {
      const acct = await world.activeAccount();
      const body = aCounterpartyFor(acct.person_id).build();
      mutate(body);
      const res = await api.counterparties.create(body);
      expectProblem(res, 422, 'validation');
      expect(res.problem!.violations!.map((v) => v.path)).toContain(field);
    });
  }

  test("another client's counterparty cannot be used as a destination", { tag: ['@p0', '@security'] }, async ({ api, world, otherClientApi }) => {
    test.skip(!process.env.ROOTS_OTHER_CLIENT_TOKEN && process.env.ROOTS_TARGET === 'sandbox', 'needs a second client key');
    const victim = await world.activeAccount();
    const victimCpty = await world.counterparty(victim.person_id);
    const other = await world.fundedAccount('1000');
    expectProblem(await otherClientApi.counterparties.get(victimCpty.id), 404, 'not_found');
    // Same client here, but proves a foreign id is treated as missing, not as forbidden.
    expect((await api.transfers.create(aTransfer().from(other.id).toCounterparty('cpty_00000000000000000000000000000000').amount('100').build())).status).toBe(404);
  });
});
