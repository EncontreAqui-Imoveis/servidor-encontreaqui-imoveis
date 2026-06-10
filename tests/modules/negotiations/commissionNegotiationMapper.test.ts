import { describe, expect, it } from 'vitest';

import { mapCommissionNegotiationRow } from '../../../src/modules/negotiations/infra/commissionNegotiationMapper';

describe('commissionNegotiationMapper', () => {
  it('maps sql negotiation rows to normalized commission input', () => {
    expect(
      mapCommissionNegotiationRow({
        final_value: '120000.50',
        capturing_broker_id: '10',
        selling_broker_id: null,
      })
    ).toEqual({
      finalValue: 120000.5,
      capturingBrokerId: 10,
      sellingBrokerId: null,
    });
  });

  it('rejects rows with invalid numeric content', () => {
    expect(() =>
      mapCommissionNegotiationRow({
        final_value: 'abc',
        capturing_broker_id: '10',
        selling_broker_id: null,
      })
    ).toThrow('Invalid negotiation row for commission calculation.');
  });

  it('rejects rows without a final value', () => {
    expect(() =>
      mapCommissionNegotiationRow({
        final_value: null,
        capturing_broker_id: '10',
        selling_broker_id: null,
      })
    ).toThrow('final_value is required to calculate commissions.');
  });
});
