"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.negotiationController = void 0;
const crypto_1 = require("crypto");
const connection_1 = __importDefault(require("../database/connection"));
const ExternalPdfService_1 = require("../modules/negotiations/infra/ExternalPdfService");
const NegotiationDocumentsRepository_1 = require("../modules/negotiations/infra/NegotiationDocumentsRepository");
const executor = {
    execute(sql, params) {
        return connection_1.default.execute(sql, params);
    },
};
const ACTIVE_NEGOTIATION_STATUSES = [
    'PROPOSAL_DRAFT',
    'PROPOSAL_SENT',
    'IN_NEGOTIATION',
    'DOCUMENTATION_PHASE',
    'CONTRACT_DRAFTING',
    'AWAITING_SIGNATURES',
];
const DEFAULT_WIZARD_STATUS = 'AWAITING_SIGNATURES';
const pdfService = new ExternalPdfService_1.ExternalPdfService();
const negotiationDocumentsRepository = new NegotiationDocumentsRepository_1.NegotiationDocumentsRepository(executor);
function toCurrency(value) {
    return value.toFixed(2);
}
function toCents(value) {
    return Math.round(value * 100);
}
function parsePositiveNumber(input, fieldName) {
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${fieldName} deve ser um numero maior ou igual a zero.`);
    }
    return parsed;
}
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
function parseProposalWizardBody(body) {
    const propertyId = Number(body.propertyId);
    const clientName = String(body.clientName ?? '').trim();
    const clientCpfDigits = String(body.clientCpf ?? '').replace(/\D/g, '');
    const validadeDiasRaw = body.validadeDias ?? 10;
    const validadeDias = Number(validadeDiasRaw);
    const sellerBrokerIdRaw = body.sellerBrokerId;
    const sellerBrokerId = sellerBrokerIdRaw === undefined || sellerBrokerIdRaw === null || sellerBrokerIdRaw === ''
        ? null
        : Number(sellerBrokerIdRaw);
    const pagamento = body.pagamento ?? {};
    const dinheiro = parsePositiveNumber(pagamento.dinheiro ?? 0, 'pagamento.dinheiro');
    const permuta = parsePositiveNumber(pagamento.permuta ?? 0, 'pagamento.permuta');
    const financiamento = parsePositiveNumber(pagamento.financiamento ?? 0, 'pagamento.financiamento');
    const outros = parsePositiveNumber(pagamento.outros ?? 0, 'pagamento.outros');
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
        throw new Error('propertyId invalido.');
    }
    if (!clientName) {
        throw new Error('clientName e obrigatorio.');
    }
    if (clientCpfDigits.length != 11) {
        throw new Error('clientCpf invalido. Informe 11 digitos.');
    }
    if (!Number.isInteger(validadeDias) || validadeDias <= 0) {
        throw new Error('validadeDias deve ser um inteiro maior que zero.');
    }
    if (sellerBrokerId !== null && (!Number.isInteger(sellerBrokerId) || sellerBrokerId <= 0)) {
        throw new Error('sellerBrokerId invalido.');
    }
    return {
        propertyId,
        clientName,
        clientCpf: clientCpfDigits,
        validadeDias,
        sellerBrokerId,
        pagamento: {
            dinheiro,
            permuta,
            financiamento,
            outros,
        },
    };
}
function resolvePropertyAddress(row) {
    const parts = [
        row.address,
        row.numero ? `Nº ${row.numero}` : null,
        row.bairro,
        row.city,
        row.state,
        row.quadra ? `Quadra ${row.quadra}` : null,
        row.lote ? `Lote ${row.lote}` : null,
    ]
        .map((part) => String(part ?? '').trim())
        .filter(Boolean);
    return parts.join(', ');
}
function resolvePropertyValue(row) {
    const sale = Number(row.price_sale ?? 0);
    const rent = Number(row.price_rent ?? 0);
    const fallback = Number(row.price ?? 0);
    const resolved = sale > 0 ? sale : rent > 0 ? rent : fallback;
    return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}
function buildPaymentMethodString(values) {
    return [
        `Dinheiro: R$ ${toCurrency(values.dinheiro)}`,
        `Permuta: R$ ${toCurrency(values.permuta)}`,
        `Financiamento: R$ ${toCurrency(values.financiamento)}`,
        `Outros: R$ ${toCurrency(values.outros)}`,
    ].join(' | ');
}
function buildProposalValidityDate(days) {
    const now = new Date();
    now.setDate(now.getDate() + days);
    const yyyy = now.getFullYear().toString().padStart(4, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
            const documentId = await negotiationDocumentsRepository.saveProposal(negotiationId, pdfBuffer);
            return res.status(201).json({
                id: documentId,
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
    async generateProposalFromProperty(req, res) {
        if (!req.userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        let payload;
        try {
            payload = parseProposalWizardBody((req.body ?? {}));
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        let tx = null;
        try {
            tx = await connection_1.default.getConnection();
            await tx.beginTransaction();
            const [propertyRows] = await tx.query(`
          SELECT
            id,
            address,
            numero,
            quadra,
            lote,
            bairro,
            city,
            state,
            price,
            price_sale,
            price_rent
          FROM properties
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `, [payload.propertyId]);
            const property = propertyRows[0];
            if (!property) {
                await tx.rollback();
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            const propertyValue = resolvePropertyValue(property);
            if (propertyValue <= 0) {
                await tx.rollback();
                return res.status(400).json({ error: 'Imovel sem valor valido para gerar proposta.' });
            }
            const paymentTotal = payload.pagamento.dinheiro +
                payload.pagamento.permuta +
                payload.pagamento.financiamento +
                payload.pagamento.outros;
            if (toCents(paymentTotal) !== toCents(propertyValue)) {
                await tx.rollback();
                return res.status(400).json({
                    error: 'A soma dos pagamentos deve ser exatamente igual ao valor do imovel.',
                    propertyValue,
                    paymentTotal,
                });
            }
            const [brokerRows] = await tx.query('SELECT name FROM users WHERE id = ? LIMIT 1', [req.userId]);
            const brokerName = String(brokerRows[0]?.name ?? '').trim();
            if (!brokerName) {
                await tx.rollback();
                return res.status(400).json({ error: 'Corretor nao encontrado para gerar proposta.' });
            }
            const sellerBrokerId = payload.sellerBrokerId ?? req.userId;
            let sellingBrokerName = brokerName;
            if (sellerBrokerId !== req.userId) {
                const [sellerRows] = await tx.query(`
            SELECT u.name
            FROM brokers b
            JOIN users u ON u.id = b.id
            WHERE b.id = ? AND b.status = 'approved'
            LIMIT 1
          `, [sellerBrokerId]);
                sellingBrokerName = String(sellerRows[0]?.name ?? '').trim();
                if (!sellingBrokerName) {
                    await tx.rollback();
                    return res.status(400).json({ error: 'Corretor vendedor invalido ou nao aprovado.' });
                }
            }
            const [existingRows] = await tx.query(`
          SELECT id, status
          FROM negotiations
          WHERE property_id = ?
            AND status IN (${ACTIVE_NEGOTIATION_STATUSES.map(() => '?').join(', ')})
          LIMIT 1
          FOR UPDATE
        `, [payload.propertyId, ...ACTIVE_NEGOTIATION_STATUSES]);
            const paymentDetails = JSON.stringify({
                method: 'OTHER',
                amount: Number(propertyValue.toFixed(2)),
                details: payload.pagamento,
            });
            const proposalValidityDate = buildProposalValidityDate(payload.validadeDias);
            let negotiationId = '';
            let fromStatus = 'PROPOSAL_DRAFT';
            if (existingRows.length > 0) {
                negotiationId = existingRows[0].id;
                fromStatus = existingRows[0].status;
                await tx.execute(`
            UPDATE negotiations
            SET
              capturing_broker_id = ?,
              selling_broker_id = ?,
              buyer_client_id = NULL,
              status = ?,
              final_value = ?,
              payment_details = CAST(? AS JSON),
              proposal_validity_date = ?,
              version = version + 1
            WHERE id = ?
          `, [
                    req.userId,
                    sellerBrokerId,
                    DEFAULT_WIZARD_STATUS,
                    propertyValue,
                    paymentDetails,
                    proposalValidityDate,
                    negotiationId,
                ]);
            }
            else {
                negotiationId = (0, crypto_1.randomUUID)();
                await tx.execute(`
            INSERT INTO negotiations (
              id,
              property_id,
              capturing_broker_id,
              selling_broker_id,
              buyer_client_id,
              status,
              final_value,
              payment_details,
              proposal_validity_date,
              version
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, CAST(? AS JSON), ?, 0)
          `, [
                    negotiationId,
                    payload.propertyId,
                    req.userId,
                    sellerBrokerId,
                    DEFAULT_WIZARD_STATUS,
                    propertyValue,
                    paymentDetails,
                    proposalValidityDate,
                ]);
            }
            await tx.execute(`
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `, [
                negotiationId,
                fromStatus,
                DEFAULT_WIZARD_STATUS,
                req.userId,
                JSON.stringify({
                    source: 'mobile_proposal_wizard',
                    payment: payload.pagamento,
                    sellerBrokerId,
                }),
            ]);
            await tx.execute(`
          UPDATE properties
          SET status = 'negociacao'
          WHERE id = ?
        `, [payload.propertyId]);
            const proposalData = {
                clientName: payload.clientName,
                clientCpf: payload.clientCpf,
                propertyAddress: resolvePropertyAddress(property),
                brokerName,
                sellingBrokerName,
                value: propertyValue,
                paymentMethod: buildPaymentMethodString(payload.pagamento),
                validityDays: payload.validadeDias,
            };
            const pdfBuffer = await pdfService.generateProposal(proposalData);
            const documentId = await negotiationDocumentsRepository.saveProposal(negotiationId, pdfBuffer, tx);
            await tx.commit();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="proposal_${negotiationId}.pdf"`);
            res.setHeader('Content-Length', pdfBuffer.length.toString());
            res.setHeader('X-Negotiation-Id', negotiationId);
            res.setHeader('X-Document-Id', String(documentId));
            return res.status(201).send(pdfBuffer);
        }
        catch (error) {
            if (tx) {
                await tx.rollback();
            }
            console.error('Erro ao gerar proposta por imovel:', error);
            return res.status(500).json({ error: 'Falha ao gerar proposta.' });
        }
        finally {
            tx?.release();
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
    async downloadLatestProposal(req, res) {
        const negotiationId = String(req.params.id ?? '').trim();
        if (!negotiationId) {
            return res.status(400).json({ error: 'ID de negociação inválido.' });
        }
        try {
            const document = await negotiationDocumentsRepository.findLatestByNegotiationAndType(negotiationId, 'proposal');
            if (!document) {
                return res.status(404).json({ error: 'Nenhuma proposta encontrada para esta negociação.' });
            }
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="proposta.pdf"');
            res.setHeader('Content-Length', document.fileContent.length.toString());
            res.setHeader('X-Document-Id', String(document.id));
            return res.send(document.fileContent);
        }
        catch (error) {
            console.error('Erro ao baixar proposta da negociação:', error);
            return res.status(500).json({ error: 'Falha ao baixar proposta.' });
        }
    }
}
exports.negotiationController = new NegotiationController();
