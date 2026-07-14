import { Router } from 'express';

import { contractController } from '../controllers/ContractController';
import { authMiddleware, isAdmin } from '../middlewares/auth';
import { contractAuthMiddleware } from '../middlewares/contractAuth.middleware';
import { contractDocumentUpload } from '../middlewares/uploadMiddleware';

const contractRoutes = Router();

contractRoutes.post('/admin/negotiations/:id/contract', authMiddleware, isAdmin, (req, res) =>
  contractController.createFromApprovedNegotiation(req, res)
);

contractRoutes.get('/contracts/me', authMiddleware, (req, res) =>
  contractController.listMyContracts(req, res)
);

contractRoutes.get('/contracts/:id', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.getById(req, res)
);

contractRoutes.get('/contracts/negotiation/:negotiationId', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.getByNegotiationId(req, res)
);

contractRoutes.get('/contracts/negotiation/:negotiationId/property', authMiddleware, (req, res) =>
  contractController.getPropertyByNegotiationId(req, res)
);

contractRoutes.patch(
  '/contracts/negotiation/:negotiationId/selling-broker',
  authMiddleware,
  (req, res) => contractController.updateSellingBrokerByNegotiation(req, res)
);

contractRoutes.put('/contracts/:id/data', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.updateData(req, res)
);

contractRoutes.post('/contracts/:id/signature-method', authMiddleware, isAdmin, (req, res) =>
  contractController.setSignatureMethod(req, res)
);

contractRoutes.post('/contracts/:id/verify-pin', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.verifyBuyerHandshakePin(req, res)
);

contractRoutes.post('/contracts/:id/reject-association', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.rejectBuyerHandshakeAssociation(req, res)
);

contractRoutes.post(
  '/contracts/:id/documents',
  authMiddleware,
  contractAuthMiddleware,
  contractDocumentUpload.single('file'),
  (req, res) => contractController.uploadDocument(req, res)
);

contractRoutes.patch(
  '/contracts/:id/documents/:documentId/status',
  authMiddleware,
  isAdmin,
  (req, res) => contractController.reviewDocument(req, res)
);

contractRoutes.delete('/contracts/:id/documents/:documentId', authMiddleware, contractAuthMiddleware, (req, res) =>
  contractController.deleteDocument(req, res)
);

export default contractRoutes;
