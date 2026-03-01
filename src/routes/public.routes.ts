import { Router } from 'express';
import { propertyController } from '../controllers/PropertyController';

const publicRoutes = Router();

publicRoutes.get('/properties', propertyController.listPublicProperties);
publicRoutes.get('/public/properties/:id', propertyController.showPublic);
publicRoutes.get('/properties/cities', propertyController.getAvailableCities);

export default publicRoutes;
