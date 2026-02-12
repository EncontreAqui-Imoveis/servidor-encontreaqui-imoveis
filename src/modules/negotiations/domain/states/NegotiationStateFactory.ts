import { ValidationError } from '../errors/ValidationError';
import { AwaitingSignaturesState } from './AwaitingSignaturesState';
import { CancelledState } from './CancelledState';
import { ContractDraftingState } from './ContractDraftingState';
import { DocumentationPhaseState } from './DocumentationPhaseState';
import { DraftState } from './DraftState';
import { InNegotiationState } from './InNegotiationState';
import { ProposalSentState } from './ProposalSentState';
import { RentedState } from './RentedState';
import { SoldState } from './SoldState';
import { NegotiationState, NegotiationStateContext, NegotiationStatus } from './NegotiationState';

type StateConstructor = new (context: NegotiationStateContext) => NegotiationState;

const defaultRegistry = new Map<NegotiationStatus, StateConstructor>([
  ['PROPOSAL_DRAFT', DraftState],
  ['PROPOSAL_SENT', ProposalSentState],
  ['IN_NEGOTIATION', InNegotiationState],
  ['DOCUMENTATION_PHASE', DocumentationPhaseState],
  ['CONTRACT_DRAFTING', ContractDraftingState],
  ['AWAITING_SIGNATURES', AwaitingSignaturesState],
  ['SOLD', SoldState],
  ['RENTED', RentedState],
  ['CANCELLED', CancelledState],
]);

export class NegotiationStateFactory {
  private readonly registry: Map<NegotiationStatus, StateConstructor>;

  constructor(registry: Map<NegotiationStatus, StateConstructor> = defaultRegistry) {
    this.registry = registry;
  }

  create(context: NegotiationStateContext): NegotiationState {
    const constructor = this.registry.get(context.negotiation.status);
    if (!constructor) {
      throw new ValidationError(`State not implemented for status ${context.negotiation.status}.`);
    }
    return new constructor(context);
  }
}
