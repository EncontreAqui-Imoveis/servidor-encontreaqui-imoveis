import { Router } from 'express';
import { authMiddleware, isBroker } from '../../../middlewares/auth';
import { negotiationUpload } from '../../../middlewares/uploadMiddleware';
import { negotiationsController } from './NegotiationsController';

const negotiationsRoutes = Router();

negotiationsRoutes.use(authMiddleware);

negotiationsRoutes.post('/', isBroker, negotiationsController.create);
negotiationsRoutes.post('/:id/submit-for-activation', isBroker, negotiationsController.submitForActivation);

negotiationsRoutes.post(
  '/:id/documents',
  isBroker,
  negotiationUpload.fields([{ name: 'doc_file', maxCount: 1 }]),
  negotiationsController.uploadDocument
);

negotiationsRoutes.post(
  '/:id/signatures',
  isBroker,
  negotiationUpload.fields([
    { name: 'signed_file', maxCount: 1 },
    { name: 'signed_proof_image', maxCount: 1 },
  ]),
  negotiationsController.uploadSignature
);

negotiationsRoutes.post(
  '/:id/close/submit',
  isBroker,
  negotiationUpload.fields([{ name: 'payment_proof', maxCount: 1 }]),
  negotiationsController.submitClose
);

negotiationsRoutes.get('/:id', negotiationsController.getDetails);

export default negotiationsRoutes;
