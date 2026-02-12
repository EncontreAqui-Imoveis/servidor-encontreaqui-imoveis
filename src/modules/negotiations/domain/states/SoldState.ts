import type { NegotiationEventBus } from '../events/NegotiationEventBus';
import type { NegotiationRepositories } from './NegotiationState';
import { NegotiationState, NegotiationStatus } from './NegotiationState';

export class SoldState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'SOLD';
  }

  static async updatePropertyStatus<Tx>(params: {
    repositories: NegotiationRepositories<Tx>;
    propertyId: number;
    trx: Tx;
  }): Promise<void> {
    await params.repositories.properties.updateLifecycleStatus({
      id: params.propertyId,
      status: 'SOLD',
      trx: params.trx,
    });
  }

  static emitDealClosed(eventBus: NegotiationEventBus, negotiationId: string): void {
    eventBus.emitDealClosed(negotiationId);
  }
}
