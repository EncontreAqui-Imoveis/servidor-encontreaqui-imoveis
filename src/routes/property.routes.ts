import { Router } from 'express';
import { propertyController, AuthRequestWithFiles } from '../controllers/PropertyController';
import { authMiddleware, isBroker } from '../middlewares/auth';
import { mediaUpload } from '../middlewares/uploadMiddleware';

const propertyRoutes = Router();

propertyRoutes.post(
  '/',
  authMiddleware,
  isBroker,
  mediaUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
  ]),
  (req, res) => propertyController.create(req as AuthRequestWithFiles, res)
);

propertyRoutes.put(
  '/:id',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.update(req as any, res)
);

propertyRoutes.patch(
  '/:id',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.update(req as any, res)
);

propertyRoutes.patch(
  '/:id/status',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.updateStatus(req as any, res)
);

propertyRoutes.post(
  '/:id/close',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.closeDeal(req as any, res)
);

propertyRoutes.post(
  '/:id/cancel-deal',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.cancelDeal(req as any, res)
);

propertyRoutes.delete(
  '/:id',
  authMiddleware,
  isBroker,
  (req, res) => propertyController.delete(req as any, res)
);

propertyRoutes.get('/', (req, res) => propertyController.listPublicProperties(req, res));
propertyRoutes.get('/featured', (req, res) => propertyController.listFeaturedProperties(req, res));
propertyRoutes.get('/public', (req, res) => propertyController.listPublicProperties(req, res));
propertyRoutes.get('/public/list', (req, res) => propertyController.listPublicProperties(req, res));
propertyRoutes.get('/cities', (req, res) => propertyController.getAvailableCities(req, res));
propertyRoutes.get('/public/cities', (req, res) => propertyController.getAvailableCities(req, res));
propertyRoutes.get('/:id', (req, res) => propertyController.show(req, res));

export default propertyRoutes;
