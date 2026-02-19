"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
const contract_types_1 = require("../modules/contracts/domain/contract.types");
const ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT = new Set([
    'IN_NEGOTIATION',
    'DOCUMENTATION_PHASE',
    'CONTRACT_DRAFTING',
    'AWAITING_SIGNATURES',
    'SOLD',
    'RENTED',
]);
function normalizeJsonObject(value, fieldName, options) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed && options?.emptyStringAsNull) {
            return null;
        }
        if (!trimmed) {
            throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
            throw new Error();
        }
        catch {
            throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
}
function parseStoredJsonObject(value) {
    if (value == null) {
        return {};
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
            return {};
        }
        catch {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function toIsoString(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
function resolveContractStatus(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if ((0, contract_types_1.isContractStatus)(normalized)) {
        return normalized;
    }
    return 'AWAITING_DOCS';
}
function mapContract(row) {
    return {
        id: row.id,
        negotiationId: row.negotiation_id,
        propertyId: Number(row.property_id),
        status: resolveContractStatus(row.status),
        sellerInfo: parseStoredJsonObject(row.seller_info),
        buyerInfo: parseStoredJsonObject(row.buyer_info),
        commissionData: parseStoredJsonObject(row.commission_data),
        capturingBrokerId: row.capturing_broker_id !== null ? Number(row.capturing_broker_id) : null,
        sellingBrokerId: row.selling_broker_id !== null ? Number(row.selling_broker_id) : null,
        propertyTitle: row.property_title ?? null,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}
function mapDocument(row) {
    return {
        id: Number(row.id),
        type: row.type,
        documentType: row.document_type,
        createdAt: toIsoString(row.created_at),
    };
}
function canAccessContract(req, contract) {
    const role = String(req.userRole ?? '').toLowerCase();
    if (role === 'admin') {
        return true;
    }
    if (role !== 'broker') {
        return false;
    }
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
        return false;
    }
    return (userId === Number(contract.capturing_broker_id ?? 0) ||
        userId === Number(contract.selling_broker_id ?? 0));
}
function canEditSellerSide(req, contract) {
    const role = String(req.userRole ?? '').toLowerCase();
    if (role === 'admin') {
        return true;
    }
    const userId = Number(req.userId);
    return Number.isFinite(userId) && userId > 0 && userId === Number(contract.capturing_broker_id ?? 0);
}
function canEditBuyerSide(req, contract) {
    const role = String(req.userRole ?? '').toLowerCase();
    if (role === 'admin') {
        return true;
    }
    const userId = Number(req.userId);
    return Number.isFinite(userId) && userId > 0 && userId === Number(contract.selling_broker_id ?? 0);
}
function isDoubleEndedDeal(contract) {
    if (contract.capturing_broker_id == null || contract.selling_broker_id == null) {
        return false;
    }
    return Number(contract.capturing_broker_id) === Number(contract.selling_broker_id);
}
async function fetchContractForUpdate(tx, contractId) {
    const [rows] = await tx.query(`
      SELECT
        c.id,
        c.negotiation_id,
        c.property_id,
        c.status,
        c.seller_info,
        c.buyer_info,
        c.commission_data,
        c.created_at,
        c.updated_at,
        n.capturing_broker_id,
        n.selling_broker_id,
        p.title AS property_title
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      JOIN properties p ON p.id = c.property_id
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `, [contractId]);
    return rows[0] ?? null;
}
class ContractController {
    async createFromApprovedNegotiation(req, res) {
        const negotiationId = String(req.params.id ?? '').trim();
        if (!negotiationId) {
            return res.status(400).json({ error: 'ID da negociação inválido.' });
        }
        const tx = await connection_1.default.getConnection();
        try {
            await tx.beginTransaction();
            const [negotiationRows] = await tx.query(`
          SELECT
            n.id,
            n.property_id,
            n.status,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `, [negotiationId]);
            const negotiation = negotiationRows[0];
            if (!negotiation) {
                await tx.rollback();
                return res.status(404).json({ error: 'Negociação não encontrada.' });
            }
            const negotiationStatus = String(negotiation.status ?? '').toUpperCase();
            if (!ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT.has(negotiationStatus)) {
                await tx.rollback();
                return res.status(400).json({
                    error: 'A negociação precisa estar aprovada antes da criação do contrato.',
                });
            }
            const [existingRows] = await tx.query(`
          SELECT id, status
          FROM contracts
          WHERE negotiation_id = ?
          LIMIT 1
          FOR UPDATE
        `, [negotiationId]);
            if (existingRows.length > 0) {
                await tx.commit();
                return res.status(200).json({
                    message: 'Contrato já existente para esta negociação.',
                    contract: {
                        id: existingRows[0].id,
                        negotiationId,
                        propertyId: Number(negotiation.property_id),
                        status: resolveContractStatus(existingRows[0].status),
                    },
                });
            }
            await tx.query(`
          INSERT INTO contracts (
            id,
            negotiation_id,
            property_id,
            status,
            seller_info,
            buyer_info,
            commission_data,
            created_at,
            updated_at
          ) VALUES (
            UUID(),
            ?,
            ?,
            'AWAITING_DOCS',
            NULL,
            NULL,
            NULL,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `, [negotiationId, negotiation.property_id]);
            const [createdRows] = await tx.query(`
          SELECT
            c.id,
            c.negotiation_id,
            c.property_id,
            c.status,
            c.seller_info,
            c.buyer_info,
            c.commission_data,
            c.created_at,
            c.updated_at,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title
          FROM contracts c
          JOIN negotiations n ON n.id = c.negotiation_id
          JOIN properties p ON p.id = c.property_id
          WHERE c.negotiation_id = ?
          LIMIT 1
        `, [negotiationId]);
            await tx.commit();
            return res.status(201).json({
                message: 'Contrato criado com sucesso.',
                contract: createdRows[0] ? mapContract(createdRows[0]) : null,
            });
        }
        catch (error) {
            await tx.rollback();
            console.error('Erro ao criar contrato a partir da negociação:', error);
            return res.status(500).json({ error: 'Falha ao criar contrato.' });
        }
        finally {
            tx.release();
        }
    }
    async getById(req, res) {
        const contractId = String(req.params.id ?? '').trim();
        if (!contractId) {
            return res.status(400).json({ error: 'ID do contrato inválido.' });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            c.id,
            c.negotiation_id,
            c.property_id,
            c.status,
            c.seller_info,
            c.buyer_info,
            c.commission_data,
            c.created_at,
            c.updated_at,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title
          FROM contracts c
          JOIN negotiations n ON n.id = c.negotiation_id
          JOIN properties p ON p.id = c.property_id
          WHERE c.id = ?
          LIMIT 1
        `, [contractId]);
            const contract = rows[0];
            if (!contract) {
                return res.status(404).json({ error: 'Contrato não encontrado.' });
            }
            if (!canAccessContract(req, contract)) {
                return res.status(403).json({ error: 'Acesso negado ao contrato.' });
            }
            const [documents] = await connection_1.default.query(`
          SELECT id, type, document_type, created_at
          FROM negotiation_documents
          WHERE negotiation_id = ?
          ORDER BY created_at DESC, id DESC
        `, [contract.negotiation_id]);
            return res.status(200).json({
                contract: mapContract(contract),
                documents: documents.map(mapDocument),
            });
        }
        catch (error) {
            console.error('Erro ao buscar contrato:', error);
            return res.status(500).json({ error: 'Falha ao buscar contrato.' });
        }
    }
    async updateData(req, res) {
        const contractId = String(req.params.id ?? '').trim();
        if (!contractId) {
            return res.status(400).json({ error: 'ID do contrato inválido.' });
        }
        const body = (req.body ?? {});
        let sellerPatch = null;
        let buyerPatch = null;
        try {
            sellerPatch = normalizeJsonObject(body.sellerInfo ?? body.seller_info, 'sellerInfo', {
                emptyStringAsNull: true,
            });
            buyerPatch = normalizeJsonObject(body.buyerInfo ?? body.buyer_info, 'buyerInfo', {
                emptyStringAsNull: true,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Payload inválido.';
            return res.status(400).json({ error: message });
        }
        if (!sellerPatch && !buyerPatch) {
            return res.status(400).json({
                error: 'Informe ao menos sellerInfo ou buyerInfo para atualização.',
            });
        }
        const tx = await connection_1.default.getConnection();
        try {
            await tx.beginTransaction();
            const contract = await fetchContractForUpdate(tx, contractId);
            if (!contract) {
                await tx.rollback();
                return res.status(404).json({ error: 'Contrato não encontrado.' });
            }
            if (!canAccessContract(req, contract)) {
                await tx.rollback();
                return res.status(403).json({ error: 'Acesso negado ao contrato.' });
            }
            const doubleEnded = isDoubleEndedDeal(contract);
            const canEditSeller = canEditSellerSide(req, contract);
            const canEditBuyer = canEditBuyerSide(req, contract);
            if (sellerPatch && !canEditSeller && !doubleEnded) {
                await tx.rollback();
                return res.status(403).json({
                    error: 'Somente o corretor captador pode editar sellerInfo.',
                });
            }
            if (buyerPatch && !canEditBuyer && !doubleEnded) {
                await tx.rollback();
                return res.status(403).json({
                    error: 'Somente o corretor vendedor pode editar buyerInfo.',
                });
            }
            if (doubleEnded) {
                const userId = Number(req.userId);
                const isAdmin = String(req.userRole ?? '').toLowerCase() === 'admin';
                const sameBrokerId = Number(contract.capturing_broker_id ?? 0);
                if (!isAdmin && userId !== sameBrokerId) {
                    await tx.rollback();
                    return res.status(403).json({
                        error: 'Neste contrato de ponta dupla, apenas o corretor responsável pode editar os dois lados.',
                    });
                }
            }
            const sellerInfo = parseStoredJsonObject(contract.seller_info);
            const buyerInfo = parseStoredJsonObject(contract.buyer_info);
            const nextSellerInfo = sellerPatch ? { ...sellerInfo, ...sellerPatch } : sellerInfo;
            const nextBuyerInfo = buyerPatch ? { ...buyerInfo, ...buyerPatch } : buyerInfo;
            const nextStatus = resolveContractStatus(contract.status) === 'AWAITING_DOCS'
                ? 'IN_DRAFT'
                : resolveContractStatus(contract.status);
            await tx.query(`
          UPDATE contracts
          SET
            seller_info = CAST(? AS JSON),
            buyer_info = CAST(? AS JSON),
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
                JSON.stringify(nextSellerInfo),
                JSON.stringify(nextBuyerInfo),
                nextStatus,
                contractId,
            ]);
            const updatedContract = await fetchContractForUpdate(tx, contractId);
            await tx.commit();
            return res.status(200).json({
                message: 'Dados do contrato atualizados com sucesso.',
                contract: updatedContract ? mapContract(updatedContract) : null,
            });
        }
        catch (error) {
            await tx.rollback();
            console.error('Erro ao atualizar dados do contrato:', error);
            return res.status(500).json({ error: 'Falha ao atualizar dados do contrato.' });
        }
        finally {
            tx.release();
        }
    }
}
exports.contractController = new ContractController();
