"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentationPhaseState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const ValidationError_1 = require("../errors/ValidationError");
const NegotiationState_1 = require("./NegotiationState");
class DocumentationPhaseState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'DOCUMENTATION_PHASE';
    }
    async moveToContractDrafting(actorId, metadata) {
        const { negotiation, repositories, transactionManager } = this.context;
        return transactionManager.run(async (trx) => {
            if (!negotiation.sellingBrokerId) {
                throw new ValidationError_1.ValidationError('selling_broker_id is required before Contract Drafting.');
            }
            const { pendingOrRejected, approved } = await repositories.negotiationDocuments.countPendingOrRejected({
                negotiationId: negotiation.id,
                trx,
            });
            if (pendingOrRejected > 0 || approved === 0) {
                throw new ValidationError_1.ValidationError('All required documents must be approved before Contract Drafting.');
            }
            return this.persistTransition({
                toStatus: 'CONTRACT_DRAFTING',
                actorId,
                metadata,
                trx,
            });
        });
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
exports.DocumentationPhaseState = DocumentationPhaseState;
