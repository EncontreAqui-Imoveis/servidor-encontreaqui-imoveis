import { EventEmitter } from 'events';

export const NEGOTIATION_DEAL_CLOSED = 'NEGOTIATION_DEAL_CLOSED' as const;

export interface NegotiationDealClosedPayload {
  negotiationId: string;
}

export class NegotiationEventBus extends EventEmitter {
  emitDealClosed(negotiationId: string): boolean {
    return this.emit(NEGOTIATION_DEAL_CLOSED, { negotiationId });
  }

  onDealClosed(listener: (payload: NegotiationDealClosedPayload) => void): this {
    return this.on(NEGOTIATION_DEAL_CLOSED, listener);
  }
}
