"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
class NegotiationState {
    context;
    constructor(context) {
        this.context = context;
    }
    async persistTransition(params) {
        const { negotiation, repositories, transactionManager } = this.context;
        if (negotiation.status !== this.getStatus()) {
            throw new ConflictError_1.ConflictError(`State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`);
        }
        const runWith = async (trx) => {
            await repositories.negotiations.updateStatusWithOptimisticLock({
                id: negotiation.id,
                fromStatus: negotiation.status,
                toStatus: params.toStatus,
                expectedVersion: negotiation.version,
                actorId: params.actorId,
                metadata: params.metadata ?? null,
                trx,
            });
            return {
                ...negotiation,
                status: params.toStatus,
                version: negotiation.version + 1,
            };
        };
        if (params.trx) {
            return runWith(params.trx);
        }
        return transactionManager.run(runWith);
    }
}
exports.NegotiationState = NegotiationState;
