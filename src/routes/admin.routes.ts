import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminController } from '../controllers/AdminController';
import { contractController } from '../controllers/ContractController';
import { authMiddleware as authMiddlewareAdmin, isAdmin as isAdminAdmin } from '../middlewares/auth';
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

const adminRoutes = Router();

const adminAuthWindowMs = Number(process.env.ADMIN_AUTH_RATE_LIMIT_WINDOW_MS);
const adminAuthLimit = Number(process.env.ADMIN_AUTH_RATE_LIMIT_MAX);

const adminAuthLimiter = rateLimit({
  windowMs:
    Number.isFinite(adminAuthWindowMs) && adminAuthWindowMs > 0
      ? adminAuthWindowMs
      : 15 * 60 * 1000,
  limit:
    Number.isFinite(adminAuthLimit) && adminAuthLimit > 0
      ? adminAuthLimit
      : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de login administrativo. Tente novamente em instantes.',
  },
});

adminRoutes.post('/login', adminAuthLimiter, adminController.login);

adminRoutes.use(authMiddlewareAdmin, isAdminAdmin);
adminRoutes.post('/logout', adminController.logout);
adminRoutes.post('/reauth', adminController.reauth);

adminRoutes.post('/notifications/send', async (req, res) => {
  try {
    const result = await sendAdminNotification(req.body as Record<string, unknown>);
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Erro ao enviar notificacao:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
adminRoutes.delete('/notifications/announcements', adminController.clearAnnouncementNotifications);
adminRoutes.delete('/notifications/:id', adminController.deleteNotification);
adminRoutes.delete('/notifications', adminController.clearNotifications);
adminRoutes.post('/uploads/sign', adminController.signCloudinaryUpload);
adminRoutes.get('/negotiations', adminController.listNegotiations);
adminRoutes.get('/negotiations/requests/summary', adminController.listNegotiationRequestSummary);
adminRoutes.get('/negotiations/requests/property/:propertyId', adminController.listNegotiationRequestsByProperty);
adminRoutes.put('/negotiations/:id/approve', adminController.approveNegotiation);
adminRoutes.put('/negotiations/:id/reject', adminController.rejectNegotiation);
adminRoutes.put('/negotiations/:id/cancel', adminController.cancelNegotiation);
adminRoutes.put('/negotiations/:id/selling-broker', (req, res) =>
  (adminController as any).updateNegotiationSellingBroker(req, res)
);
adminRoutes.post('/negotiations/proposal', (req, res) =>
  (adminController as any).generateProposalFromProperty(req, res)
);
adminRoutes.get('/negotiations/:id/responsibles', (req, res) =>
  (adminController as any).listNegotiationResponsibles(req, res)
);
adminRoutes.put('/negotiations/:id/responsibles', (req, res) =>
  (adminController as any).updateNegotiationResponsibles(req, res)
);
adminRoutes.get('/negotiations/:id/signed-proposal/download', adminController.downloadSignedProposal);
adminRoutes.post(
  '/negotiations/:id/signed-proposal',
  signedProposalUpload.single('file'),
  adminController.uploadSignedProposal
);
adminRoutes.delete('/negotiations/:id/signed-proposal', adminController.deleteSignedProposal);
adminRoutes.get('/contracts', (req, res) => contractController.listForAdmin(req, res));
adminRoutes.get('/contracts/:id/documents.zip', (req, res) =>
  contractController.downloadDocumentsZip(req, res)
);
adminRoutes.get('/commissions', (req, res) =>
  contractController.listCommissions(req, res)
);
adminRoutes.put('/contracts/:id/transition', (req, res) =>
  contractController.transitionStatus(req, res)
);
adminRoutes.put('/contracts/:id/evaluate-side', (req, res) =>
  contractController.evaluateSide(req, res)
);
adminRoutes.put('/contracts/:id/evaluate-category', (req, res) =>
  contractController.evaluateCategory(req, res)
);
adminRoutes.put('/contracts/:id/data', (req, res) => contractController.updateData(req, res));
adminRoutes.post(
  '/contracts/:id/draft',
  contractDraftUpload.single('file'),
  (req, res) => contractController.uploadDraft(req, res)
);
adminRoutes.post(
  '/contracts/:id/signed-docs',
  contractDocumentUpload.single('file'),
  (req, res) => contractController.uploadSignedDocs(req, res)
);
adminRoutes.post('/contracts/:id/finalize', (req, res) =>
  contractController.finalize(req, res)
);
adminRoutes.put('/contracts/:id/reopen', (req, res) =>
  contractController.reopenFinalized(req, res)
);
adminRoutes.delete('/contracts/:id', (req, res) =>
  contractController.deleteFinalized(req, res)
);
adminRoutes.put('/contracts/:id/commission-data', (req, res) =>
  contractController.updateCommissionData(req, res)
);
adminRoutes.delete('/contracts/:id/commission-data', (req, res) =>
  contractController.deleteCommissionData(req, res)
);
adminRoutes.post(
  '/contracts/:id/finalized-docs',
  contractDocumentUpload.single('file'),
  (req, res) => contractController.uploadFinalizedDocument(req, res)
);
adminRoutes.delete('/contracts/:id/finalized-docs/:documentId', (req, res) =>
  contractController.deleteFinalizedDocument(req, res)
);

adminRoutes.post(
  '/properties',
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
adminRoutes.post('/users', adminController.createUser);
adminRoutes.delete('/users/:id', requireAdminReauth, adminController.deleteUser);

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
adminRoutes.post('/clients/:id/promote-broker', adminController.promoteClientToBroker);
adminRoutes.post('/clients/:id/demote-broker', adminController.demoteClientBroker);
adminRoutes.put('/clients/:id', adminController.updateClient);
adminRoutes.delete('/clients/:id', requireAdminReauth, adminController.deleteClient);
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
adminRoutes.patch('/brokers/:id/approve', adminController.approveBroker);
adminRoutes.patch('/brokers/:id/reject', adminController.rejectBroker);
adminRoutes.patch('/brokers/:id/status', adminController.updateBrokerStatus);
adminRoutes.put('/brokers/:id', adminController.updateBroker);
adminRoutes.delete('/brokers/:id', requireAdminReauth, adminController.deleteBroker);

adminRoutes.post(
  '/brokers/:id/documents',
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  adminController.uploadBrokerDocuments
);
adminRoutes.delete('/brokers/:id/documents/:docType', adminController.deleteBrokerDocument);
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
adminRoutes.post('/property-edit-requests/:id/review', adminController.reviewPropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/approve', adminController.approvePropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/reject', adminController.rejectPropertyEditRequest);
adminRoutes.get('/properties/archive', async (req, res) => {
  try {
    const payload = await loadArchivedProperties(req.query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar imóveis vendidos/alugados:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.put('/properties/:id/relist', async (req, res) => {
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
adminRoutes.put('/properties/:id', adminController.updateProperty);
adminRoutes.delete('/properties/:id', requireAdminReauth, adminController.deleteProperty);
adminRoutes.patch('/properties/:id/approve', adminController.approveProperty);
adminRoutes.patch('/properties/:id/reject', adminController.rejectProperty);
adminRoutes.patch('/properties/:id/status', adminController.updatePropertyStatus);
adminRoutes.get('/featured-properties', async (_req, res) => {
  try {
    const payload = await loadFeaturedProperties();
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar destaques:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
});
adminRoutes.put('/featured-properties', async (req, res) => {
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
  mediaUpload.array('images', 20),
  adminController.addPropertyImage
);
adminRoutes.post(
  '/properties/:id/video',
  mediaUpload.single('video'),
  adminController.addPropertyVideo
);
adminRoutes.delete('/properties/:id/video', adminController.deletePropertyVideo);
adminRoutes.delete('/properties/:id/images/:imageId', adminController.deletePropertyImage);

adminRoutes.get('/notifications', adminController.getNotifications);
adminRoutes.post('/brokers/:id/cleanup', adminController.cleanupBroker);

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

