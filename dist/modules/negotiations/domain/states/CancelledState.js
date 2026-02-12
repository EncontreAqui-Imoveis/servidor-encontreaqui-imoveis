"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelledState = void 0;
const NegotiationState_1 = require("./NegotiationState");
class CancelledState extends NegotiationState_1.NegotiationState {
    getStatus() {
        return 'CANCELLED';
    }
}
exports.CancelledState = CancelledState;
