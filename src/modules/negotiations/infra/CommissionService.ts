import { ValidationError } from '../domain/errors/ValidationError';
import type { NegotiationEventBus } from '../domain/events/NegotiationEventBus';
import type { TransactionManager } from '../domain/states/NegotiationState';
import type { CommissionRule } from './CommissionRulesRepository';
import { CommissionRulesRepository } from './CommissionRulesRepository';
import { CommissionsRepository, type CommissionInsert } from './CommissionsRepository';
import type { SqlExecutor } from './NegotiationRepository';

interface NegotiationRow {
  id: string;
  final_value: number | string | null;
  capturing_broker_id: number;
  selling_broker_id: number | null;
}

const toRows = <T>(result: T[] | [T[], unknown]): T[] => {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return result as T[];
};

export class CommissionService {
  private readonly eventBus: NegotiationEventBus;
  private readonly transactionManager: TransactionManager<SqlExecutor>;
  private readonly commissionRulesRepository: CommissionRulesRepository;
  private readonly commissionsRepository: CommissionsRepository;

  constructor(params: {
    eventBus: NegotiationEventBus;
    transactionManager: TransactionManager<SqlExecutor>;
    commissionRulesRepository: CommissionRulesRepository;
    commissionsRepository: CommissionsRepository;
  }) {
    this.eventBus = params.eventBus;
    this.transactionManager = params.transactionManager;
    this.commissionRulesRepository = params.commissionRulesRepository;
    this.commissionsRepository = params.commissionsRepository;

    this.eventBus.onDealClosed((payload) => {
      void this.handleDealClosed(payload.negotiationId);
    });
  }

  async handleDealClosed(negotiationId: string): Promise<void> {
    await this.transactionManager.run(async (trx) => {
      const negotiation = await this.fetchNegotiation(trx, negotiationId);
      const rule = await this.fetchActiveRule(trx);
      const commissions = this.calculateCommissions(negotiation, rule);

      if (commissions.length === 0) {
        return;
      }

      await this.insertCommissions(trx, negotiation.id, commissions);
    });
  }

  private async fetchNegotiation(trx: SqlExecutor, negotiationId: string): Promise<NegotiationRow> {
    const sql = `
      SELECT id, final_value, capturing_broker_id, selling_broker_id
      FROM negotiations
      WHERE id = ?
      LIMIT 1
    `;

    const rows = toRows<NegotiationRow>(
      await trx.execute<NegotiationRow[]>(sql, [negotiationId])
    );

    const negotiation = rows?.[0];
    if (!negotiation) {
      throw new ValidationError('Negotiation not found for commission calculation.');
    }

    return negotiation;
  }

  private async fetchActiveRule(trx: SqlExecutor): Promise<CommissionRule> {
    return this.commissionRulesRepository.getActiveRule({ trx });
  }

  private calculateCommissions(
    negotiation: NegotiationRow,
    rule: CommissionRule
  ): CommissionInsert[] {
    const finalValue = Number(negotiation.final_value ?? 0);
    if (!Number.isFinite(finalValue) || finalValue <= 0) {
      throw new ValidationError('final_value is required to calculate commissions.');
    }

    const capturingPercentage = rule.capturingPercentage;
    const sellingPercentage = rule.sellingPercentage;
    const totalPercentage = rule.totalPercentage;

    if (negotiation.selling_broker_id === null) {
      throw new ValidationError('selling_broker_id is required to calculate commissions.');
    }

    if (negotiation.capturing_broker_id === negotiation.selling_broker_id) {
      return [
        {
          brokerId: negotiation.capturing_broker_id,
          role: 'CAPTURING',
          amount: Number(((finalValue * totalPercentage) / 100).toFixed(2)),
        },
      ];
    }

    return [
      {
        brokerId: negotiation.capturing_broker_id,
        role: 'CAPTURING',
        amount: Number(((finalValue * capturingPercentage) / 100).toFixed(2)),
      },
      {
        brokerId: negotiation.selling_broker_id,
        role: 'SELLING',
        amount: Number(((finalValue * sellingPercentage) / 100).toFixed(2)),
      },
    ];
  }

  private async insertCommissions(
    trx: SqlExecutor,
    negotiationId: string,
    commissions: CommissionInsert[]
  ): Promise<void> {
    await this.commissionsRepository.insertMany({
      negotiationId,
      commissions,
      trx,
    });
  }
}
