import { externalId } from '../utils/ids';

/** Sandbox account numbers from the Roots "Test scenarios" guide. */
export const SANDBOX_ACCOUNTS = {
  settles: '000123456789',
  failsAtSubmission: '000111111116',
  failsAfterSubmission: '000222222227',
  settlesThenReturnedR03: '000333333335',
} as const;

export class CounterpartyBuilder {
  private body: any;
  constructor(personId: string) {
    this.body = {
      person_id: personId,
      counterparty_type: 'business',
      relationship_to_person: 'customer',
      external_id: externalId('cpty'),
      counterparty_information: {
        business_name: 'Northstar Supplies Inc',
        mailing_address: { line1: '500 Commerce Street', city: 'Dallas', state: 'Texas', postal_code: '75202', country: 'US' },
      },
      external_account_information: {
        supported_rails: ['ach'],
        account_subtype: 'checking',
        routing_number: '021000021',
        account_number: SANDBOX_ACCOUNTS.settles,
        institution_name: 'JPMorgan Chase Bank',
      },
    };
  }
  withAccountNumber(n: string) { this.body.external_account_information.account_number = n; return this; }
  withRails(...rails: string[]) { this.body.external_account_information.supported_rails = rails; return this; }
  sanctioned() { this.body.counterparty_information.business_name = 'SANCTIONED-TEST Trading'; return this; }
  build() { return structuredClone(this.body); }
}

export const aCounterpartyFor = (personId: string) => new CounterpartyBuilder(personId);
