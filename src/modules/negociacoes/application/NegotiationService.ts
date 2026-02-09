import connection from '../../../database/connection';
import { notifyAdmins } from '../../../services/notificationService';
import { AuditLogRepository } from '../../auditoria/infra/AuditLogRepository';
import {
  CloseType,
  CommissionMode,
  NEGOTIATION_FINAL_STATUSES,
  NegotiationStatus,
  SignatureValidationStatus,
  SplitRole,
} from '../domain/types';
import { CommissionSplitsRepository } from '../infra/CommissionSplitsRepository';
import { NegotiationCloseSubmissionRepository } from '../infra/NegotiationCloseSubmissionRepository';
import { NegotiationContractsRepository } from '../infra/NegotiationContractsRepository';
import { NegotiationDocumentsRepository } from '../infra/NegotiationDocumentsRepository';
import { NegotiationRepository } from '../infra/NegotiationRepository';
import { NegotiationSignaturesRepository } from '../infra/NegotiationSignaturesRepository';
import {
  ensureInteger,
  ensurePositiveNumber,
  ensureRequiredString,
  normalizeCloseType,
  normalizeCommissionMode,
  normalizeDocStatus,
  normalizeSignatureRole,
  normalizeSignatureValidationStatus,
  normalizeSplitRole,
  ValidationError,
} from './validators';

const NEGOTIATION_START_STATUS: NegotiationStatus = 'DOCS_IN_REVIEW';

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function ensureRoleBroker(userRole?: string): void {
  if (userRole !== 'broker') {
    throw new ValidationError('Acesso negado. Rota exclusiva para corretores aprovados.', 403);
  }
}

function ensureRoleAdmin(userRole?: string): void {
  if (userRole !== 'admin') {
    throw new ValidationError('Acesso negado. Rota exclusiva para administradores.', 403);
  }
}

type SplitInput = {
  splitRole: SplitRole;
  recipientUserId: number | null;
  percentValue: number | null;
  amountValue: number | null;
};

function normalizeSplits(rawSplits: unknown, mode: CommissionMode): SplitInput[] {
  if (!Array.isArray(rawSplits)) {
    throw new ValidationError('splits é obrigatório e deve ser um array.');
  }

  const mapped = rawSplits.map((entry) => {
    const item = entry as Record<string, unknown>;
    const splitRole = normalizeSplitRole(item.split_role);

    const recipient = item.recipient_user_id;
    let recipientUserId: number | null = null;
    if (recipient !== null && recipient !== undefined && recipient !== '') {
      recipientUserId = ensureInteger(recipient, `recipient_user_id (${splitRole})`);
    }

    if (mode === 'PERCENT') {
      const percent = ensurePositiveNumber(item.percent_value, `percent_value (${splitRole})`);
      return {
        splitRole,
        recipientUserId,
        percentValue: Number(percent.toFixed(4)),
        amountValue: null,
      };
    }

    const amount = ensurePositiveNumber(item.amount_value, `amount_value (${splitRole})`);
    return {
      splitRole,
      recipientUserId,
      percentValue: null,
      amountValue: Number(amount.toFixed(2)),
    };
  });

  const requiredRoles: SplitRole[] = ['CAPTADOR', 'PLATFORM', 'SELLER_BROKER'];
  const roleSet = new Set(mapped.map((item) => item.splitRole));
  for (const role of requiredRoles) {
    if (!roleSet.has(role)) {
      throw new ValidationError(`Split obrigatório não informado: ${role}`);
    }
  }

  if (mapped.length !== roleSet.size) {
    throw new ValidationError('split_role duplicado em splits.');
  }

  return mapped;
}

function validateSplitTotals(
  mode: CommissionMode,
  splits: SplitInput[],
  totalPercent: number | null,
  totalAmount: number | null
): void {
  if (mode === 'PERCENT') {
    if (totalPercent == null) {
      throw new ValidationError('commission_total_percent é obrigatório para commission_mode=PERCENT.');
    }

    const sum = splits.reduce((acc, split) => acc + Number(split.percentValue ?? 0), 0);
    const diff = Math.abs(sum - 100);
    if (diff > 0.0001) {
      throw new ValidationError('Soma dos splits em percentual deve fechar em 100%.');
    }

    return;
  }

  if (totalAmount == null) {
    throw new ValidationError('commission_total_amount é obrigatório para commission_mode=AMOUNT.');
  }

  const sum = splits.reduce((acc, split) => acc + Number(split.amountValue ?? 0), 0);
  const diff = Math.abs(sum - totalAmount);
  if (diff > 0.01) {
    throw new ValidationError('Soma dos splits em valor deve fechar no total de comissão.');
  }
}

export class NegotiationService {
  constructor(
    private readonly negotiations = new NegotiationRepository(),
    private readonly documents = new NegotiationDocumentsRepository(),
    private readonly contracts = new NegotiationContractsRepository(),
    private readonly signatures = new NegotiationSignaturesRepository(),
    private readonly closeSubmissions = new NegotiationCloseSubmissionRepository(),
    private readonly splits = new CommissionSplitsRepository(),
    private readonly auditLogs = new AuditLogRepository()
  ) {}

  async createNegotiation(params: {
    actorUserId: number;
    actorRole?: string;
    propertyId: unknown;
    captadorUserId: unknown;
    sellerBrokerUserId: unknown;
  }) {
    ensureRoleBroker(params.actorRole);

    const propertyId = ensureInteger(params.propertyId, 'property_id');
    const captadorUserId = ensureInteger(params.captadorUserId, 'captador_user_id');
    const sellerBrokerUserId = ensureInteger(params.sellerBrokerUserId, 'seller_broker_user_id');

    const property = await this.negotiations.findPropertyById(propertyId);
    if (!property) {
      throw new ValidationError('Imóvel não encontrado.', 404);
    }

    const captadorApproved = await this.negotiations.isApprovedBroker(captadorUserId);
    if (!captadorApproved) {
      throw new ValidationError('captador_user_id deve ser um corretor aprovado.');
    }

    const sellerApproved = await this.negotiations.isApprovedBroker(sellerBrokerUserId);
    if (!sellerApproved) {
      throw new ValidationError('seller_broker_user_id deve ser um corretor aprovado.');
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

    return this.negotiations.findById(id);
  }

  async submitForActivation(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
  }) {
    ensureRoleBroker(params.actorRole);
    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    if (negotiation.status !== 'DRAFT') {
      throw new ValidationError('Apenas negociações em DRAFT podem ser enviadas para ativação.', 409);
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

    await notifyAdmins(
      `Negociação #${negotiationId} enviada para ativação.`,
      'other',
      negotiationId
    );

    return this.negotiations.findById(negotiationId);
  }

  async activateByAdmin(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    slaDays?: number;
  }) {
    ensureRoleAdmin(params.actorRole);
    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const slaDays = params.slaDays && Number.isFinite(params.slaDays) ? Number(params.slaDays) : 30;

    const db = await connection.getConnection();
    try {
      await db.beginTransaction();

      const negotiationsRepo = new NegotiationRepository(db);

      const negotiation = await negotiationsRepo.findById(negotiationId);
      if (!negotiation) {
        throw new ValidationError('Negociação não encontrada.', 404);
      }

      if (negotiation.status !== 'PENDING_ACTIVATION') {
        throw new ValidationError('Somente negociações em PENDING_ACTIVATION podem ser ativadas.', 409);
      }

      const activeNegotiations = await negotiationsRepo.lockActiveByPropertyId(negotiation.property_id);
      const hasAnotherActive = activeNegotiations.some((item) => item.id !== negotiation.id);
      if (hasAnotherActive) {
        throw new ValidationError('Já existe negociação ativa para este imóvel.', 409);
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

      await db.query(
        `
        INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        `,
        [
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
        ]
      );

      await db.commit();
      return negotiationsRepo.findById(negotiationId);
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }

  async uploadDocument(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    docName: unknown;
    docUrl: unknown;
  }) {
    ensureRoleBroker(params.actorRole);
    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const docName = ensureRequiredString(params.docName, 'doc_name');
    const docUrl = ensureRequiredString(params.docUrl, 'doc_url');

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    const allowedStatuses: NegotiationStatus[] = [
      'DOCS_IN_REVIEW',
      'CONTRACT_AVAILABLE',
      'SIGNED_PENDING_VALIDATION',
    ];

    if (!allowedStatuses.includes(negotiation.status)) {
      throw new ValidationError('Status atual da negociação não permite upload de documentos.', 409);
    }

    const id = await this.documents.create({
      negotiation_id: negotiationId,
      doc_name: docName,
      doc_url: docUrl,
      uploaded_by_user_id: params.actorUserId,
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

  async reviewDocument(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    docId: unknown;
    status: unknown;
    reviewComment: unknown;
  }) {
    ensureRoleAdmin(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const docId = ensureInteger(params.docId, 'doc_id');
    const status = normalizeDocStatus(params.status);
    const reviewComment = String(params.reviewComment ?? '').trim() || null;

    if ((status === 'APPROVED_WITH_REMARKS' || status === 'REJECTED') && !reviewComment) {
      throw new ValidationError('review_comment é obrigatório para APPROVED_WITH_REMARKS ou REJECTED.');
    }

    const doc = await this.documents.findById(docId);
    if (!doc || doc.negotiation_id !== negotiationId) {
      throw new ValidationError('Documento não encontrado para esta negociação.', 404);
    }

    await this.documents.updateStatus(docId, status, reviewComment, params.actorUserId);

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

  async publishContract(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    contractUrl: unknown;
  }) {
    ensureRoleAdmin(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const contractUrl = ensureRequiredString(params.contractUrl, 'contract_url');

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    const latest = await this.contracts.findLatestByNegotiationId(negotiationId);
    const nextVersion = latest ? latest.version + 1 : 1;

    await this.contracts.create({
      negotiation_id: negotiationId,
      version: nextVersion,
      contract_url: contractUrl,
      uploaded_by_admin_id: params.actorUserId,
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
        version: nextVersion,
      },
    });

    return this.contracts.findLatestByNegotiationId(negotiationId);
  }

  async uploadSignature(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    signedByRole: unknown;
    signedFileUrl: unknown;
    signedProofImageUrl: unknown;
    signedByUserId: unknown;
  }) {
    ensureRoleBroker(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const signedByRole = normalizeSignatureRole(params.signedByRole);
    const signedFileUrl = ensureRequiredString(params.signedFileUrl, 'signed_file_url');
    const signedProofImageUrl = String(params.signedProofImageUrl ?? '').trim() || null;

    let signedByUserId: number | null = null;
    if (params.signedByUserId != null && params.signedByUserId !== '') {
      signedByUserId = ensureInteger(params.signedByUserId, 'signed_by_user_id');
    }

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    const signatureId = await this.signatures.create({
      negotiation_id: negotiationId,
      signed_by_role: signedByRole,
      signed_file_url: signedFileUrl,
      signed_proof_image_url: signedProofImageUrl ?? undefined,
      signed_by_user_id: signedByUserId ?? undefined,
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

  async validateSignature(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    signatureId: unknown;
    status: unknown;
    comment: unknown;
  }) {
    ensureRoleAdmin(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const signatureId = ensureInteger(params.signatureId, 'signature_id');
    const status = normalizeSignatureValidationStatus(params.status);
    const comment = String(params.comment ?? '').trim() || null;

    if (status === 'REJECTED' && !comment) {
      throw new ValidationError('comment é obrigatório para rejeição de assinatura.');
    }

    const signature = await this.signatures.findById(signatureId);
    if (!signature || signature.negotiation_id !== negotiationId) {
      throw new ValidationError('Assinatura não encontrada para esta negociação.', 404);
    }

    await this.signatures.updateValidation(signatureId, status, comment, params.actorUserId);

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

  async submitClose(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    closeType: unknown;
    commissionMode: unknown;
    commissionTotalPercent: unknown;
    commissionTotalAmount: unknown;
    paymentProofUrl: unknown;
    splits: unknown;
  }) {
    ensureRoleBroker(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const closeType = normalizeCloseType(params.closeType);
    const commissionMode = normalizeCommissionMode(params.commissionMode);
    const paymentProofUrl = ensureRequiredString(params.paymentProofUrl, 'payment_proof_url');

    const commissionTotalPercent =
      params.commissionTotalPercent == null || params.commissionTotalPercent === ''
        ? null
        : Number(params.commissionTotalPercent);

    const commissionTotalAmount =
      params.commissionTotalAmount == null || params.commissionTotalAmount === ''
        ? null
        : Number(params.commissionTotalAmount);

    const normalizedSplits = normalizeSplits(params.splits, commissionMode);
    validateSplitTotals(commissionMode, normalizedSplits, commissionTotalPercent, commissionTotalAmount);

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    if (NEGOTIATION_FINAL_STATUSES.has(negotiation.status)) {
      throw new ValidationError('Negociação já finalizada.', 409);
    }

    const submissionId = await this.closeSubmissions.create({
      negotiation_id: negotiationId,
      close_type: closeType,
      commission_mode: commissionMode,
      commission_total_percent: commissionTotalPercent ?? undefined,
      commission_total_amount: commissionTotalAmount ?? undefined,
      payment_proof_url: paymentProofUrl,
      submitted_by_user_id: params.actorUserId,
    });

    await this.splits.replaceForSubmission({
      closeSubmissionId: submissionId,
      splits: normalizedSplits,
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

    return this.closeSubmissions.findByNegotiationId(negotiationId);
  }

  async approveClose(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
  }) {
    ensureRoleAdmin(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const negotiation = await this.negotiations.findById(negotiationId);

    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    const submission = await this.closeSubmissions.findByNegotiationId(negotiationId);
    if (!submission) {
      throw new ValidationError('Submissão de fechamento não encontrada.', 404);
    }

    await this.closeSubmissions.approve(submission.id, params.actorUserId);

    const finalStatus: NegotiationStatus = submission.close_type === 'SOLD'
      ? 'SOLD_COMMISSIONED'
      : 'RENTED_COMMISSIONED';

    await this.negotiations.updateStatus({
      id: negotiationId,
      status: finalStatus,
      active: 0,
      lastActivityAt: new Date(),
    });

    await this.negotiations.updatePropertyLifecycle(
      negotiation.property_id,
      submission.close_type === 'SOLD' ? 'SOLD' : 'RENTED'
    );
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

  async markNoCommission(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
    reason: unknown;
  }) {
    ensureRoleAdmin(params.actorRole);

    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');
    const reason = ensureRequiredString(params.reason, 'reason');

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    const submission = await this.closeSubmissions.findByNegotiationId(negotiationId);
    if (!submission) {
      throw new ValidationError('Submissão de fechamento não encontrada.', 404);
    }

    await this.closeSubmissions.markNoCommission(submission.id, params.actorUserId, reason);

    const finalStatus: NegotiationStatus = submission.close_type === 'SOLD'
      ? 'SOLD_NO_COMMISSION'
      : 'RENTED_NO_COMMISSION';

    await this.negotiations.updateStatus({
      id: negotiationId,
      status: finalStatus,
      active: 0,
      lastActivityAt: new Date(),
    });

    await this.negotiations.updatePropertyLifecycle(
      negotiation.property_id,
      submission.close_type === 'SOLD' ? 'SOLD' : 'RENTED'
    );
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

  async getNegotiationDetails(params: {
    actorUserId: number;
    actorRole?: string;
    negotiationId: unknown;
  }) {
    const negotiationId = ensureInteger(params.negotiationId, 'negotiation_id');

    const negotiation = await this.negotiations.findById(negotiationId);
    if (!negotiation) {
      throw new ValidationError('Negociação não encontrada.', 404);
    }

    if (params.actorRole !== 'admin' && params.actorRole !== 'broker') {
      throw new ValidationError('Acesso negado.', 403);
    }

    if (
      params.actorRole === 'broker' &&
      params.actorUserId !== negotiation.captador_user_id &&
      params.actorUserId !== negotiation.seller_broker_user_id &&
      params.actorUserId !== negotiation.created_by_user_id
    ) {
      throw new ValidationError('Acesso negado para esta negociação.', 403);
    }

    const [documents, latestContract, signatures, closeSubmission] = await Promise.all([
      this.documents.findByNegotiationId(negotiationId),
      this.contracts.findLatestByNegotiationId(negotiationId),
      this.signatures.findByNegotiationId(negotiationId),
      this.closeSubmissions.findByNegotiationId(negotiationId),
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
