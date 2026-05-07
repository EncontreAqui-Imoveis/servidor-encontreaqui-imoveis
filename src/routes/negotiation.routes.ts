import { Router } from 'express';

import { negotiationController } from '../controllers/NegotiationController';
import { authMiddleware, isBroker } from '../middlewares/auth';
import { signedProposalUpload } from '../middlewares/uploadMiddleware';

const negotiationRoutes = Router();

negotiationRoutes.get('/mine', authMiddleware, (req, res) =>
  negotiationController.listMine(req as any, res)
);
negotiationRoutes.get('/me', authMiddleware, (req, res) =>
  negotiationController.listMine(req as any, res)
);

negotiationRoutes.get('/client-lookup', authMiddleware, (req, res) =>
  negotiationController.lookupClientByCpf(req as any, res)
);

negotiationRoutes.post('/proposal', authMiddleware, (req, res) =>
  negotiationController.generateProposalFromProperty(req as any, res)
);

negotiationRoutes.put('/:id/draft', authMiddleware, (req, res) =>
  negotiationController.updateProposalFromWizard(req as any, res)
);

negotiationRoutes.delete('/:id', authMiddleware, (req, res) =>
  negotiationController.deleteMyProposal(req as any, res)
);

negotiationRoutes.post('/:id/proposals', authMiddleware, isBroker, (req, res) =>
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
