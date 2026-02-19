import { Router } from 'express';

import { contractController } from '../controllers/ContractController';
import { authMiddleware, isAdmin } from '../middlewares/auth';

const contractRoutes = Router();

contractRoutes.post('/admin/negotiations/:id/contract', authMiddleware, isAdmin, (req, res) =>
  contractController.createFromApprovedNegotiation(req, res)
);

contractRoutes.get('/contracts/:id', authMiddleware, (req, res) =>
  contractController.getById(req, res)
);

contractRoutes.put('/contracts/:id/data', authMiddleware, (req, res) =>
  contractController.updateData(req, res)
);

export default contractRoutes;
