import { Router } from 'express';
import { dashboardController } from '../controllers/DashboardController';
import sreController from '../controllers/SreController';
import { authMiddleware, isAdmin } from '../middlewares/auth';

const router = Router();

router.get('/stats', authMiddleware, isAdmin, dashboardController.getStats);
router.get('/sre', authMiddleware, isAdmin, sreController.getStats);
router.put('/sre/external-services/:name', authMiddleware, isAdmin, sreController.updateService);
router.post('/webhook/deploy', sreController.handleWebhook);

export default router;