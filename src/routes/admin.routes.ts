import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminController, sendNotification, getDashboardStats } from '../controllers/AdminController';
import { contractController } from '../controllers/ContractController';
import { authMiddleware as authMiddlewareAdmin, isAdmin as isAdminAdmin } from '../middlewares/auth';
import { requireAdminReauth } from '../middlewares/adminReauth';
import { mediaUpload } from '../middlewares/uploadMiddleware';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware';
import { contractDraftUpload } from '../middlewares/uploadMiddleware';
import { contractDocumentUpload } from '../middlewares/uploadMiddleware';
import { signedProposalUpload } from '../middlewares/uploadMiddleware';

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

adminRoutes.post('/notifications/send', sendNotification);
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
adminRoutes.get('/users', adminController.getAllUsers);
adminRoutes.post('/users', adminController.createUser);
adminRoutes.delete('/users/:id', requireAdminReauth, adminController.deleteUser);

adminRoutes.get('/clients', adminController.getAllClients);
adminRoutes.get('/clients/:id', adminController.getClientById);
adminRoutes.post('/clients/:id/promote-broker', adminController.promoteClientToBroker);
adminRoutes.put('/clients/:id', adminController.updateClient);
adminRoutes.delete('/clients/:id', requireAdminReauth, adminController.deleteClient);
adminRoutes.get('/clients/:id/properties', adminController.getClientProperties);

adminRoutes.post(
  '/brokers',
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  adminController.createBroker
);
adminRoutes.get('/brokers', adminController.listBrokers);
adminRoutes.get('/brokers/pending', adminController.listPendingBrokers);
adminRoutes.get('/brokers/:id', adminController.getBrokerById);
adminRoutes.patch('/brokers/:id/approve', adminController.approveBroker);
adminRoutes.patch('/brokers/:id/reject', adminController.rejectBroker);
adminRoutes.patch('/brokers/:id/status', adminController.updateBrokerStatus);
adminRoutes.put('/brokers/:id', adminController.updateBroker);
adminRoutes.delete('/brokers/:id', requireAdminReauth, adminController.deleteBroker);
adminRoutes.get('/brokers/:id/properties', adminController.getBrokerProperties);

adminRoutes.get('/properties-with-brokers', adminController.listPropertiesWithBrokers);
adminRoutes.get('/property-edit-requests', adminController.listPropertyEditRequests);
adminRoutes.get('/property-edit-requests/:id', adminController.getPropertyEditRequestById);
adminRoutes.post('/property-edit-requests/:id/review', adminController.reviewPropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/approve', adminController.approvePropertyEditRequest);
adminRoutes.post('/property-edit-requests/:id/reject', adminController.rejectPropertyEditRequest);
adminRoutes.get('/properties/archive', adminController.listArchivedProperties);
adminRoutes.put('/properties/:id/relist', adminController.relistProperty);
adminRoutes.get('/properties/:id', adminController.getPropertyDetails);
adminRoutes.put('/properties/:id', adminController.updateProperty);
adminRoutes.delete('/properties/:id', requireAdminReauth, adminController.deleteProperty);
adminRoutes.patch('/properties/:id/approve', adminController.approveProperty);
adminRoutes.patch('/properties/:id/reject', adminController.rejectProperty);
adminRoutes.patch('/properties/:id/status', adminController.updatePropertyStatus);
adminRoutes.get('/featured-properties', adminController.listFeaturedProperties);
adminRoutes.put('/featured-properties', adminController.updateFeaturedProperties);
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

adminRoutes.get('/dashboard/stats', getDashboardStats);
adminRoutes.get('/stats/dashboard', getDashboardStats);

export default adminRoutes;

