import { describe, expect, it, vi } from 'vitest';

import { CommissionRulesRepository } from '../../../src/modules/negotiations/infra/CommissionRulesRepository';
import { CommissionService } from '../../../src/modules/negotiations/infra/CommissionService';
import { CommissionsRepository } from '../../../src/modules/negotiations/infra/CommissionsRepository';
import { NegotiationEventBus } from '../../../src/modules/negotiations/domain/events/NegotiationEventBus';

describe('CommissionService stress', () => {
  it(
    'handles multiple deal closed events concurrently',
    async () => {
      const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM negotiations')) {
        return [
          {
            id: 'neg-1',
            final_value: 100000,
            capturing_broker_id: 10,
            selling_broker_id: 20,
          },
        ];
      }
      if (sql.includes('FROM commission_rules')) {
        return [
          {
            capturing_percentage: 2,
            selling_percentage: 3,
            total_percentage: 5,
          },
        ];
      }
      if (sql.includes('INSERT INTO commissions')) {
        return { affectedRows: 2 };
      }
      return { affectedRows: 1 };
    });

    const transactionManager = {
      run: async <T>(fn: (trx: any) => Promise<T>) => fn({ execute }),
    };

    const service = new CommissionService({
      eventBus: new NegotiationEventBus(),
      transactionManager,
      commissionRulesRepository: new CommissionRulesRepository({ execute } as any),
      commissionsRepository: new CommissionsRepository({ execute } as any),
    });

    const tasks = Array.from({ length: 200 }, () => service.handleDealClosed('neg-1'));
    await Promise.all(tasks);

    expect(execute).toHaveBeenCalled();
    },
    60000
  );
});
