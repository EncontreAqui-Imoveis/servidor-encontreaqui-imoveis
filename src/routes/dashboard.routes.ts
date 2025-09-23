import { Router } from 'express';
import { dashboardController } from '../controllers/DashboardController';
import { authMiddleware, isAdmin } from '../middlewares/auth';

const dashboardRoutes = Router();

dashboardRoutes.get('/stats', authMiddleware, isAdmin, dashboardController.getStats);

export default dashboardRoutes;