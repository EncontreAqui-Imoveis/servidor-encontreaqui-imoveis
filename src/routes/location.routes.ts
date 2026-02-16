import { Router } from 'express';
import { locationController } from '../controllers/LocationController';

const locationRoutes = Router();

locationRoutes.get('/cep/:cep', (req, res) => locationController.getByCep(req, res));

export default locationRoutes;
