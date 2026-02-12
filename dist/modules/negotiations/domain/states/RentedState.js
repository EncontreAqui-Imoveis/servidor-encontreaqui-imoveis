"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RentedState = void 0;
const NegotiationState_1 = require("./NegotiationState");
class RentedState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'RENTED';
    }
    static async updatePropertyStatus(params) {
        await params.repositories.properties.updateLifecycleStatus({
            id: params.propertyId,
            status: 'RENTED',
            trx: params.trx,
        });
    }
    static emitDealClosed(eventBus, negotiationId) {
        eventBus.emitDealClosed(negotiationId);
    }
}
exports.RentedState = RentedState;
