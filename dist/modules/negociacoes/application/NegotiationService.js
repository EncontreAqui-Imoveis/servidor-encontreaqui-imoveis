"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationService = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
const notificationService_1 = require("../../../services/notificationService");
const AuditLogRepository_1 = require("../../auditoria/infra/AuditLogRepository");
const types_1 = require("../domain/types");
const CommissionSplitsRepository_1 = require("../infra/CommissionSplitsRepository");
const NegotiationCloseSubmissionRepository_1 = require("../infra/NegotiationCloseSubmissionRepository");
const NegotiationContractsRepository_1 = require("../infra/NegotiationContractsRepository");
const NegotiationDocumentsRepository_1 = require("../infra/NegotiationDocumentsRepository");
const NegotiationRepository_1 = require("../infra/NegotiationRepository");
const NegotiationSignaturesRepository_1 = require("../infra/NegotiationSignaturesRepository");
const validators_1 = require("./validators");
const NEGOTIATION_START_STATUS = 'DOCS_IN_REVIEW';
function addDays(base, days) {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
}
function ensureRoleBroker(userRole) {
    if (userRole !== 'broker') {
        throw new validators_1.ValidationError('Acesso negado. Rota exclusiva para corretores aprovados.', 403);
    }
}
function ensureRoleAdmin(userRole) {
    if (userRole !== 'admin') {
        throw new validators_1.ValidationError('Acesso negado. Rota exclusiva para administradores.', 403);
    }
}
function normalizeSplits(rawSplits, mode) {
    if (!Array.isArray(rawSplits)) {
        throw new validators_1.ValidationError('splits é obrigatório e deve ser um array.');
    }
    const mapped = rawSplits.map((entry) => {
        const item = entry;
        const splitRole = (0, validators_1.normalizeSplitRole)(item.split_role);
        const recipient = item.recipient_user_id;
        let recipientUserId = null;
        if (recipient !== null && recipient !== undefined && recipient !== '') {
            recipientUserId = (0, validators_1.ensureInteger)(recipient, `recipient_user_id (${splitRole})`);
        }
        if (mode === 'PERCENT') {
            const percent = (0, validators_1.ensurePositiveNumber)(item.percent_value, `percent_value (${splitRole})`);
            return {
                split_role: splitRole,
                recipient_user_id: recipientUserId,
                percent_value: Number(percent.toFixed(4)),
                amount_value: null,
            };
        }
        const amount = (0, validators_1.ensurePositiveNumber)(item.amount_value, `amount_value (${splitRole})`);
        return {
            split_role: splitRole,
            recipient_user_id: recipientUserId,
            percent_value: null,
            amount_value: Number(amount.toFixed(2)),
        };
    });
    const requiredRoles = ['CAPTADOR', 'PLATFORM', 'SELLER_BROKER'];
    const roleSet = new Set(mapped.map((item) => item.split_role));
    for (const role of requiredRoles) {
        if (!roleSet.has(role)) {
            throw new validators_1.ValidationError(`Split obrigatório não informado: ${role}`);
        }
    }
    if (mapped.length !== roleSet.size) {
        throw new validators_1.ValidationError('split_role duplicado em splits.');
    }
    return mapped;
}
function validateSplitTotals(mode, splits, totalPercent, totalAmount) {
    if (mode === 'PERCENT') {
        if (totalPercent == null) {
            throw new validators_1.ValidationError('commission_total_percent é obrigatório para commission_mode=PERCENT.');
        }
        const sum = splits.reduce((acc, split) => acc + Number(split.percent_value ?? 0), 0);
        const diff = Math.abs(sum - 100);
        if (diff > 0.0001) {
            throw new validators_1.ValidationError('Soma dos splits em percentual deve fechar em 100%.');
        }
        return;
    }
    if (totalAmount == null) {
        throw new validators_1.ValidationError('commission_total_amount é obrigatório para commission_mode=AMOUNT.');
    }
    const sum = splits.reduce((acc, split) => acc + Number(split.amount_value ?? 0), 0);
    const diff = Math.abs(sum - totalAmount);
    if (diff > 0.01) {
        throw new validators_1.ValidationError('Soma dos splits em valor deve fechar no total de comissão.');
    }
}
class NegotiationService {
    negotiations;
    documents;
    contracts;
    signatures;
    closeSubmissions;
    splits;
    auditLogs;
    constructor(negotiations = new NegotiationRepository_1.NegotiationRepository(), documents = new NegotiationDocumentsRepository_1.NegotiationDocumentsRepository(), contracts = new NegotiationContractsRepository_1.NegotiationContractsRepository(), signatures = new NegotiationSignaturesRepository_1.NegotiationSignaturesRepository(), closeSubmissions = new NegotiationCloseSubmissionRepository_1.NegotiationCloseSubmissionRepository(), splits = new CommissionSplitsRepository_1.CommissionSplitsRepository(), auditLogs = new AuditLogRepository_1.AuditLogRepository()) {
        this.negotiations = negotiations;
        this.documents = documents;
        this.contracts = contracts;
        this.signatures = signatures;
        this.closeSubmissions = closeSubmissions;
        this.splits = splits;
        this.auditLogs = auditLogs;
    }
    async createNegotiation(params) {
        ensureRoleBroker(params.actorRole);
        const propertyId = (0, validators_1.ensureInteger)(params.propertyId, 'property_id');
        const captadorUserId = (0, validators_1.ensureInteger)(params.captadorUserId, 'captador_user_id');
        const sellerBrokerUserId = (0, validators_1.ensureInteger)(params.sellerBrokerUserId, 'seller_broker_user_id');
        const property = await this.negotiations.findPropertyById(propertyId);
        if (!property) {
            throw new validators_1.ValidationError('Imóvel não encontrado.', 404);
        }
        const captadorApproved = await this.negotiations.isApprovedBroker(captadorUserId);
        if (!captadorApproved) {
            throw new validators_1.ValidationError('captador_user_id deve ser um corretor aprovado.');
        }
        const sellerApproved = await this.negotiations.isApprovedBroker(sellerBrokerUserId);
        if (!sellerApproved) {
            throw new validators_1.ValidationError('seller_broker_user_id deve ser um corretor aprovado.');
        }
        const id = await this.negotiations.create({
            propertyId,
            captadorUserId,
            sellerBrokerUserId,
            createdByUserId: params.actorUserId,
        });
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: id,
            action: 'CREATE_NEGOTIATION',
            performedByUserId: params.actorUserId,
            metadata: {
                property_id: propertyId,
                captador_user_id: captadorUserId,
                seller_broker_user_id: sellerBrokerUserId,
            },
        });
        const negotiation = await this.negotiations.findById(id);
        return negotiation;
    }
    async submitForActivation(params) {
        ensureRoleBroker(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        if (negotiation.status !== 'DRAFT') {
            throw new validators_1.ValidationError('Apenas negociações em DRAFT podem ser enviadas para ativação.', 409);
        }
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: 'PENDING_ACTIVATION',
            active: 0,
            lastActivityAt: new Date(),
        });
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'SUBMIT_FOR_ACTIVATION',
            performedByUserId: params.actorUserId,
            metadata: {
                previous_status: negotiation.status,
                next_status: 'PENDING_ACTIVATION',
            },
        });
        await (0, notificationService_1.notifyAdmins)(`Negociação #${negotiationId} enviada para ativação.`, 'other', negotiationId);
        return this.negotiations.findById(negotiationId);
    }
    async activateByAdmin(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const slaDays = params.slaDays && Number.isFinite(params.slaDays) ? Number(params.slaDays) : 30;
        const db = await connection_1.default.getConnection();
        try {
            await db.beginTransaction();
            const negotiationsRepo = new NegotiationRepository_1.NegotiationRepository(db);
            const auditRepo = new AuditLogRepository_1.AuditLogRepository();
            const negotiation = await negotiationsRepo.findById(negotiationId);
            if (!negotiation) {
                throw new validators_1.ValidationError('Negociação não encontrada.', 404);
            }
            if (negotiation.status !== 'PENDING_ACTIVATION') {
                throw new validators_1.ValidationError('Somente negociações em PENDING_ACTIVATION podem ser ativadas.', 409);
            }
            const activeNegotiations = await negotiationsRepo.lockActiveByPropertyId(negotiation.property_id);
            const hasAnotherActive = activeNegotiations.some((item) => item.id !== negotiation.id);
            if (hasAnotherActive) {
                throw new validators_1.ValidationError('Já existe negociação ativa para este imóvel.', 409);
            }
            const now = new Date();
            const expiresAt = addDays(now, slaDays);
            await negotiationsRepo.updateStatus({
                id: negotiationId,
                status: NEGOTIATION_START_STATUS,
                active: 1,
                startedAt: now,
                expiresAt,
                lastActivityAt: now,
            });
            await negotiationsRepo.updatePropertyVisibility(negotiation.property_id, 'HIDDEN');
            await db.query(`
        INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        `, [
                'negotiation',
                negotiationId,
                'ACTIVATE_NEGOTIATION',
                params.actorUserId,
                JSON.stringify({
                    previous_status: negotiation.status,
                    next_status: NEGOTIATION_START_STATUS,
                    property_id: negotiation.property_id,
                    expires_at: expiresAt,
                }),
            ]);
            await db.commit();
            return negotiationsRepo.findById(negotiationId);
        }
        catch (error) {
            await db.rollback();
            throw error;
        }
        finally {
            db.release();
        }
    }
    async uploadDocument(params) {
        ensureRoleBroker(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const docName = (0, validators_1.ensureRequiredString)(params.docName, 'doc_name');
        const docUrl = (0, validators_1.ensureRequiredString)(params.docUrl, 'doc_url');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        const allowedStatuses = [
            'DOCS_IN_REVIEW',
            'CONTRACT_AVAILABLE',
            'SIGNED_PENDING_VALIDATION',
        ];
        if (!allowedStatuses.includes(negotiation.status)) {
            throw new validators_1.ValidationError('Status atual da negociação não permite upload de documentos.', 409);
        }
        const id = await this.documents.create({
            negotiationId,
            docName,
            docUrl,
            uploadedByUserId: params.actorUserId,
        });
        await this.negotiations.touch(negotiationId);
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'DOC_UPLOADED',
            performedByUserId: params.actorUserId,
            metadata: {
                doc_id: id,
                doc_name: docName,
            },
        });
        return this.documents.findById(id);
    }
    async reviewDocument(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const docId = (0, validators_1.ensureInteger)(params.docId, 'doc_id');
        const status = (0, validators_1.normalizeDocStatus)(params.status);
        const reviewComment = String(params.reviewComment ?? '').trim() || null;
        if ((status === 'APPROVED_WITH_REMARKS' || status === 'REJECTED') && !reviewComment) {
            throw new validators_1.ValidationError('review_comment é obrigatório para APPROVED_WITH_REMARKS ou REJECTED.');
        }
        const doc = await this.documents.findById(docId);
        if (!doc || doc.negotiation_id !== negotiationId) {
            throw new validators_1.ValidationError('Documento não encontrado para esta negociação.', 404);
        }
        await this.documents.review({
            id: docId,
            status,
            reviewComment,
            reviewedByAdminId: params.actorUserId,
        });
        await this.negotiations.touch(negotiationId);
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'DOC_REVIEWED',
            performedByUserId: params.actorUserId,
            metadata: {
                doc_id: docId,
                previous_status: doc.status,
                next_status: status,
                review_comment: reviewComment,
            },
        });
        return this.documents.findById(docId);
    }
    async publishContract(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const contractUrl = (0, validators_1.ensureRequiredString)(params.contractUrl, 'contract_url');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        const contract = await this.contracts.create({
            negotiationId,
            contractUrl,
            uploadedByAdminId: params.actorUserId,
        });
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: 'CONTRACT_AVAILABLE',
            lastActivityAt: new Date(),
        });
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'CONTRACT_PUBLISHED',
            performedByUserId: params.actorUserId,
            metadata: {
                contract_id: contract.id,
                version: contract.version,
            },
        });
        return this.contracts.latestByNegotiationId(negotiationId);
    }
    async uploadSignature(params) {
        ensureRoleBroker(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const signedByRole = (0, validators_1.normalizeSignatureRole)(params.signedByRole);
        const signedFileUrl = (0, validators_1.ensureRequiredString)(params.signedFileUrl, 'signed_file_url');
        const signedProofImageUrl = String(params.signedProofImageUrl ?? '').trim() || null;
        let signedByUserId = null;
        if (params.signedByUserId != null && params.signedByUserId !== '') {
            signedByUserId = (0, validators_1.ensureInteger)(params.signedByUserId, 'signed_by_user_id');
        }
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        const signatureId = await this.signatures.create({
            negotiationId,
            signedByRole,
            signedFileUrl,
            signedProofImageUrl,
            signedByUserId,
        });
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: 'SIGNED_PENDING_VALIDATION',
            lastActivityAt: new Date(),
        });
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'SIGNATURE_UPLOADED',
            performedByUserId: params.actorUserId,
            metadata: {
                signature_id: signatureId,
                signed_by_role: signedByRole,
            },
        });
        return this.signatures.findById(signatureId);
    }
    async validateSignature(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const signatureId = (0, validators_1.ensureInteger)(params.signatureId, 'signature_id');
        const status = (0, validators_1.normalizeSignatureValidationStatus)(params.status);
        const comment = String(params.comment ?? '').trim() || null;
        if (status === 'REJECTED' && !comment) {
            throw new validators_1.ValidationError('comment é obrigatório para rejeição de assinatura.');
        }
        const signature = await this.signatures.findById(signatureId);
        if (!signature || signature.negotiation_id !== negotiationId) {
            throw new validators_1.ValidationError('Assinatura não encontrada para esta negociação.', 404);
        }
        await this.signatures.validate({
            id: signatureId,
            status,
            comment,
            validatedByAdminId: params.actorUserId,
        });
        await this.negotiations.touch(negotiationId);
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'SIGNATURE_VALIDATED',
            performedByUserId: params.actorUserId,
            metadata: {
                signature_id: signatureId,
                previous_status: signature.validation_status,
                next_status: status,
                comment,
            },
        });
        return this.signatures.findById(signatureId);
    }
    async submitClose(params) {
        ensureRoleBroker(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const closeType = (0, validators_1.normalizeCloseType)(params.closeType);
        const commissionMode = (0, validators_1.normalizeCommissionMode)(params.commissionMode);
        const paymentProofUrl = (0, validators_1.ensureRequiredString)(params.paymentProofUrl, 'payment_proof_url');
        const commissionTotalPercent = params.commissionTotalPercent == null || params.commissionTotalPercent === ''
            ? null
            : Number(params.commissionTotalPercent);
        const commissionTotalAmount = params.commissionTotalAmount == null || params.commissionTotalAmount === ''
            ? null
            : Number(params.commissionTotalAmount);
        const splits = normalizeSplits(params.splits, commissionMode);
        validateSplitTotals(commissionMode, splits, commissionTotalPercent, commissionTotalAmount);
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        if (types_1.NEGOTIATION_FINAL_STATUSES.has(negotiation.status)) {
            throw new validators_1.ValidationError('Negociação já finalizada.', 409);
        }
        const submissionId = await this.closeSubmissions.create({
            negotiationId,
            closeType,
            commissionMode,
            commissionTotalPercent,
            commissionTotalAmount,
            paymentProofUrl,
            submittedByUserId: params.actorUserId,
        });
        await this.splits.replaceForSubmission({
            closeSubmissionId: submissionId,
            splits,
        });
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: 'CLOSE_SUBMITTED',
            lastActivityAt: new Date(),
        });
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'CLOSE_SUBMITTED',
            performedByUserId: params.actorUserId,
            metadata: {
                close_submission_id: submissionId,
                close_type: closeType,
                commission_mode: commissionMode,
            },
        });
        return this.closeSubmissions.findLatestByNegotiationId(negotiationId);
    }
    async approveClose(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        const submission = await this.closeSubmissions.findLatestByNegotiationId(negotiationId);
        if (!submission) {
            throw new validators_1.ValidationError('Submissão de fechamento não encontrada.', 404);
        }
        await this.closeSubmissions.markApproved(submission.id, params.actorUserId);
        const finalStatus = submission.close_type === 'SOLD'
            ? 'SOLD_COMMISSIONED'
            : 'RENTED_COMMISSIONED';
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: finalStatus,
            active: 0,
            lastActivityAt: new Date(),
        });
        await this.negotiations.updatePropertyLifecycle(negotiation.property_id, submission.close_type === 'SOLD' ? 'SOLD' : 'RENTED');
        await this.negotiations.updatePropertyVisibility(negotiation.property_id, 'HIDDEN');
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'CLOSE_APPROVED',
            performedByUserId: params.actorUserId,
            metadata: {
                close_submission_id: submission.id,
                close_type: submission.close_type,
                final_status: finalStatus,
            },
        });
        return this.negotiations.findById(negotiationId);
    }
    async markNoCommission(params) {
        ensureRoleAdmin(params.actorRole);
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const reason = (0, validators_1.ensureRequiredString)(params.reason, 'reason');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        const submission = await this.closeSubmissions.findLatestByNegotiationId(negotiationId);
        if (!submission) {
            throw new validators_1.ValidationError('Submissão de fechamento não encontrada.', 404);
        }
        await this.closeSubmissions.markNoCommission(submission.id, params.actorUserId, reason);
        const finalStatus = submission.close_type === 'SOLD'
            ? 'SOLD_NO_COMMISSION'
            : 'RENTED_NO_COMMISSION';
        await this.negotiations.updateStatus({
            id: negotiationId,
            status: finalStatus,
            active: 0,
            lastActivityAt: new Date(),
        });
        await this.negotiations.updatePropertyLifecycle(negotiation.property_id, submission.close_type === 'SOLD' ? 'SOLD' : 'RENTED');
        await this.negotiations.updatePropertyVisibility(negotiation.property_id, 'HIDDEN');
        await this.auditLogs.append({
            entityType: 'negotiation',
            entityId: negotiationId,
            action: 'CLOSE_NO_COMMISSION',
            performedByUserId: params.actorUserId,
            metadata: {
                close_submission_id: submission.id,
                close_type: submission.close_type,
                final_status: finalStatus,
                reason,
            },
        });
        return this.negotiations.findById(negotiationId);
    }
    async getNegotiationDetails(params) {
        const negotiationId = (0, validators_1.ensureInteger)(params.negotiationId, 'negotiation_id');
        const negotiation = await this.negotiations.findById(negotiationId);
        if (!negotiation) {
            throw new validators_1.ValidationError('Negociação não encontrada.', 404);
        }
        if (params.actorRole !== 'admin' && params.actorRole !== 'broker') {
            throw new validators_1.ValidationError('Acesso negado.', 403);
        }
        if (params.actorRole === 'broker' &&
            params.actorUserId !== negotiation.captador_user_id &&
            params.actorUserId !== negotiation.seller_broker_user_id &&
            params.actorUserId !== negotiation.created_by_user_id) {
            throw new validators_1.ValidationError('Acesso negado para esta negociação.', 403);
        }
        const [documents, latestContract, signatures, closeSubmission] = await Promise.all([
            this.documents.listByNegotiationId(negotiationId),
            this.contracts.latestByNegotiationId(negotiationId),
            this.signatures.listByNegotiationId(negotiationId),
            this.closeSubmissions.findLatestByNegotiationId(negotiationId),
        ]);
        const splits = closeSubmission
            ? await this.splits.listBySubmissionId(closeSubmission.id)
            : [];
        const daysInNegotiation = negotiation.started_at
            ? Math.max(0, Math.floor((Date.now() - new Date(negotiation.started_at).getTime()) / (1000 * 60 * 60 * 24)))
            : 0;
        return {
            negotiation,
            days_in_negotiation: daysInNegotiation,
            documents,
            latest_contract: latestContract,
            signatures,
            close_submission: closeSubmission,
            commission_splits: splits,
        };
    }
}
exports.NegotiationService = NegotiationService;
