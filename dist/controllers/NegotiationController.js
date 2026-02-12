"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.negotiationController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
const ExternalPdfService_1 = require("../modules/negotiations/infra/ExternalPdfService");
const NegotiationDocumentsRepository_1 = require("../modules/negotiations/infra/NegotiationDocumentsRepository");
const executor = {
    execute(sql, params) {
        return connection_1.default.execute(sql, params);
    },
};
const pdfService = new ExternalPdfService_1.ExternalPdfService();
const negotiationDocumentsRepository = new NegotiationDocumentsRepository_1.NegotiationDocumentsRepository(executor);
function parseProposalData(body) {
    const clientName = String(body.clientName ?? body.client_name ?? '').trim();
    const clientCpf = String(body.clientCpf ?? body.client_cpf ?? '').trim();
    const propertyAddress = String(body.propertyAddress ?? body.property_address ?? '').trim();
    const brokerName = String(body.brokerName ?? body.broker_name ?? '').trim();
    const rawSellingBrokerName = body.sellingBrokerName ?? body.selling_broker_name;
    const sellingBrokerName = rawSellingBrokerName == null ? null : String(rawSellingBrokerName).trim();
    const numericValue = Number(body.value);
    const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
    const validityDays = Number(body.validityDays ?? body.validity_days ?? 10);
    if (!clientName || !clientCpf || !propertyAddress || !brokerName || !paymentMethod) {
        throw new Error('Campos obrigatorios ausentes. Informe client_name, client_cpf, property_address, broker_name e payment_method.');
    }
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error('Campo value deve ser um numero maior que zero.');
    }
    if (!Number.isInteger(validityDays) || validityDays <= 0) {
        throw new Error('Campo validity_days deve ser um inteiro maior que zero.');
    }
    return {
        clientName,
        clientCpf,
        propertyAddress,
        brokerName,
        sellingBrokerName: sellingBrokerName || null,
        value: numericValue,
        paymentMethod,
        validityDays,
    };
}
class NegotiationController {
    async generateProposal(req, res) {
        if (!req.userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        const negotiationId = String(req.params.id ?? '').trim();
        if (!negotiationId) {
            return res.status(400).json({ error: 'ID de negociacao invalido.' });
        }
        let proposalData;
        try {
            proposalData = parseProposalData((req.body ?? {}));
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        try {
            const [negotiationRows] = await connection_1.default.query('SELECT id FROM negotiations WHERE id = ? LIMIT 1', [negotiationId]);
            if (!negotiationRows.length) {
                return res.status(404).json({ error: 'Negociacao nao encontrada.' });
            }
            const pdfBuffer = await pdfService.generateProposal(proposalData);
            await negotiationDocumentsRepository.saveProposal(negotiationId, pdfBuffer);
            return res.status(201).json({
                message: 'Proposta gerada e armazenada com sucesso.',
                negotiationId,
                sizeBytes: pdfBuffer.length,
            });
        }
        catch (error) {
            console.error('Erro ao gerar/salvar proposta em BLOB:', error);
            return res.status(500).json({ error: 'Falha ao gerar e salvar proposta.' });
        }
    }
    async downloadDocument(req, res) {
        const documentId = Number(req.params.documentId);
        if (!Number.isInteger(documentId) || documentId <= 0) {
            return res.status(400).json({ error: 'ID de documento invalido.' });
        }
        try {
            const document = await negotiationDocumentsRepository.findById(documentId);
            if (!document) {
                return res.status(404).json({ error: 'Documento nao encontrado.' });
            }
            const contentType = document.type === 'proposal' || document.type === 'contract'
                ? 'application/pdf'
                : 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="document_${documentId}.pdf"`);
            res.setHeader('Content-Length', document.fileContent.length.toString());
            return res.send(document.fileContent);
        }
        catch (error) {
            console.error('Erro ao baixar documento da negociacao:', error);
            return res.status(500).json({ error: 'Falha ao baixar documento.' });
        }
    }
}
exports.negotiationController = new NegotiationController();
