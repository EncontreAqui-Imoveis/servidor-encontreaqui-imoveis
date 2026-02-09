"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationContractsRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class NegotiationContractsRepository {
    async create(data, conn) {
        const db = conn || connection_1.default;
        const [result] = await db.query(`INSERT INTO negotiation_contracts 
       (negotiation_id, version, contract_url, uploaded_by_admin_id)
       VALUES (?, ?, ?, ?)`, [data.negotiation_id, data.version, data.contract_url, data.uploaded_by_admin_id]);
        return result.insertId;
    }
    async findLatestByNegotiationId(negotiationId) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_contracts WHERE negotiation_id = ? ORDER BY version DESC LIMIT 1', [negotiationId]);
        if (rows.length === 0)
            return null;
        return rows[0];
    }
}
exports.NegotiationContractsRepository = NegotiationContractsRepository;
