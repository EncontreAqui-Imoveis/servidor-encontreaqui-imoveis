import { ConflictError } from '../errors/ConflictError';
import { ValidationError } from '../errors/ValidationError';
import { NegotiationSnapshot, NegotiationState, NegotiationStatus } from './NegotiationState';

export class DocumentationPhaseState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'DOCUMENTATION_PHASE';
  }

  async moveToContractDrafting(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    return transactionManager.run(async (trx) => {
      if (!negotiation.sellingBrokerId) {
        throw new ValidationError('selling_broker_id is required before Contract Drafting.');
      }

      const { pendingOrRejected, approved } =
        await repositories.negotiationDocuments.countPendingOrRejected({
          negotiationId: negotiation.id,
          trx,
        });

      if (pendingOrRejected > 0 || approved === 0) {
        throw new ValidationError(
          'All required documents must be approved before Contract Drafting.'
        );
      }

      return this.persistTransition({
        toStatus: 'CONTRACT_DRAFTING',
        actorId,
        metadata,
        trx,
      });
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
