import type { NegotiationEventBus } from '../events/NegotiationEventBus';
import type { NegotiationRepositories } from './NegotiationState';
import { NegotiationState, NegotiationStatus } from './NegotiationState';

export class RentedState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'RENTED';
  }

  static async updatePropertyStatus<Tx>(params: {
    repositories: NegotiationRepositories<Tx>;
    propertyId: number;
    trx: Tx;
  }): Promise<void> {
    await params.repositories.properties.updateLifecycleStatus({
      id: params.propertyId,
      status: 'RENTED',
      trx: params.trx,
    });
  }

  static emitDealClosed(eventBus: NegotiationEventBus, negotiationId: string): void {
    eventBus.emitDealClosed(negotiationId);
  }
}
