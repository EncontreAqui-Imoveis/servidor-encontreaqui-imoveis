import { Router } from 'express';
import { propertyController } from '../controllers/PropertyController';

const publicRoutes = Router();

publicRoutes.get('/properties', propertyController.listPublicProperties);
publicRoutes.get('/properties/:id', propertyController.show);
publicRoutes.get('/properties/cities', propertyController.getAvailableCities);

export default publicRoutes;