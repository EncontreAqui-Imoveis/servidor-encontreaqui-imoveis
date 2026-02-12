import { ConflictError } from '../errors/ConflictError';
import { NegotiationSnapshot, NegotiationState, NegotiationStatus } from './NegotiationState';

export class InNegotiationState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'IN_NEGOTIATION';
  }

  async requestDocumentation(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    return this.persistTransition({
      toStatus: 'DOCUMENTATION_PHASE',
      actorId,
      metadata,
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
