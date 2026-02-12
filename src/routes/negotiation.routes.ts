import { Router } from 'express';

import { negotiationController } from '../controllers/NegotiationController';
import { authMiddleware } from '../middlewares/auth';

const negotiationRoutes = Router();

negotiationRoutes.post('/:id/proposals', authMiddleware, (req, res) =>
  negotiationController.generateProposal(req as any, res)
);

negotiationRoutes.get('/:id/documents/:documentId/download', authMiddleware, (req, res) =>
  negotiationController.downloadDocument(req, res)
);

export default negotiationRoutes;
