import { Router } from 'express';

import { negotiationController } from '../controllers/NegotiationController';
import { authMiddleware } from '../middlewares/auth';
import { signedProposalUpload } from '../middlewares/uploadMiddleware';

const negotiationRoutes = Router();

negotiationRoutes.post('/proposal', authMiddleware, (req, res) =>
  negotiationController.generateProposalFromProperty(req as any, res)
);

negotiationRoutes.post('/:id/proposals', authMiddleware, (req, res) =>
  negotiationController.generateProposal(req as any, res)
);

negotiationRoutes.get('/:id/proposals/download', authMiddleware, (req, res) =>
  negotiationController.downloadLatestProposal(req, res)
);

negotiationRoutes.post(
  '/:id/proposals/signed',
  authMiddleware,
  signedProposalUpload.single('file'),
  (req, res) => negotiationController.uploadSignedProposal(req as any, res)
);

negotiationRoutes.get('/:id/documents/:documentId/download', authMiddleware, (req, res) =>
  negotiationController.downloadDocument(req, res)
);

export default negotiationRoutes;
