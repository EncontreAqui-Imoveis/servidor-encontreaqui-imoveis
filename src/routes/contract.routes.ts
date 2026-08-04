import { Router } from 'express';

import { contractController } from '../controllers/ContractController';
import { authMiddleware, isAdmin } from '../middlewares/auth';
import {
  forbidRestrictedAdminDocumentCreate,
  requireAdminCapability,
  restrictAdminManualDeletion,
} from '../middlewares/adminCapabilities';
import { contractAuthMiddleware } from '../middlewares/contractAuth.middleware';
import { contractDocumentUpload } from '../middlewares/uploadMiddleware';

const contractRoutes = Router();

contractRoutes.post('/admin/negotiations/:id/contract', authMiddleware, isAdmin, requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.createFromApprovedNegotiation(req, res)
);

contractRoutes.post('/admin/contracts/:id/generate-draft', authMiddleware, isAdmin, requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.generateDraft(req, res)
);

contractRoutes.get('/contracts/me', authMiddleware, (req, res) =>
  contractController.listMyContracts(req, res)
);

contractRoutes.get('/contracts/counters', authMiddleware, (req, res) =>
  contractController.getHubCounters(req, res)
);

contractRoutes.get('/contracts/:id', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.getById(req, res)
);

contractRoutes.get('/contracts/negotiation/:negotiationId', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.getByNegotiationId(req, res)
);

contractRoutes.get('/contracts/negotiation/:negotiationId/property', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.getPropertyByNegotiationId(req, res)
);

contractRoutes.patch(
  '/contracts/negotiation/:negotiationId/selling-broker',
  authMiddleware,
  isAdmin,
  requireAdminCapability('manage_contract_workflow'),
  (req, res) => contractController.updateSellingBrokerByNegotiation(req, res)
);

contractRoutes.put('/contracts/:id/data', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.updateData(req, res)
);

contractRoutes.post('/contracts/:id/signature-method', authMiddleware, isAdmin, requireAdminCapability('manage_contract_workflow'), (req, res) =>
  contractController.setSignatureMethod(req, res)
);

contractRoutes.post('/contracts/:id/verify-pin', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.verifyBuyerHandshakePin(req, res)
);

contractRoutes.post('/contracts/:id/reject-association', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.rejectBuyerHandshakeAssociation(req, res)
);

contractRoutes.post('/contracts/:id/draft-review', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.reviewDraft(req, res)
);

contractRoutes.post(
  '/contracts/:id/documents',
  authMiddleware,
  contractAuthMiddleware,
  contractDocumentUpload.single('file'),
  forbidRestrictedAdminDocumentCreate,
  (req, res) => contractController.uploadDocument(req, res)
);

contractRoutes.patch(
  '/contracts/:id/documents/:documentId/status',
  authMiddleware,
  isAdmin,
  requireAdminCapability('review_documents'),
  (req, res) => contractController.reviewDocument(req, res)
);

contractRoutes.delete('/contracts/:id/documents/:documentId', authMiddleware, restrictAdminManualDeletion, contractAuthMiddleware, (req, res) =>
  contractController.deleteDocument(req, res)
);

export default contractRoutes;
