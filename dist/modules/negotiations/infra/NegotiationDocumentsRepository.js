"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationDocumentsRepository = void 0;
const toRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) {
        return result[0];
    }
    return result;
};
class NegotiationDocumentsRepository {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    async countPendingOrRejected(params) {
        const executor = params.trx ?? this.executor;
        const sql = `
      SELECT
        SUM(CASE WHEN status IN ('PENDING', 'REJECTED') THEN 1 ELSE 0 END) AS pending_or_rejected,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved
      FROM negotiation_documents
      WHERE negotiation_id = ?
    `;
        const rows = toRows(await executor.execute(sql, [params.negotiationId]));
        const row = rows?.[0];
        return {
            pendingOrRejected: Number(row?.pending_or_rejected ?? 0),
            approved: Number(row?.approved ?? 0),
        };
    }
    async findById(documentId, trx) {
        const executor = trx ?? this.executor;
        const sql = `
      SELECT file_content, type
      FROM negotiation_documents
      WHERE id = ?
      LIMIT 1
    `;
        const rows = toRows(await executor.execute(sql, [documentId]));
        const row = rows?.[0];
        if (!row?.file_content) {
            return null;
        }
        const fileContent = Buffer.isBuffer(row.file_content)
            ? row.file_content
            : Buffer.from(row.file_content);
        return {
            fileContent,
            type: row.type,
        };
    }
    async saveProposal(negotiationId, pdfBuffer, trx) {
        const executor = trx ?? this.executor;
        const sql = `
      INSERT INTO negotiation_documents (negotiation_id, type, file_content)
      VALUES (?, 'proposal', ?)
    `;
        await executor.execute(sql, [negotiationId, pdfBuffer]);
    }
}
exports.NegotiationDocumentsRepository = NegotiationDocumentsRepository;
