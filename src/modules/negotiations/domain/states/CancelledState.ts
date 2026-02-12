import { NegotiationState, NegotiationStatus } from './NegotiationState';

export class CancelledState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'CANCELLED';
  }
}
