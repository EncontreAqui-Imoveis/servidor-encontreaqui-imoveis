import { describe, expect, it } from 'vitest';

import { calculateCommissions } from '../../../src/modules/negotiations/infra/commissionCalculation';

describe('commissionCalculation', () => {
  it('assigns the total commission to the capturing broker when there is no selling broker', () => {
    const commissions = calculateCommissions(
      {
        finalValue: 100000,
        capturingBrokerId: 10,
        sellingBrokerId: null,
      },
      {
        capturingPercentage: 2,
        sellingPercentage: 3,
        totalPercentage: 5,
      }
    );

    expect(commissions).toEqual([
      {
        brokerId: 10,
        role: 'CAPTURING',
        amount: 5000,
      },
    ]);
  });

  it('assigns the total commission to the capturing broker when both brokers are the same', () => {
    const commissions = calculateCommissions(
      {
        finalValue: 200000,
        capturingBrokerId: 10,
        sellingBrokerId: 10,
      },
      {
        capturingPercentage: 2,
        sellingPercentage: 3,
        totalPercentage: 5,
      }
    );

    expect(commissions).toEqual([
      {
        brokerId: 10,
        role: 'CAPTURING',
        amount: 10000,
      },
    ]);
  });

  it('splits commissions between brokers when they are distinct', () => {
    const commissions = calculateCommissions(
      {
        finalValue: 100000,
        capturingBrokerId: 10,
        sellingBrokerId: 20,
      },
      {
        capturingPercentage: 2,
        sellingPercentage: 3,
        totalPercentage: 5,
      }
    );

    expect(commissions).toEqual([
      {
        brokerId: 10,
        role: 'CAPTURING',
        amount: 2000,
      },
      {
        brokerId: 20,
        role: 'SELLING',
        amount: 3000,
      },
    ]);
  });
});
