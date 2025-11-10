"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const PropertyController_1 = require("../controllers/PropertyController");
const auth_1 = require("../middlewares/auth");
const uploadMiddleware_1 = require("../middlewares/uploadMiddleware");
const propertyRoutes = (0, express_1.Router)();
propertyRoutes.post('/', auth_1.authMiddleware, auth_1.isBroker, uploadMiddleware_1.mediaUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
]), (req, res) => PropertyController_1.propertyController.create(req, res));
propertyRoutes.put('/:id', auth_1.authMiddleware, auth_1.isBroker, (req, res) => PropertyController_1.propertyController.update(req, res));
propertyRoutes.patch('/:id/status', auth_1.authMiddleware, auth_1.isBroker, (req, res) => PropertyController_1.propertyController.updateStatus(req, res));
propertyRoutes.delete('/:id', auth_1.authMiddleware, auth_1.isBroker, (req, res) => PropertyController_1.propertyController.delete(req, res));
propertyRoutes.get('/', (req, res) => PropertyController_1.propertyController.listPublicProperties(req, res));
propertyRoutes.get('/public', (req, res) => PropertyController_1.propertyController.listPublicProperties(req, res));
propertyRoutes.get('/public/list', (req, res) => PropertyController_1.propertyController.listPublicProperties(req, res));
propertyRoutes.get('/cities', (req, res) => PropertyController_1.propertyController.getAvailableCities(req, res));
propertyRoutes.get('/:id', (req, res) => PropertyController_1.propertyController.show(req, res));
exports.default = propertyRoutes;
