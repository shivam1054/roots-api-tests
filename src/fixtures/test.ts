import { test as base, expect, request as pwRequest } from '@playwright/test';
import { env } from '../config/env';
import { RootsApi } from '../clients';
import { aCustomer, PersonBuilder } from '../builders/person.builder';
import { aCounterpartyFor, CounterpartyBuilder } from '../builders/counterparty.builder';
import type { Account, Counterparty, MinorUnits, Person, Transfer, TransferStatus } from '../models/types';
import { pollUntil } from '../utils/poll';
import { expectStatus } from '../assertions/problem';

/**
 * Test data helpers. Every test builds its own customer and accounts,
 * so tests are independent and can run in parallel.
 */
export class World {
  constructor(private readonly api: RootsApi) {}

  /** Creates a customer, uploads KYC documents and waits for review to clear. */
  async activeCustomer(builder: PersonBuilder = aCustomer()): Promise<Person> {
    const created = await this.api.persons.create(builder.build());
    expectStatus(created, 201);
    const id = created.body.id;
    expectStatus(await this.api.documents.upload(id, 'passport', { document_number: 'X12345678', issued_country: 'US' }), 201);
    expectStatus(await this.api.documents.upload(id, 'utility_bill'), 201);
    const submitted = await this.api.persons.submitReview(id);
    expect([200, 201, 202]).toContain(submitted.status);
    return this.waitForPerson(id, 'active');
  }

  async waitForPerson(id: string, status: Person['status']): Promise<Person> {
    return pollUntil(async () => (await this.api.persons.get(id)).body, (p) => p.status === status, { description: `person ${id} ${status}` });
  }

  /** Opens an account and waits for provisioning to finish. */
  async activeAccount(personId?: string): Promise<Account> {
    const owner = personId ?? (await this.activeCustomer()).id;
    const res = await this.api.accounts.create(owner);
    expectStatus(res, 201);
    return this.waitForAccount(res.body.id, (a) => a.status === 'active');
  }

  async waitForAccount(id: string, predicate: (a: Account) => boolean, description = 'account condition'): Promise<Account> {
    return pollUntil(async () => (await this.api.accounts.get(id)).body, predicate, { description: `${id}: ${description}` });
  }

  /** Active account funded through a simulated deposit, waits until the money is spendable. */
  async fundedAccount(amountMinor: MinorUnits, personId?: string): Promise<Account> {
    const account = await this.activeAccount(personId);
    expectStatus(await this.api.sandbox.deposit(account.id, amountMinor), 202);
    return this.waitForAccount(account.id, (a) => a.balance.available_minor === amountMinor, `available = ${amountMinor}`);
  }

  async counterparty(personId: string, customise: (b: CounterpartyBuilder) => CounterpartyBuilder = (b) => b): Promise<Counterparty> {
    const res = await this.api.counterparties.create(customise(aCounterpartyFor(personId)).build());
    expectStatus(res, 201);
    return res.body;
  }

  async waitForTransfer(id: string, ...statuses: TransferStatus[]): Promise<Transfer> {
    return pollUntil(async () => (await this.api.transfers.get(id)).body, (t) => statuses.includes(t.status), {
      description: `transfer ${id} in [${statuses.join(', ')}]`,
    });
  }
}

type Fixtures = { api: RootsApi; otherClientApi: RootsApi; world: World };
type WorkerFixtures = { billingReady: void };

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Sandbox: new clients start below the billing minimum, so top up once per worker.
  billingReady: [async ({}, use) => {
    const ctx = await pwRequest.newContext({ baseURL: env.baseURL });
    await new RootsApi(ctx, env.token).sandbox.topUpBilling('10000000');
    await ctx.dispose();
    await use();
  }, { scope: 'worker', auto: true }],

  api: async ({}, use) => {
    const ctx = await pwRequest.newContext({ baseURL: env.baseURL });
    await use(new RootsApi(ctx, env.token));
    await ctx.dispose();
  },
  otherClientApi: async ({}, use) => {
    const ctx = await pwRequest.newContext({ baseURL: env.baseURL });
    await use(new RootsApi(ctx, env.otherClientToken));
    await ctx.dispose();
  },
  world: async ({ api }, use) => { await use(new World(api)); },
});

export { expect };
