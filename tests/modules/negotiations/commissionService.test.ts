import { describe, expect, it, vi } from 'vitest';

import { CommissionRulesRepository } from '../../../src/modules/negotiations/infra/CommissionRulesRepository';
import { CommissionService } from '../../../src/modules/negotiations/infra/CommissionService';
import { CommissionsRepository } from '../../../src/modules/negotiations/infra/CommissionsRepository';
import { NegotiationEventBus } from '../../../src/modules/negotiations/domain/events/NegotiationEventBus';

describe('CommissionService', () => {
  it('allocates the total commission to the capturing broker when there is no selling broker', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM negotiations')) {
        return [
          {
            id: 'neg-1',
            final_value: 100000,
            capturing_broker_id: 10,
            selling_broker_id: null,
            seller_client_id: 77,
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
        return { affectedRows: 1 };
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

    await service.handleDealClosed('neg-1');

    const insertCall = execute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO commissions')
    );
    expect(insertCall).toBeTruthy();
    expect(String(insertCall?.[1]?.[0] ?? '')).toContain('neg-1');
  });

  it('catches errors raised by the deal closed event handler', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM negotiations')) {
        throw new Error('boom');
      }
      return { affectedRows: 1 };
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const eventBus = new NegotiationEventBus();
    const transactionManager = {
      run: async <T>(fn: (trx: any) => Promise<T>) => fn({ execute }),
    };

    new CommissionService({
      eventBus,
      transactionManager,
      commissionRulesRepository: new CommissionRulesRepository({ execute } as any),
      commissionsRepository: new CommissionsRepository({ execute } as any),
    });

    eventBus.emitDealClosed('neg-err');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
