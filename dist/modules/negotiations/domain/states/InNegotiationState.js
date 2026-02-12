"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InNegotiationState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const NegotiationState_1 = require("./NegotiationState");
class InNegotiationState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'IN_NEGOTIATION';
    }
    async requestDocumentation(actorId, metadata) {
        return this.persistTransition({
            toStatus: 'DOCUMENTATION_PHASE',
            actorId,
            metadata,
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
exports.InNegotiationState = InNegotiationState;
