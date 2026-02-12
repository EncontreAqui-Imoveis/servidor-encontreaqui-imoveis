"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationStateFactory = void 0;
const ValidationError_1 = require("../errors/ValidationError");
const AwaitingSignaturesState_1 = require("./AwaitingSignaturesState");
const CancelledState_1 = require("./CancelledState");
const ContractDraftingState_1 = require("./ContractDraftingState");
const DocumentationPhaseState_1 = require("./DocumentationPhaseState");
const DraftState_1 = require("./DraftState");
const InNegotiationState_1 = require("./InNegotiationState");
const ProposalSentState_1 = require("./ProposalSentState");
const RentedState_1 = require("./RentedState");
const SoldState_1 = require("./SoldState");
const defaultRegistry = new Map([
    ['PROPOSAL_DRAFT', DraftState_1.DraftState],
    ['PROPOSAL_SENT', ProposalSentState_1.ProposalSentState],
    ['IN_NEGOTIATION', InNegotiationState_1.InNegotiationState],
    ['DOCUMENTATION_PHASE', DocumentationPhaseState_1.DocumentationPhaseState],
    ['CONTRACT_DRAFTING', ContractDraftingState_1.ContractDraftingState],
    ['AWAITING_SIGNATURES', AwaitingSignaturesState_1.AwaitingSignaturesState],
    ['SOLD', SoldState_1.SoldState],
    ['RENTED', RentedState_1.RentedState],
    ['CANCELLED', CancelledState_1.CancelledState],
]);
class NegotiationStateFactory {
    registry;
    constructor(registry = defaultRegistry) {
        this.registry = registry;
    }
    create(context) {
        const constructor = this.registry.get(context.negotiation.status);
        if (!constructor) {
            throw new ValidationError_1.ValidationError(`State not implemented for status ${context.negotiation.status}.`);
        }
        return new constructor(context);
    }
}
exports.NegotiationStateFactory = NegotiationStateFactory;
