import { Router } from 'express';
import { brokerController } from '../controllers/BrokerController';
import { authMiddleware, isBroker } from '../middlewares/auth';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware'

const router = Router();

router.post('/register', brokerController.register);
router.post('/login', brokerController.login);


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
