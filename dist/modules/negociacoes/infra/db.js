"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultQueryRunner = getDefaultQueryRunner;
const connection_1 = __importDefault(require("../../../database/connection"));
function getDefaultQueryRunner() {
    return connection_1.default;
}
