import { Router } from 'express';
import { brokerController } from '../controllers/BrokerController';
import { mediaUpload } from '../middlewares/uploadMiddleware';
import { authMiddleware, isBroker } from '../middlewares/auth';

const brokerRoutes = Router();

brokerRoutes.post('/register', brokerController.register);
brokerRoutes.post('/login', brokerController.login);

brokerRoutes.post(
    '/register-with-docs',
    mediaUpload.fields([
        { name: 'creciFront', maxCount: 1 },
        { name: 'creciBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 }
    ]),
    brokerController.registerWithDocs
);

brokerRoutes.get('/my-properties', authMiddleware, isBroker, brokerController.getMyProperties);
brokerRoutes.get('/my-commissions', authMiddleware, isBroker, brokerController.getMyCommissions);
brokerRoutes.get('/my-performance', authMiddleware, isBroker, brokerController.getMyPerformanceReport);

brokerRoutes.post(
    '/verification-docs',
    authMiddleware,
    isBroker,
    mediaUpload.fields([ 
        { name: 'creciFront', maxCount: 1 },
        { name: 'creciBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 }
    ]),
    brokerController.uploadVerificationDocs
);

export default brokerRoutes;