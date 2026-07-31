import { Router } from 'express';
import { userController } from '../controllers/UserController';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middlewares/auth';
import uploadController from '../controllers/UploadController';
import { createAuthLoginLimiter, createAuthRegistrationLimiter, createAuthSensitiveLimiter } from '../config/rateLimiters';
import {
  createPrivacyRequest,
  listOwnPrivacyRequests,
  PrivacyRequestValidationError,
} from '../services/privacyRequestService';

const userRoutes = Router();
const legacyAuthLimiter = createAuthLoginLimiter();
const registrationLimiter = createAuthRegistrationLimiter();
const authSensitiveLimiter = createAuthSensitiveLimiter();

userRoutes.post('/register', registrationLimiter, (req, res) =>
  authController.register(req, res)
);
userRoutes.post('/login', legacyAuthLimiter, (req, res) =>
  authController.login(req, res)
);
userRoutes.post('/sync', userController.syncUser);
userRoutes.post('/auth/google', authSensitiveLimiter, (req, res) => authController.google(req, res));
userRoutes.post('/auth/firebase', authSensitiveLimiter, userController.firebaseLogin);
userRoutes.get('/me', authMiddleware, (req, res) => userController.getProfile(req as any, res));
userRoutes.get('/search', authMiddleware, (req, res) => userController.searchUsers(req as any, res));
userRoutes.put('/me', authMiddleware, (req, res) => userController.updateProfile(req as any, res));
userRoutes.get('/upload/signature', authMiddleware, (req, res) => uploadController.getSignature(req, res));
userRoutes.put('/me/address', authMiddleware, (req, res) =>
  userController.updateAddress(req as any, res),
);
userRoutes.get('/me/properties', authMiddleware, (req, res) =>
  userController.getMyProperties(req as any, res),
);

userRoutes.get('/favorites', authMiddleware, (req, res) => userController.listFavorites(req as any, res));
userRoutes.post('/favorites/:propertyId', authMiddleware, (req, res) => userController.addFavorite(req as any, res));
userRoutes.delete('/favorites/:propertyId', authMiddleware, (req, res) => userController.removeFavorite(req as any, res));

userRoutes.post('/support-request', authMiddleware, (req, res) =>
  userController.requestSupport(req as any, res),
);

userRoutes.post('/privacy/requests', authMiddleware, async (req, res) => {
  try {
    const request = await createPrivacyRequest({
      requesterUserId: Number((req as any).userId),
      type: req.body?.type,
    });
    return res.status(202).json({ request });
  } catch (error) {
    if (error instanceof PrivacyRequestValidationError) {
      return res.status(400).json({ error: error.message, code: 'PRIVACY_REQUEST_INVALID' });
    }
    console.error('Falha ao registrar solicitacao de privacidade.', {
      code: 'PRIVACY_REQUEST_CREATE_FAILED',
    });
    return res.status(500).json({ error: 'Nao foi possivel registrar a solicitacao.' });
  }
});
userRoutes.get('/privacy/requests/me', authMiddleware, async (req, res) => {
  try {
    const requests = await listOwnPrivacyRequests(Number((req as any).userId));
    return res.json({ data: requests });
  } catch {
    return res.status(500).json({ error: 'Nao foi possivel listar as solicitacoes.' });
  }
});

userRoutes.get('/notifications', authMiddleware, (req, res) => userController.listNotifications(req as any, res));
userRoutes.patch('/notifications/:id/read', authMiddleware, (req, res) => userController.markNotificationRead(req as any, res));
userRoutes.post('/notifications/read-all', authMiddleware, (req, res) => userController.markAllNotificationsRead(req as any, res));
userRoutes.post('/device-token', authMiddleware, (req, res) => userController.registerDeviceToken(req as any, res));
userRoutes.delete('/device-token', authMiddleware, (req, res) => userController.unregisterDeviceToken(req as any, res));

export default userRoutes;
