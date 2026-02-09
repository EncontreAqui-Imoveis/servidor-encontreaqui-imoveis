"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../../middlewares/auth");
const uploadMiddleware_1 = require("../../../middlewares/uploadMiddleware");
const NegotiationsController_1 = require("./NegotiationsController");
const negotiationsRoutes = (0, express_1.Router)();
negotiationsRoutes.use(auth_1.authMiddleware);
negotiationsRoutes.post('/', auth_1.isBroker, NegotiationsController_1.negotiationsController.create);
negotiationsRoutes.post('/:id/submit-for-activation', auth_1.isBroker, NegotiationsController_1.negotiationsController.submitForActivation);
negotiationsRoutes.post('/:id/documents', auth_1.isBroker, uploadMiddleware_1.negotiationUpload.fields([{ name: 'doc_file', maxCount: 1 }]), NegotiationsController_1.negotiationsController.uploadDocument);
negotiationsRoutes.post('/:id/signatures', auth_1.isBroker, uploadMiddleware_1.negotiationUpload.fields([
    { name: 'signed_file', maxCount: 1 },
    { name: 'signed_proof_image', maxCount: 1 },
]), NegotiationsController_1.negotiationsController.uploadSignature);
negotiationsRoutes.post('/:id/close/submit', auth_1.isBroker, uploadMiddleware_1.negotiationUpload.fields([{ name: 'payment_proof', maxCount: 1 }]), NegotiationsController_1.negotiationsController.submitClose);
negotiationsRoutes.get('/:id', NegotiationsController_1.negotiationsController.getDetails);
exports.default = negotiationsRoutes;
