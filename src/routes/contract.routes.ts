import { Router } from 'express';

import { contractController } from '../controllers/ContractController';
import { authMiddleware, isAdmin } from '../middlewares/auth';
import { contractDocumentUpload } from '../middlewares/uploadMiddleware';

const contractRoutes = Router();

contractRoutes.post('/admin/negotiations/:id/contract', authMiddleware, isAdmin, (req, res) =>
  contractController.createFromApprovedNegotiation(req, res)
);

contractRoutes.get('/contracts/me', authMiddleware, (req, res) =>
  contractController.listMyContracts(req, res)
);

contractRoutes.get('/contracts/:id', authMiddleware, (req, res) =>
  contractController.getById(req, res)
);

contractRoutes.get('/contracts/negotiation/:negotiationId', authMiddleware, (req, res) =>
  contractController.getByNegotiationId(req, res)
);

contractRoutes.put('/contracts/:id/data', authMiddleware, (req, res) =>
  contractController.updateData(req, res)
);

contractRoutes.post(
  '/contracts/:id/documents',
  authMiddleware,
  contractDocumentUpload.single('file'),
  (req, res) => contractController.uploadDocument(req, res)
);

export default contractRoutes;
