import { Router } from 'express';
import { negotiationsController } from './NegotiationsController';
import { authMiddleware, isBroker, isAdmin } from '../../../middlewares/auth';

const negotiationsRoutes = Router();

// Broker routes
negotiationsRoutes.post(
  '/',
  authMiddleware,
  isBroker,
  (req, res) => negotiationsController.create(req, res)
);

negotiationsRoutes.post(
  '/:id/submit-for-activation',
  authMiddleware,
  isBroker,
  (req, res) => negotiationsController.submitForActivation(req, res)
);

// Admin routes (placeholder/future)
// negotiationsRoutes.post('/:id/activate', authMiddleware, isAdmin, ...);

export default negotiationsRoutes;
