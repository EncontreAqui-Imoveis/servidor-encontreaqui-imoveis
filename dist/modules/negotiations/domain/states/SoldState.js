"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SoldState = void 0;
const NegotiationState_1 = require("./NegotiationState");
class SoldState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'SOLD';
    }
    static async updatePropertyStatus(params) {
        await params.repositories.properties.updateLifecycleStatus({
            id: params.propertyId,
            status: 'SOLD',
            trx: params.trx,
        });
    }
    static emitDealClosed(eventBus, negotiationId) {
        eventBus.emitDealClosed(negotiationId);
    }
}
exports.SoldState = SoldState;
