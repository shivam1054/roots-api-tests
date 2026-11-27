import { externalId } from '../utils/ids';

/**
 * Builds an individual customer with every field the Roots review needs
 * (see "Onboard an individual"). Override only what a test cares about.
 */
export class PersonBuilder {
  private body: any = {
    type: 'individual',
    role: 'customer',
    external_id: externalId('cust'),
    details: {
      first_name: 'Sam',
      last_name: 'Rivera',
      date_of_birth: '1990-03-14',
      nationality: 'US',
      occupation: 'Software engineer',
      phone: '+12125550123',
      email: 'sam.rivera@example.com',
      tax_number: '123456789',
      tax_number_country: 'US',
    },
    mailing_address: { line1: '200 Park Avenue South', city: 'New York', state: 'New York', postal_code: '10003', country: 'US' },
    financial: {
      primary_source_of_funds: 'Salary',
      expected_transaction_volume: 20,
      expected_transaction_value: '10k_100k',
      total_assets_value: '100k_1m',
      source_of_funds_description: 'Employment income',
    },
    operational: { account_purpose: 'Receiving salary and paying rent' },
  };

  /** Sandbox markers: SANCTIONED-TEST = denied, REFERRED-TEST = manual decision. */
  withLastName(name: string) { this.body.details.last_name = name; return this; }
  sanctioned() { return this.withLastName('SANCTIONED-TEST'); }
  referred() { return this.withLastName('REFERRED-TEST'); }
  without(field: 'date_of_birth' | 'tax_number' | 'email') { delete this.body.details[field]; return this; }
  build() { return structuredClone(this.body); }
}

export const aCustomer = () => new PersonBuilder();
