"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalSentState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const ValidationError_1 = require("../errors/ValidationError");
const NegotiationState_1 = require("./NegotiationState");
class ProposalSentState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'PROPOSAL_SENT';
    }
    async approveProposal(actorId, metadata) {
        const { negotiation, repositories, transactionManager } = this.context;
        if (negotiation.status !== this.getStatus()) {
            throw new ConflictError_1.ConflictError(`State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`);
        }
        return transactionManager.run(async (trx) => {
            await repositories.negotiations.updateStatusWithOptimisticLock({
                id: negotiation.id,
                fromStatus: negotiation.status,
                toStatus: 'IN_NEGOTIATION',
                expectedVersion: negotiation.version,
                actorId,
                metadata: metadata ?? null,
                trx,
            });
            await repositories.properties.markUnderNegotiation({
                id: negotiation.propertyId,
                trx,
            });
            return {
                ...negotiation,
                status: 'IN_NEGOTIATION',
                version: negotiation.version + 1,
            };
        });
    }
    async generateAndStorePdf(data) {
        const pdfService = this.context.proposalPdfService;
        if (!pdfService) {
            throw new ValidationError_1.ValidationError('ProposalPdfService is not configured.');
        }
        const pdfBuffer = await pdfService.generateProposal(data);
        const negotiationId = String(this.context.negotiation.id ?? '').trim();
        if (!negotiationId) {
            throw new ValidationError_1.ValidationError('Negotiation id is required to persist proposal PDF.');
        }
        await this.context.repositories.negotiationDocuments.saveProposal(negotiationId, pdfBuffer);
    }
    async cancel(actorId, metadata) {
        const { negotiation, repositories, transactionManager } = this.context;
        if (negotiation.status !== this.getStatus()) {
            throw new ConflictError_1.ConflictError(`State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`);
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
exports.ProposalSentState = ProposalSentState;
