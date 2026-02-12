"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationEventBus = exports.NEGOTIATION_DEAL_CLOSED = void 0;
const events_1 = require("events");
exports.NEGOTIATION_DEAL_CLOSED = 'NEGOTIATION_DEAL_CLOSED';
class NegotiationEventBus extends events_1.EventEmitter {
    emitDealClosed(negotiationId) {
        return this.emit(exports.NEGOTIATION_DEAL_CLOSED, { negotiationId });
    }
    onDealClosed(listener) {
        return this.on(exports.NEGOTIATION_DEAL_CLOSED, listener);
    }
}
exports.NegotiationEventBus = NegotiationEventBus;
