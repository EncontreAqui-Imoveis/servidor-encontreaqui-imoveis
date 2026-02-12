"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const ValidationError_1 = require("../errors/ValidationError");
const NegotiationState_1 = require("./NegotiationState");
const ProposalSentState_1 = require("./ProposalSentState");
class DraftState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'PROPOSAL_DRAFT';
    }
    async updateDraft(input) {
        const { negotiation, repositories, transactionManager } = this.context;
        return transactionManager.run(async (trx) => {
            const propertyValue = await repositories.properties.getPropertyValue({
                id: negotiation.propertyId,
                trx,
            });
            if (input.propertyValue !== undefined && input.propertyValue !== propertyValue) {
                throw new ValidationError_1.ValidationError('Property value is read-only and must match the property table.');
            }
            const resolvedSellingBrokerId = input.selfAsSellingBroker
                ? negotiation.capturingBrokerId
                : input.sellingBrokerId ?? null;
            if (!input.selfAsSellingBroker && !resolvedSellingBrokerId) {
                throw new ValidationError_1.ValidationError('Selling broker is required when not self-assigned.');
            }
            const updatedRows = await repositories.negotiations.updateDraftWithOptimisticLock({
                id: negotiation.id,
                expectedVersion: negotiation.version,
                paymentDetails: input.paymentDetails,
                finalValue: input.finalValue ?? null,
                proposalValidityDate: input.proposalValidityDate ?? null,
                sellingBrokerId: resolvedSellingBrokerId,
                trx,
            });
            if (updatedRows === 0) {
                throw new ConflictError_1.ConflictError('Negotiation version conflict.');
            }
            return {
                ...negotiation,
                paymentDetails: input.paymentDetails,
                finalValue: input.finalValue ?? null,
                proposalValidityDate: input.proposalValidityDate ?? null,
                sellingBrokerId: resolvedSellingBrokerId,
                version: negotiation.version + 1,
            };
        });
    }
    async sendProposal(actorId, proposalData, metadata) {
        const updated = await this.persistTransition({
            toStatus: 'PROPOSAL_SENT',
            actorId,
            metadata,
        });
        if (proposalData && this.context.proposalPdfService) {
            const nextState = new ProposalSentState_1.ProposalSentState({
                ...this.context,
                negotiation: updated,
            });
            await nextState.generateAndStorePdf(proposalData);
        }
        return updated;
    }
}
exports.DraftState = DraftState;
