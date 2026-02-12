import { ConflictError } from '../errors/ConflictError';
import { ValidationError } from '../errors/ValidationError';
import {
  NegotiationSnapshot,
  NegotiationState,
  NegotiationStateContext,
  NegotiationStatus,
} from './NegotiationState';

export class ContractDraftingState extends NegotiationState {
  constructor(context: NegotiationStateContext) {
    super(context);
    this.assertCanEnter();
  }

  getStatus(): NegotiationStatus {
    return 'CONTRACT_DRAFTING';
  }

  protected assertCanEnter(): void {
    const { sellingBrokerId } = this.context.negotiation;
    if (!sellingBrokerId) {
      throw new ValidationError('selling_broker_id is required before Contract Drafting.');
    }
  }

  async uploadFinalContract(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    return this.persistTransition({
      toStatus: 'AWAITING_SIGNATURES',
      actorId,
      metadata: {
        action: 'contract_uploaded',
        ...(metadata ?? {}),
      },
    });
  }

  async cancel(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    return transactionManager.run(async (trx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: 'CANCELLED',
        expectedVersion: negotiation.version,
        actorId,
        metadata: metadata ?? null,
        trx,
      });

      await repositories.properties.markAvailable({
        id: negotiation.propertyId,
        trx,
      });

      return {
        ...negotiation,
        status: 'CANCELLED',
        version: negotiation.version + 1,
      };
    });
  }
}
