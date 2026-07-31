import { Router } from 'express';
import { brokerController } from '../controllers/BrokerController';
import { authController } from '../controllers/AuthController';
import { authMiddleware, isBroker } from '../middlewares/auth';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware'
import {
  createAuthLoginLimiter,
  createAuthRegistrationLimiter,
  createPreAuthUploadLimiter,
} from '../config/rateLimiters';

const router = Router();
const legacyAuthLimiter = createAuthLoginLimiter();
const registrationLimiter = createAuthRegistrationLimiter();
const preAuthUploadLimiter = createPreAuthUploadLimiter();

router.post('/register', registrationLimiter, brokerController.register);
router.post('/login', legacyAuthLimiter, (req, res) => authController.login(req, res));


router.post(
  '/register-with-docs',
  registrationLimiter,
  preAuthUploadLimiter,
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  brokerController.registerWithDocs
);

router.use(authMiddleware);

router.get('/approved', brokerController.listApproved);

router.post(
  '/me/verify-documents',
  brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  brokerController.uploadVerificationDocs
);

router.post('/me/request-upgrade', brokerController.requestUpgrade);

router.get('/me/properties', isBroker, brokerController.getMyProperties);
router.get('/me/commissions', isBroker, brokerController.getMyCommissions);
router.get('/me/performance-report', isBroker, brokerController.getMyPerformanceReport);
router.get('/me/performance', isBroker, brokerController.getMyPerformanceReport);

export default router;
