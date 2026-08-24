import { Router } from 'express';
import { adminController } from '../controllers/AdminController';
import { contractController } from '../controllers/ContractController';
import { authMiddleware as authMiddlewareAdmin, isAdmin as isAdminAdmin } from '../middlewares/auth';
import {
  requireAdminCapability,
  requireRestrictedAdminDocumentReplacement,
} from '../middlewares/adminCapabilities';
import { requireAdminReauth } from '../middlewares/adminReauth';
import { mediaUpload } from '../middlewares/uploadMiddleware';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware';
import { contractDraftUpload } from '../middlewares/uploadMiddleware';
import { contractDocumentUpload } from '../middlewares/uploadMiddleware';
import { signedProposalUpload } from '../middlewares/uploadMiddleware';
import { loadAdminDashboardStats } from '../services/adminDashboardService';
import {
  getAdminBrokerById,
  getAdminBrokerProperties,
  getAdminClientById,
  getAdminClientProperties,
  listAdminBrokers,
  listAdminClients,
  listAdminUsers,
  listPendingAdminBrokers,
} from '../services/adminAccountDirectoryService';
import { sendAdminNotification } from '../services/adminNotificationService';
import {
  listArchivedProperties as loadArchivedProperties,
  listFeaturedProperties as loadFeaturedProperties,
  listPropertiesWithBrokers as loadPropertiesWithBrokers,
  relistProperty as relistCatalogProperty,
  updateFeaturedProperties as updateCatalogFeaturedProperties,
} from '../services/adminPropertyCatalogService';
import { createAdminLoginLimiter } from '../config/rateLimiters';

const adminRoutes = Router();
const adminAuthLimiter = createAdminLoginLimiter();

adminRoutes.post('/login', adminAuthLimiter, adminController.login);

adminRoutes.use(authMiddlewareAdmin, isAdminAdmin);
adminRoutes.get('/me', adminController.getProfile);
adminRoutes.post('/logout', adminController.logout);
adminRoutes.post('/reauth', adminController.reauth);
adminRoutes.put('/me/password', adminController.changeOwnAdministrativePassword);
adminRoutes.get('/assistants', requireAdminCapability('manage_administration'), adminController.listAdministrativeAssistants);
adminRoutes.post('/assistants', requireAdminCapability('manage_administration'), adminController.createAdministrativeAssistant);
adminRoutes.patch('/assistants/:id', requireAdminCapability('manage_administration'), adminController.updateAdministrativeAssistant);
adminRoutes.delete('/assistants/:id', requireAdminCapability('manage_administration'), requireAdminReauth, adminController.deactivateAdministrativeAssistant);
adminRoutes.post('/assistants/:id/reactivate', requireAdminCapability('manage_administration'), adminController.reactivateAdministrativeAssistant);
adminRoutes.put('/assistants/:id/password', requireAdminCapability('manage_administration'), requireAdminReauth, adminController.resetAdministrativeAssistantPassword);

adminRoutes.post('/notifications/send', requireAdminCapability('manage_administration'), async (req, res) => {
  try {
    const result = await sendAdminNotification(req.body as Record<string, unknown>);
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Erro ao enviar notificacao:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.delete('/notifications/announcements', requireAdminCapability('delete'), adminController.clearAnnouncementNotifications);
adminRoutes.delete('/notifications/:id', requireAdminCapability('delete'), adminController.deleteNotification);
adminRoutes.delete('/notifications', requireAdminCapability('delete'), adminController.clearNotifications);
adminRoutes.post('/uploads/sign', requireAdminCapability('manage_administration'), adminController.signCloudinaryUpload);
adminRoutes.get('/negotiations', adminController.listNegotiations);
adminRoutes.get('/negotiations/requests/summary', adminController.listNegotiationRequestSummary);
adminRoutes.get('/negotiations/requests/property/:propertyId', adminController.listNegotiationRequestsByProperty);
adminRoutes.put('/negotiations/:id/approve', requireAdminCapability('manage_contract_workflow'), adminController.approveNegotiation);
adminRoutes.put('/negotiations/:id/reject', requireAdminCapability('manage_contract_workflow'), adminController.rejectNegotiation);
adminRoutes.put('/negotiations/:id/cancel', requireAdminCapability('manage_contract_workflow'), adminController.cancelNegotiation);
adminRoutes.put('/negotiations/:id/selling-broker', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  (adminController as any).updateNegotiationSellingBroker(req, res)
);
adminRoutes.post('/negotiations/proposal', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  (adminController as any).generateProposalFromProperty(req, res)
);
adminRoutes.post('/negotiations/:id/minuta', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  (adminController as any).generateProposalDraft(req, res)
);
adminRoutes.delete('/negotiations/:id/minuta', requireAdminCapability('delete'), (req, res) =>
  (adminController as any).deleteProposalDraft(req, res)
);
adminRoutes.put('/negotiations/:id/draft', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  (adminController as any).updateProposalFromWizard(req, res)
);
adminRoutes.get('/negotiations/:id/responsibles', (req, res) =>
  (adminController as any).listNegotiationResponsibles(req, res)
);
adminRoutes.put('/negotiations/:id/responsibles', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  (adminController as any).updateNegotiationResponsibles(req, res)
);
adminRoutes.get('/negotiations/:id/signed-proposal/download', adminController.downloadSignedProposal);
adminRoutes.get('/negotiations/:id/minuta/download', adminController.downloadProposalDraft);
adminRoutes.post(
  '/negotiations/:id/signed-proposal',
  requireAdminCapability('manage_contract_workflow'),
  signedProposalUpload.single('file'),
  adminController.uploadSignedProposal
);
adminRoutes.delete('/negotiations/:id/signed-proposal', requireAdminCapability('delete'), adminController.deleteSignedProposal);
adminRoutes.get('/contracts', (req, res) => contractController.listForAdmin(req, res));
adminRoutes.get('/contracts/:id/documents.zip', (req, res) =>
  contractController.downloadDocumentsZip(req, res)
);
adminRoutes.get('/commissions', (req, res) =>
  contractController.listCommissions(req, res)
);
adminRoutes.put('/contracts/:id/transition', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.transitionStatus(req, res)
);
adminRoutes.put('/contracts/:id/evaluate-side', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.evaluateSide(req, res)
);
adminRoutes.put('/contracts/:id/evaluate-category', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.evaluateCategory(req, res)
);
adminRoutes.put('/contracts/:id/documents/:documentId/review', requireAdminCapability('review_documents'), (req, res) =>
  contractController.reviewDocument(req, res)
);
adminRoutes.get('/contracts/:id/document-rejections', (req, res) =>
  contractController.listDocumentRejections(req, res)
);
adminRoutes.put('/contracts/:id/data', requireAdminCapability('manage_contract_workflow'), (req, res) => contractController.updateData(req, res));
adminRoutes.post(
  '/contracts/:id/draft',
  requireAdminCapability('manage_contract_workflow'),
  contractDraftUpload.single('file'),
  (req, res) => contractController.uploadDraft(req, res)
);
adminRoutes.post(
  '/contracts/:id/signed-docs',
  requireAdminCapability('replace_documents'),
  contractDocumentUpload.single('file'),
  requireRestrictedAdminDocumentReplacement,
  (req, res) => contractController.uploadSignedDocs(req, res)
);
adminRoutes.post('/contracts/:id/finalize', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.finalize(req, res)
);
adminRoutes.put('/contracts/:id/reopen', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.reopenFinalized(req, res)
);
adminRoutes.delete('/contracts/:id', requireAdminCapability('delete'), (req, res) =>
  contractController.deleteFinalized(req, res)
);
adminRoutes.put('/contracts/:id/commission-data', requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.updateCommissionData(req, res)
);
adminRoutes.delete('/contracts/:id/commission-data', requireAdminCapability('delete'), (req, res) =>
  contractController.deleteCommissionData(req, res)
);
adminRoutes.post(
  '/contracts/:id/finalized-docs',
  requireAdminCapability('replace_documents'),
  contractDocumentUpload.single('file'),
  requireRestrictedAdminDocumentReplacement,
  (req, res) => contractController.uploadFinalizedDocument(req, res)
);
adminRoutes.delete('/contracts/:id/finalized-docs/:documentId', requireAdminCapability('delete'), (req, res) =>
  contractController.deleteFinalizedDocument(req, res)
);

adminRoutes.post(
  '/properties',
  requireAdminCapability('manage_administration'),
  mediaUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
  ]),
  adminController.createProperty
);
adminRoutes.get('/users', async (req, res) => {
  try {
    const payload = await listAdminUsers(req.query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar usuarios:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.post('/users', requireAdminCapability('manage_administration'), adminController.createUser);
adminRoutes.delete('/users/:id', requireAdminCapability('delete'), requireAdminReauth, adminController.deleteUser);

adminRoutes.get('/clients', async (_req, res) => {
  try {
    const payload = await listAdminClients();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.get('/clients/:id', async (req, res) => {
  const clientId = Number(req.params.id);
  if (Number.isNaN(clientId)) {
    return res.status(400).json({ error: 'Identificador de cliente invalido.' });
  }
  try {
    const payload = await getAdminClientById(clientId);
    if (!payload) {
      return res.status(404).json({ error: 'Cliente nao encontrado.' });
    }
    return res.status(200).json({ data: payload });
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.post('/clients/:id/promote-broker', requireAdminCapability('manage_administration'), adminController.promoteClientToBroker);
adminRoutes.post('/clients/:id/demote-broker', requireAdminCapability('manage_administration'), adminController.demoteClientBroker);
adminRoutes.put('/clients/:id', requireAdminCapability('manage_administration'), adminController.updateClient);
adminRoutes.delete('/clients/:id', requireAdminCapability('delete'), requireAdminReauth, adminController.deleteClient);
adminRoutes.get('/clients/:id/properties', async (req, res) => {
  const clientId = Number(req.params.id);
  if (Number.isNaN(clientId)) {
    return res.status(400).json({ error: 'Identificador de cliente invalido.' });
  }
  try {
    const payload = await getAdminClientProperties(clientId);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar imoveis do cliente:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});

adminRoutes.post(
  '/brokers',
  requireAdminCapability('manage_administration'),
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  adminController.createBroker
);
adminRoutes.get('/brokers', async (req, res) => {
  try {
    const payload = await listAdminBrokers(req.query);
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Status de corretor inválido')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao buscar corretores:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.get('/brokers/pending', async (_req, res) => {
  try {
    const payload = await listPendingAdminBrokers();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar corretores pendentes:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.get('/brokers/:id', async (req, res) => {
  const brokerId = Number(req.params.id);
  if (Number.isNaN(brokerId)) {
    return res.status(400).json({ error: 'Identificador de corretor invalido.' });
  }
  try {
    const payload = await getAdminBrokerById(brokerId);
    if (!payload) {
      return res.status(404).json({ error: 'Corretor nao encontrado.' });
    }
    return res.status(200).json({ data: payload });
  } catch (error) {
    console.error('Erro ao buscar corretor:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.patch('/brokers/:id/approve', requireAdminCapability('manage_administration'), adminController.approveBroker);
adminRoutes.patch('/brokers/:id/reject', requireAdminCapability('manage_administration'), adminController.rejectBroker);
adminRoutes.patch('/brokers/:id/status', requireAdminCapability('manage_administration'), adminController.updateBrokerStatus);
adminRoutes.put('/brokers/:id', requireAdminCapability('manage_administration'), adminController.updateBroker);
adminRoutes.delete('/brokers/:id', requireAdminCapability('delete'), requireAdminReauth, adminController.deleteBroker);

adminRoutes.post(
  '/brokers/:id/documents',
  requireAdminCapability('manage_administration'),
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  adminController.uploadBrokerDocuments
);
adminRoutes.delete('/brokers/:id/documents/:docType', requireAdminCapability('delete'), adminController.deleteBrokerDocument);
adminRoutes.get('/brokers/:id/properties', async (req, res) => {
  const brokerId = Number(req.params.id);
  if (Number.isNaN(brokerId)) {
    return res.status(400).json({ error: 'Identificador de corretor invalido.' });
  }
  try {
    const payload = await getAdminBrokerProperties(brokerId);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar imoveis do corretor:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});

adminRoutes.get('/properties-with-brokers', async (req, res) => {
  try {
    const payload = await loadPropertiesWithBrokers(req.query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar imoveis com corretores:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.get('/property-edit-requests', adminController.listPropertyEditRequests);
adminRoutes.get('/property-edit-requests/:id', adminController.getPropertyEditRequestById);
adminRoutes.post('/property-edit-requests/:id/review', requireAdminCapability('manage_administration'), adminController.reviewPropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/approve', requireAdminCapability('manage_administration'), adminController.approvePropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/reject', requireAdminCapability('manage_administration'), adminController.rejectPropertyEditRequest);
adminRoutes.get('/properties/archive', async (req, res) => {
  try {
    const payload = await loadArchivedProperties(req.query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar imóveis vendidos/alugados:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.put('/properties/:id/relist', requireAdminCapability('manage_administration'), async (req, res) => {
  const propertyId = Number(req.params.id);
  if (Number.isNaN(propertyId)) {
    return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
  }
  try {
    const payload = await relistCatalogProperty(propertyId);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao disponibilizar imóvel novamente:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Ocorreu um erro inesperado no servidor.',
    });
  }
});
adminRoutes.get('/properties/:id', adminController.getPropertyDetails);
adminRoutes.put('/properties/:id', requireAdminCapability('manage_administration'), adminController.updateProperty);
adminRoutes.delete('/properties/:id', requireAdminCapability('delete'), requireAdminReauth, adminController.deleteProperty);
adminRoutes.patch('/properties/:id/approve', requireAdminCapability('manage_administration'), adminController.approveProperty);
adminRoutes.patch('/properties/:id/reject', requireAdminCapability('manage_administration'), adminController.rejectProperty);
adminRoutes.patch('/properties/:id/status', requireAdminCapability('manage_administration'), adminController.updatePropertyStatus);
adminRoutes.get('/featured-properties', async (_req, res) => {
  try {
    const payload = await loadFeaturedProperties();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar destaques:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.put('/featured-properties', requireAdminCapability('manage_administration'), async (req, res) => {
  try {
    const payload = await updateCatalogFeaturedProperties(req.body as Record<string, unknown>);
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Limite maximo')) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof Error && error.message.includes('Alguns imoveis')) {
      return res.status(400).json({ error: error.message, invalidIds: (error as Error & { invalidIds?: number[] }).invalidIds });
    }
    if (error instanceof Error && error.message.includes('Finalidade do imóvel')) {
      return res.status(400).json({ error: error.message, invalidScope: (error as Error & { invalidScope?: Array<{ id: number; scope: string }> }).invalidScope });
    }
    console.error('Erro ao atualizar destaques:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.post(
  '/properties/:id/images',
  requireAdminCapability('manage_administration'),
  mediaUpload.array('images', 20),
  adminController.addPropertyImage
);
adminRoutes.post(
  '/properties/:id/video',
  requireAdminCapability('manage_administration'),
  mediaUpload.single('video'),
  adminController.addPropertyVideo
);
adminRoutes.delete('/properties/:id/video', requireAdminCapability('delete'), adminController.deletePropertyVideo);
adminRoutes.delete('/properties/:id/images/:imageId', requireAdminCapability('delete'), adminController.deletePropertyImage);

adminRoutes.get('/notifications', adminController.getNotifications);
adminRoutes.post('/brokers/:id/cleanup', requireAdminCapability('manage_administration'), adminController.cleanupBroker);

adminRoutes.get('/dashboard/stats', async (_req, res) => {
  try {
    const payload = await loadAdminDashboardStats();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar estatisticas do dashboard:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.get('/stats/dashboard', async (req, res) => {
  try {
    const payload = await loadAdminDashboardStats();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao buscar estatisticas do dashboard:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

export default adminRoutes;

