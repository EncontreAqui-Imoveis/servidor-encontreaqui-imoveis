"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const BrokerController_1 = require("../controllers/BrokerController");
const auth_1 = require("../middlewares/auth");
const multer_1 = require("../config/multer");
const brokerRoutes = (0, express_1.Router)();
brokerRoutes.post('/register', BrokerController_1.brokerController.register);
brokerRoutes.post('/register-with-docs', multer_1.documentUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]), BrokerController_1.brokerController.registerWithDocs);
brokerRoutes.post('/login', BrokerController_1.brokerController.login);
brokerRoutes.get('/me/properties', auth_1.authMiddleware, auth_1.isBroker, BrokerController_1.brokerController.getMyProperties);
brokerRoutes.get('/me/commissions', auth_1.authMiddleware, auth_1.isBroker, BrokerController_1.brokerController.getMyCommissions);
brokerRoutes.get('/me/performance', auth_1.authMiddleware, auth_1.isBroker, BrokerController_1.brokerController.getMyPerformanceReport);
brokerRoutes.post('/me/verify-documents', auth_1.authMiddleware, multer_1.documentUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]), BrokerController_1.brokerController.uploadVerificationDocs);
exports.default = brokerRoutes;
