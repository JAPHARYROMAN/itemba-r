import { describe, expect, it } from 'vitest';
import { capabilityIndex, describeToolName } from './msaidizi-client';
import type { MsaidiziCapabilities } from './msaidizi-types';

describe('msaidizi capability labels', () => {
  it('never leaves a raw identifier on screen when the endpoint has not answered', () => {
    expect(describeToolName('SupplierInvoices_findAll')).toBe('Supplier invoices · find all');
    expect(describeToolName('Invoices_remove')).toBe('Invoices · remove');
    expect(describeToolName('Customers')).toBe('Customers');
  });

  it('indexes the reachable capabilities by the name that appears in run events', () => {
    const capabilities = {
      capabilities: [
        {
          name: 'SupplierInvoices_findAll',
          description: 'Looking at supplier invoices',
          tier: 'green',
          path: 'GET /supplier-invoices',
          capabilityId: 'cap_1',
        },
      ],
    } as MsaidiziCapabilities;

    expect(capabilityIndex(capabilities).get('SupplierInvoices_findAll')?.description).toBe(
      'Looking at supplier invoices',
    );
    expect(capabilityIndex(null).size).toBe(0);
  });
});
