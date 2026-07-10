import { Router } from 'express';
import { locationController } from '../controllers/LocationController';

const locationRoutes = Router();

locationRoutes.get('/cities', (req, res) => locationController.listCities(req, res));
locationRoutes.get('/neighborhoods', (req, res) => locationController.listNeighborhoods(req, res));
locationRoutes.get('/cep/:cep', (req, res) => locationController.getByCep(req, res));

export default locationRoutes;
