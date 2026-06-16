import { Request, Response } from 'express';
import {
  listArchivedProperties as loadArchivedProperties,
  listFeaturedProperties as loadFeaturedProperties,
  listPropertiesWithBrokers as loadPropertiesWithBrokers,
  relistProperty as relistCatalogProperty,
  updateFeaturedProperties as updateCatalogFeaturedProperties,
} from '../services/adminPropertyCatalogService';
import {
  deleteBrokerAccountAdmin,
  deleteClientAccountAdmin,
  deleteUserAccountAdmin,
  updateBrokerAccount,
  updateClientAccount,
} from '../services/adminAccountManagementService';
import {
  approveBroker as approveBrokerLifecycle,
  cleanupBroker as cleanupBrokerLifecycle,
  deleteBrokerDocument as deleteBrokerDocumentLifecycle,
  promoteClientToBroker as promoteClientToBrokerLifecycle,
  rejectBroker as rejectBrokerLifecycle,
  updateBrokerStatus as updateBrokerStatusLifecycle,
  uploadBrokerDocuments as uploadBrokerDocumentsLifecycle,
} from '../services/adminBrokerLifecycleService';
import {
  listNegotiationRequestSummary as loadAdminNegotiationRequestSummary,
  listNegotiationRequestsByProperty as loadAdminNegotiationRequestsByProperty,
  isInvalidNegotiationStatusFilter,
  parseNegotiationStatusFilter,
  listNegotiations as loadAdminNegotiations,
} from '../services/adminNegotiationListingService';
import {
  approveNegotiation as approveAdminNegotiation,
  cancelNegotiation as cancelAdminNegotiation,
  rejectNegotiation as rejectAdminNegotiation,
  updateNegotiationSellingBroker as updateNegotiationSellingBrokerMutation,
} from '../services/adminNegotiationMutationService';
import {
  generateProposalFromNegotiationDraft as generateAdminNegotiationDraft,
  generateProposalFromProperty as generateAdminNegotiationProposal,
} from '../services/negotiationProposalGenerationService';
import { updateProposalFromWizardAsAdmin as updateAdminProposalFromWizard } from '../services/negotiationProposalMutationService';
import {
  deleteSignedProposal as deleteAdminSignedProposal,
  deleteProposalDraft as deleteAdminProposalDraft,
  downloadProposalDraft as downloadAdminProposalDraft,
  downloadSignedProposal as downloadAdminSignedProposal,
  listNegotiationResponsibles as listAdminNegotiationResponsibles,
  updateNegotiationResponsibles as updateAdminNegotiationResponsibles,
  uploadSignedProposal as uploadAdminSignedProposal,
} from '../services/adminNegotiationDocumentService';
import {
  clearAnnouncementNotifications as clearAdminAnnouncementNotifications,
  clearNotifications as clearAdminNotifications,
  deleteNotification as deleteAdminNotification,
  getNotifications as loadAdminNotifications,
} from '../services/adminNotificationManagementService';
import {
  approveProperty as approveAdminProperty,
  getPropertyDetails as loadAdminPropertyDetails,
  rejectProperty as rejectAdminProperty,
  updatePropertyStatus as updateAdminPropertyStatus,
} from '../services/adminPropertyReviewService';
import {
  addPropertyImageAdmin,
  addPropertyVideoAdmin,
  deletePropertyImageAdmin,
  deletePropertyVideoAdmin,
} from '../services/adminPropertyMediaService';
import { createAdminProperty } from '../services/adminPropertyCreationService';
import { updateProperty as updateAdminProperty } from '../services/propertyUpdateService';
import { deleteProperty as deleteAdminPropertyLifecycle } from '../services/propertyLifecycleService';
import {
  approvePropertyEditRequest as approveAdminPropertyEditRequest,
  getPropertyEditRequestById as loadAdminPropertyEditRequestById,
  listPropertyEditRequests as loadAdminPropertyEditRequests,
  rejectPropertyEditRequest as rejectAdminPropertyEditRequest,
  reviewPropertyEditRequest as reviewAdminPropertyEditRequest,
} from '../services/adminPropertyEditRequestService';
import type AuthRequest from '../middlewares/auth';
import { login as adminLogin, logout as adminLogout, reauth as adminReauth } from '../services/adminAuthService';
import {
  createBrokerAccountAdmin,
  createUserAccountAdmin,
} from '../services/adminOnboardingService';
import { buildCloudinarySignature } from '../services/adminCloudinarySignatureService';
import { respondWithAppError } from '../utils/appErrorResponse';

function buildAttachmentDisposition(filename: string): string {
  const safeName = String(filename ?? '').trim() || 'download';
  const encoded = encodeURIComponent(safeName);
  return `attachment; filename="${safeName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`;
}

class AdminController {
  constructor() {
    for (const key of Object.getOwnPropertyNames(AdminController.prototype)) {
      if (key === 'constructor') continue;
      const value = (this as any)[key];
      if (typeof value === 'function') {
        (this as any)[key] = value.bind(this);
      }
    }
  }

  async login(req: Request, res: Response) {
    try {
      const payload = await adminLogin({
        email: req.body?.email,
        password: req.body?.password,
      });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async logout(req: AuthRequest, res: Response) {
    try {
      const payload = await adminLogout(req);
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async reauth(req: AuthRequest, res: Response) {
    try {
      const payload = await adminReauth(req, req.body?.password);
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async listNegotiations(req: Request, res: Response) {
    try {
      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
      const statusFilter = parseNegotiationStatusFilter(req.query.status);
      const payload = await loadAdminNegotiations({
        statusFilter,
        page,
        limit,
      });

      return res.status(200).json({
        data: payload.data,
        page: payload.page,
        limit: payload.limit,
        total: payload.total,
      });
    } catch (error) {
      console.error('Erro ao listar negociações para admin:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNegotiationRequestSummary(req: Request, res: Response) {
    try {
      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const statusFilter = parseNegotiationStatusFilter(req.query.status) ?? 'UNDER_REVIEW';
      const payload = await loadAdminNegotiationRequestSummary({
        statusFilter,
        page,
        limit,
      });

      return res.status(200).json({
        data: payload.data,
        page: payload.page,
        limit: payload.limit,
        total: payload.total,
      });
    } catch (error) {
      console.error('Erro ao listar resumo de solicitações por imóvel:', {
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
        code: (error as { code?: unknown })?.code ?? null,
        errno: (error as { errno?: unknown })?.errno ?? null,
        sqlMessage: (error as { sqlMessage?: unknown })?.sqlMessage ?? null,
      });
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNegotiationRequestsByProperty(req: Request, res: Response) {
    try {
      const propertyId = Number(req.params.propertyId);
      if (!Number.isInteger(propertyId) || propertyId <= 0) {
        return res.status(400).json({ error: 'propertyId inválido.' });
      }

      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const statusFilter = parseNegotiationStatusFilter(req.query.status) ?? 'UNDER_REVIEW';
      const payload = await loadAdminNegotiationRequestsByProperty({
        propertyId,
        statusFilter,
        page,
        limit,
      });

      return res.status(200).json({
        data: payload.data,
        page: payload.page,
        limit: payload.limit,
        total: payload.total,
        propertyId: payload.propertyId,
      });
    } catch (error) {
      console.error('Erro ao listar solicitações por imóvel:', {
        propertyId: req.params.propertyId,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
        code: (error as { code?: unknown })?.code ?? null,
        errno: (error as { errno?: unknown })?.errno ?? null,
        sqlMessage: (error as { sqlMessage?: unknown })?.sqlMessage ?? null,
      });
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async approveNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    try {
      const payload = await approveAdminNegotiation({ negotiationId, actorId });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async rejectNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Motivo da rejeição é obrigatório.' });
    }

    try {
      const payload = await rejectAdminNegotiation({ negotiationId, actorId, reason });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async cancelNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    if (reason.length < 5) {
      return res.status(400).json({ error: 'Motivo obrigatório com no mínimo 5 caracteres.' });
    }

    try {
      const payload = await cancelAdminNegotiation({ negotiationId, actorId, reason });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async generateProposalFromProperty(req: Request, res: Response) {
    try {
      return generateAdminNegotiationProposal(req as any, res);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async generateProposalDraft(req: AuthRequest, res: Response) {
    try {
      return generateAdminNegotiationDraft(req, res);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async updateProposalFromWizard(req: AuthRequest, res: Response) {
    try {
      return updateAdminProposalFromWizard(req, res);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async updateNegotiationSellingBroker(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }
    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    const sellerBrokerIdRaw = (req.body as { sellingBrokerId?: unknown })?.sellingBrokerId;
    const parsedSellerBrokerId =
      sellerBrokerIdRaw === undefined || sellerBrokerIdRaw === null || sellerBrokerIdRaw === ''
        ? null
        : Number(sellerBrokerIdRaw);
    if (
      parsedSellerBrokerId !== null &&
      (!Number.isInteger(parsedSellerBrokerId) || parsedSellerBrokerId <= 0)
    ) {
      return res.status(400).json({ error: 'ID do responsável operacional inválido.' });
    }

    try {
      const payload = await updateNegotiationSellingBrokerMutation({
        negotiationId,
        actorId,
        sellingBrokerIdRaw: parsedSellerBrokerId,
      });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async listNegotiationResponsibles(req: AuthRequest, res: Response) {
    try {
      const payload = await listAdminNegotiationResponsibles(String(req.params.id ?? ''));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async updateNegotiationResponsibles(req: AuthRequest, res: Response) {
    const rawIds = ((req.body as { responsibleIds?: unknown })?.responsibleIds ?? []) as unknown;
    if (!Array.isArray(rawIds)) {
      return res.status(400).json({ error: 'responsibleIds deve ser um array.' });
    }

    const normalizedIds = Array.from(
      new Set(
        rawIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    try {
      const payload = await updateAdminNegotiationResponsibles({
        negotiationId: String(req.params.id ?? ''),
        responsibleIds: normalizedIds,
        actorId: Number(req.userId ?? 0),
      });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async downloadSignedProposal(req: Request, res: Response) {
    try {
      const payload = await downloadAdminSignedProposal(String(req.params.id ?? ''));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', buildAttachmentDisposition(payload.filename));
      res.setHeader('Content-Length', payload.fileContent.length.toString());
      return res.status(200).send(payload.fileContent);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async downloadProposalDraft(req: Request, res: Response) {
    try {
      const payload = await downloadAdminProposalDraft(String(req.params.id ?? ''));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', buildAttachmentDisposition(payload.filename));
      res.setHeader('Content-Length', payload.fileContent.length.toString());
      return res.status(200).send(payload.fileContent);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async uploadSignedProposal(req: AuthRequest, res: Response) {
    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;

    try {
      const payload = await uploadAdminSignedProposal({
        negotiationId: String(req.params.id ?? ''),
        actorId: Number(req.userId),
        file: {
          buffer: uploadedFile?.buffer ?? Buffer.alloc(0),
          mimetype: uploadedFile?.mimetype,
          originalname: uploadedFile?.originalname,
        },
      });
      return res.status(201).json({
        message: 'PDF assinado enviado com sucesso.',
        ...payload,
      });
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteSignedProposal(req: AuthRequest, res: Response) {
    try {
      const payload = await deleteAdminSignedProposal({
        negotiationId: String(req.params.id ?? ''),
        actorId: Number(req.userId),
      });
      return res.status(200).json({
        message: 'PDF assinado removido com sucesso.',
        ...payload,
      });
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteProposalDraft(req: AuthRequest, res: Response) {
    try {
      const payload = await deleteAdminProposalDraft({
        negotiationId: String(req.params.id ?? ''),
        actorId: Number(req.userId),
      });
      return res.status(200).json({
        message: 'Minuta removida com sucesso.',
        ...payload,
      });
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async listPropertiesWithBrokers(req: Request, res: Response) {
    try {
      const payload = await loadPropertiesWithBrokers(req.query);
      return res.status(200).json(payload);
    } catch (error) {
      console.error('Erro ao listar imoveis com corretores:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listPropertyEditRequests(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const result = await loadAdminPropertyEditRequests({
        page,
        limit,
        status: String(req.query.status ?? 'PENDING'),
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async getPropertyEditRequestById(req: Request, res: Response) {
    const requestId = Number(req.params.id);

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    try {
      const result = await loadAdminPropertyEditRequestById(requestId);
      return res.status(200).json(result);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async reviewPropertyEditRequest(req: AuthRequest, res: Response) {
    const requestId = Number(req.params.id);
    const reviewerId = req.userId ?? null;

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    try {
      const result = await reviewAdminPropertyEditRequest({
        requestId,
        reviewerId,
        body: (req.body ?? {}) as Record<string, unknown>,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async approvePropertyEditRequest(req: AuthRequest, res: Response) {
    const requestId = Number(req.params.id);
    const reviewerId = req.userId ?? null;

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    try {
      const result = await approveAdminPropertyEditRequest({
        requestId,
        reviewerId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async rejectPropertyEditRequest(req: AuthRequest, res: Response) {
    const requestId = Number(req.params.id);
    const reviewerId = req.userId ?? null;

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    try {
      const result = await rejectAdminPropertyEditRequest({
        requestId,
        reviewerId,
        reason: req.body?.reason != null ? String(req.body.reason) : null,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async listArchivedProperties(req: Request, res: Response) {
    try {
      const payload = await loadArchivedProperties(req.query);
      return res.status(200).json(payload);
    } catch (error) {
      console.error('Erro ao listar imóveis vendidos/alugados:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async relistProperty(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    try {
      const payload = await relistCatalogProperty(propertyId);
      return res.status(200).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('não encontrado')) {
        return res.status(404).json({ error: message });
      }
      if (message.includes('Apenas imóveis vendidos ou alugados')) {
        return res.status(400).json({ error: message });
      }
      console.error('Erro ao disponibilizar imóvel novamente:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listFeaturedProperties(req: Request, res: Response) {
    try {
      const payload = await loadFeaturedProperties();
      return res.status(200).json(payload);
    } catch (error) {
      console.error('Erro ao listar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateFeaturedProperties(req: Request, res: Response) {
    try {
      const payload = await updateCatalogFeaturedProperties(req.body ?? {});
      return res.status(200).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Limite maximo de')) {
        return res.status(400).json({ error: message });
      }
      if (message.includes('Alguns imoveis não estão aprovados.')) {
        const invalidIds = (error as Error & { invalidIds?: number[] }).invalidIds ?? [];
        return res.status(400).json({ error: message, invalidIds });
      }
      if (message.includes('Finalidade do imóvel não compatível')) {
        const invalidScope = (error as Error & { invalidScope?: { id: number; scope: string }[] }).invalidScope ?? [];
        return res.status(400).json({ error: message, invalidScope });
      }
      console.error('Erro ao atualizar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateBroker(req: Request, res: Response) {
    try {
      const payload = await updateBrokerAccount({
        brokerId: Number(req.params.id),
        body: (req.body ?? {}) as Record<string, unknown>,
      });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async updateClient(req: Request, res: Response) {
    try {
      const payload = await updateClientAccount({
        clientId: Number(req.params.id),
        body: (req.body ?? {}) as Record<string, unknown>,
      });
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteUser(req: Request, res: Response) {
    try {
      const payload = await deleteUserAccountAdmin(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteClient(req: Request, res: Response) {
    try {
      const payload = await deleteClientAccountAdmin(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteBroker(req: Request, res: Response) {
    try {
      const payload = await deleteBrokerAccountAdmin(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteProperty(req: Request, res: Response) {
    return deleteAdminPropertyLifecycle(req as any, res);
  }

  async updateProperty(req: Request, res: Response) {
    (req as AuthRequest).userRole = 'admin';
    return updateAdminProperty(req as AuthRequest, res);
  }

  async addPropertyImage(req: Request, res: Response) {
    try {
      const payload = await addPropertyImageAdmin(
        Number(req.params.id),
        req.files as Express.Multer.File[] | undefined ?? []
      );
      return res.status(201).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deletePropertyImage(req: Request, res: Response) {
    try {
      const payload = await deletePropertyImageAdmin(
        Number(req.params.id),
        Number(req.params.imageId)
      );
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async addPropertyVideo(req: Request, res: Response) {
    try {
      const payload = await addPropertyVideoAdmin(
        Number(req.params.id),
        (req as any).file as Express.Multer.File | undefined
      );
      return res.status(201).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deletePropertyVideo(req: Request, res: Response) {
    try {
      const payload = await deletePropertyVideoAdmin(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async getNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      const payload = await loadAdminNotifications({
        adminId,
        page: req.query.page,
        limit: req.query.limit,
        type: req.query.type,
      });
      return res.status(200).json(payload);
    } catch (error) {
      console.error('Erro ao buscar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteNotification(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);
    const notificationId = Number(req.params.id);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ error: 'Identificador de notificacao invalido.' });
    }

    try {
      const deleted = await deleteAdminNotification({ adminId, notificationId });
      if (!deleted) {
        return res.status(404).json({ error: 'Notificacao nao encontrada.' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao deletar notificacao:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async clearNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      await clearAdminNotifications(adminId);
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao limpar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async clearAnnouncementNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      await clearAdminAnnouncementNotifications(adminId);
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao limpar avisos:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async signCloudinaryUpload(req: Request, res: Response) {
    try {
      const payload = buildCloudinarySignature(req.body?.resource_type);
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async createProperty(req: Request, res: Response) {
    return createAdminProperty(req, res);
  }

  async createBroker(req: Request, res: Response) {
    try {
      const payload = await createBrokerAccountAdmin({
        body: (req.body ?? {}) as Record<string, unknown>,
        files: req.files as { [fieldname: string]: Express.Multer.File[] } | undefined,
      });
      return res.status(201).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async createUser(req: Request, res: Response) {
    try {
      const payload = await createUserAccountAdmin({
        body: (req.body ?? {}) as Record<string, unknown>,
      });
      return res.status(201).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async promoteClientToBroker(req: Request, res: Response) {
    try {
      const payload = await promoteClientToBrokerLifecycle(
        Number(req.params.id),
        (req.body as { creci?: unknown })?.creci
      );
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async approveBroker(req: Request, res: Response) {
    try {
      const payload = await approveBrokerLifecycle(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async rejectBroker(req: Request, res: Response) {
    try {
      const payload = await rejectBrokerLifecycle(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async cleanupBroker(req: Request, res: Response) {
    try {
      const payload = await cleanupBrokerLifecycle(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async demoteClientBroker(req: Request, res: Response) {
    return this.cleanupBroker(req, res);
  }

  async updateBrokerStatus(req: Request, res: Response) {
    try {
      const payload = await updateBrokerStatusLifecycle(Number(req.params.id), req.body?.status);
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async uploadBrokerDocuments(req: Request, res: Response) {
    try {
      const payload = await uploadBrokerDocumentsLifecycle(
        Number(req.params.id),
        req.files as any,
      );
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async deleteBrokerDocument(req: Request, res: Response) {
    try {
      const payload = await deleteBrokerDocumentLifecycle(
        Number(req.params.id),
        req.params.docType as 'creciFront' | 'creciBack' | 'selfie',
      );
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async getPropertyDetails(req: Request, res: Response) {
    try {
      const payload = await loadAdminPropertyDetails(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async approveProperty(req: Request, res: Response) {
    try {
      const payload = await approveAdminProperty(Number(req.params.id));
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async rejectProperty(req: Request, res: Response) {
    try {
      const payload = await rejectAdminProperty(
        Number(req.params.id),
        req.body && typeof (req.body as { reason?: unknown }).reason === 'string'
          ? String((req.body as { reason: string }).reason).trim()
          : ''
      );
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }

  async updatePropertyStatus(req: Request, res: Response) {
    try {
      const propertyId = Number(req.params.id);
      const { status } = req.body ?? {};

      if (typeof status !== 'string') {
        return res.status(400).json({ error: 'Status inválido.' });
      }

      const normalizedStatus = status.trim();
      if (normalizedStatus === 'rejected') {
        return this.rejectProperty(req, res);
      }

      const payload = await updateAdminPropertyStatus(propertyId, normalizedStatus);
      return res.status(200).json(payload);
    } catch (error) {
      return respondWithAppError(res, error);
    }
  }
}


export const adminController = new AdminController();

