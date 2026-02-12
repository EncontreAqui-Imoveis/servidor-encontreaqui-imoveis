import { ConflictError } from '../errors/ConflictError';
import { NegotiationSnapshot, NegotiationState, NegotiationStatus } from './NegotiationState';
import { RentedState } from './RentedState';
import { SoldState } from './SoldState';

export class AwaitingSignaturesState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'AWAITING_SIGNATURES';
  }

  async markSold(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager, eventBus } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    const updated = await transactionManager.run(async (trx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: 'SOLD',
        expectedVersion: negotiation.version,
        actorId,
        metadata: metadata ?? null,
        trx,
      });

      await SoldState.updatePropertyStatus({
        repositories,
        propertyId: negotiation.propertyId,
        trx,
      });

      return {
        ...negotiation,
        status: 'SOLD' as NegotiationStatus,
        version: negotiation.version + 1,
      };
    });

    SoldState.emitDealClosed(eventBus, updated.id);

    return updated;
  }

  async markRented(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager, eventBus } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    const updated = await transactionManager.run(async (trx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: 'RENTED',
        expectedVersion: negotiation.version,
        actorId,
        metadata: metadata ?? null,
        trx,
      });

      await RentedState.updatePropertyStatus({
        repositories,
        propertyId: negotiation.propertyId,
        trx,
      });

      return {
        ...negotiation,
        status: 'RENTED' as NegotiationStatus,
        version: negotiation.version + 1,
      };
    });

    RentedState.emitDealClosed(eventBus, updated.id);

    return updated;
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
