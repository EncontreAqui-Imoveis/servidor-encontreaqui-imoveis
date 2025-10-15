"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const BrokerController_1 = require("../controllers/BrokerController");
const auth_1 = require("../middlewares/auth");
const uploadMiddleware_1 = require("../middlewares/uploadMiddleware");
const router = (0, express_1.Router)();
router.post('/register', BrokerController_1.brokerController.register);
router.post('/login', BrokerController_1.brokerController.login);
router.post('/register-with-docs', uploadMiddleware_1.brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
]), BrokerController_1.brokerController.registerWithDocs);
router.use(auth_1.authMiddleware);
router.post('/me/verify-documents', uploadMiddleware_1.brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
]), BrokerController_1.brokerController.uploadVerificationDocs);
router.get('/me/properties', auth_1.isBroker, BrokerController_1.brokerController.getMyProperties);
router.get('/me/commissions', auth_1.isBroker, BrokerController_1.brokerController.getMyCommissions);
router.get('/me/performance-report', auth_1.isBroker, BrokerController_1.brokerController.getMyPerformanceReport);
exports.default = router;
