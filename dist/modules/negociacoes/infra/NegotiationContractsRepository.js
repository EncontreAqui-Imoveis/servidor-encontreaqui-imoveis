"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationContractsRepository = void 0;
const db_1 = require("./db");
class NegotiationContractsRepository {
    db;
    constructor(db = (0, db_1.getDefaultQueryRunner)()) {
        this.db = db;
    }
    async create(params) {
        const [versionRows] = await this.db.query('SELECT MAX(version) AS latest FROM negotiation_contracts WHERE negotiation_id = ?', [params.negotiationId]);
        const nextVersion = (versionRows[0]?.latest ?? 0) + 1;
        const [result] = await this.db.query(`
      INSERT INTO negotiation_contracts (negotiation_id, version, contract_url, uploaded_by_admin_id)
      VALUES (?, ?, ?, ?)
      `, [params.negotiationId, nextVersion, params.contractUrl, params.uploadedByAdminId]);
        return { id: result.insertId, version: nextVersion };
    }
    async latestByNegotiationId(negotiationId) {
        const [rows] = await this.db.query(`
      SELECT *
      FROM negotiation_contracts
      WHERE negotiation_id = ?
      ORDER BY version DESC
      LIMIT 1
      `, [negotiationId]);
        return rows[0] ?? null;
    }
}
exports.NegotiationContractsRepository = NegotiationContractsRepository;
