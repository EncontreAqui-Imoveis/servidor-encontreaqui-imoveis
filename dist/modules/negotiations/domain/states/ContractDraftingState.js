"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractDraftingState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const ValidationError_1 = require("../errors/ValidationError");
const NegotiationState_1 = require("./NegotiationState");
class ContractDraftingState extends NegotiationState_1.NegotiationState {
    constructor(context) {
        super(context);
        this.assertCanEnter();
    }
    getStatus() {
        return 'CONTRACT_DRAFTING';
    }
    assertCanEnter() {
        const { sellingBrokerId } = this.context.negotiation;
        if (!sellingBrokerId) {
            throw new ValidationError_1.ValidationError('selling_broker_id is required before Contract Drafting.');
        }
    }
    async uploadFinalContract(actorId, metadata) {
        return this.persistTransition({
            toStatus: 'AWAITING_SIGNATURES',
            actorId,
            metadata: {
                action: 'contract_uploaded',
                ...(metadata ?? {}),
            },
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
exports.ContractDraftingState = ContractDraftingState;
