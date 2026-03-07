import { Router } from 'express';
import { dashboardController } from '../controllers/DashboardController';
import { sreController } from '../controllers/SreController';
import { authMiddleware, isAdmin } from '../middlewares/auth';

const dashboardRoutes = Router();

dashboardRoutes.get('/stats', authMiddleware, isAdmin, dashboardController.getStats);
dashboardRoutes.get('/sre', authMiddleware, isAdmin, sreController.getStats);

export default dashboardRoutes;