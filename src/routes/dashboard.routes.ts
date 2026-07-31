import { Router } from 'express';
import { dashboardController } from '../controllers/DashboardController';
import sreController from '../controllers/SreController';
import { authMiddleware, isAdmin } from '../middlewares/auth';
import {
  verifyGithubWebhook,
  verifyRailwayWebhook,
  verifyVercelWebhook,
} from '../middlewares/operationalAccess';

const router = Router();

router.get('/stats', authMiddleware, isAdmin, dashboardController.getStats);
router.get('/sre', authMiddleware, isAdmin, sreController.getStats);
router.put('/sre/external-services/:name', authMiddleware, isAdmin, sreController.updateService);
router.post('/webhook/github', verifyGithubWebhook, sreController.handleGithubWebhook);
router.post('/webhook/vercel', verifyVercelWebhook, sreController.handleVercelWebhook);
router.post('/webhook/railway', verifyRailwayWebhook, sreController.handleRailwayWebhook);

export default router;
