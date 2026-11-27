import type { APIRequestContext } from '@playwright/test';
import { RootsHttp } from '../http/RootsHttp';
import { PersonsClient } from './PersonsClient';
import { DocumentsClient } from './DocumentsClient';
import { AccountsClient } from './AccountsClient';
import { CounterpartiesClient } from './CounterpartiesClient';
import { TransfersClient } from './TransfersClient';
import { SandboxClient } from './SandboxClient';

/** One object per API key: `api.transfers.create(...)`, `api.accounts.get(...)`. */
export class RootsApi {
  readonly http: RootsHttp;
  readonly persons: PersonsClient;
  readonly documents: DocumentsClient;
  readonly accounts: AccountsClient;
  readonly counterparties: CounterpartiesClient;
  readonly transfers: TransfersClient;
  readonly sandbox: SandboxClient;

  constructor(ctx: APIRequestContext, token: string) {
    this.http = new RootsHttp(ctx, token);
    this.persons = new PersonsClient(this.http);
    this.documents = new DocumentsClient(this.http);
    this.accounts = new AccountsClient(this.http);
    this.counterparties = new CounterpartiesClient(this.http);
    this.transfers = new TransfersClient(this.http);
    this.sandbox = new SandboxClient(this.http);
  }
}
