import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { brokerController } from '../controllers/BrokerController';
import { authController } from '../controllers/AuthController';
import { authMiddleware, isBroker } from '../middlewares/auth';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware'

const router = Router();

const legacyAuthWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
const legacyAuthLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);

const legacyAuthLimiter = rateLimit({
  windowMs:
    Number.isFinite(legacyAuthWindowMs) && legacyAuthWindowMs > 0
      ? legacyAuthWindowMs
      : 15 * 60 * 1000,
  limit: Number.isFinite(legacyAuthLimit) && legacyAuthLimit > 0 ? legacyAuthLimit : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas em rotas legadas de autenticacao. Use /auth/*.',
  },
});

router.post('/register', brokerController.register);
router.post('/login', legacyAuthLimiter, (req, res) => authController.login(req, res));


router.post(
  '/register-with-docs',
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
