"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwaitingSignaturesState = void 0;
const ConflictError_1 = require("../errors/ConflictError");
const NegotiationState_1 = require("./NegotiationState");
const RentedState_1 = require("./RentedState");
const SoldState_1 = require("./SoldState");
class AwaitingSignaturesState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'AWAITING_SIGNATURES';
    }
    async markSold(actorId, metadata) {
        const { negotiation, repositories, transactionManager, eventBus } = this.context;
        if (negotiation.status !== this.getStatus()) {
            throw new ConflictError_1.ConflictError(`State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`);
        }
        const updated = await transactionManager.run(async (trx) => {
            await repositories.negotiations.updateStatusWithOptimisticLock({
                id: negotiation.id,
                fromStatus: negotiation.status,
                toStatus: 'SOLD',
                expectedVersion: negotiation.version,
                actorId,
                metadata: metadata ?? null,
                trx,
            });
            await SoldState_1.SoldState.updatePropertyStatus({
                repositories,
                propertyId: negotiation.propertyId,
                trx,
            });
            return {
                ...negotiation,
                status: 'SOLD',
                version: negotiation.version + 1,
            };
        });
        SoldState_1.SoldState.emitDealClosed(eventBus, updated.id);
        return updated;
    }
    async markRented(actorId, metadata) {
        const { negotiation, repositories, transactionManager, eventBus } = this.context;
        if (negotiation.status !== this.getStatus()) {
            throw new ConflictError_1.ConflictError(`State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`);
        }
        const updated = await transactionManager.run(async (trx) => {
            await repositories.negotiations.updateStatusWithOptimisticLock({
                id: negotiation.id,
                fromStatus: negotiation.status,
                toStatus: 'RENTED',
                expectedVersion: negotiation.version,
                actorId,
                metadata: metadata ?? null,
                trx,
            });
            await RentedState_1.RentedState.updatePropertyStatus({
                repositories,
                propertyId: negotiation.propertyId,
                trx,
            });
            return {
                ...negotiation,
                status: 'RENTED',
                version: negotiation.version + 1,
            };
        });
        RentedState_1.RentedState.emitDealClosed(eventBus, updated.id);
        return updated;
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
exports.AwaitingSignaturesState = AwaitingSignaturesState;
