import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { userController } from '../controllers/UserController';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middlewares/auth';

const userRoutes = Router();

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

userRoutes.post('/register', legacyAuthLimiter, (req, res) =>
  authController.register(req, res)
);
userRoutes.post('/login', legacyAuthLimiter, (req, res) =>
  authController.login(req, res)
);
userRoutes.post('/sync', userController.syncUser);
userRoutes.post('/auth/google', (req, res) => authController.google(req, res));
userRoutes.post('/auth/firebase', userController.firebaseLogin);
userRoutes.get('/me', authMiddleware, (req, res) => userController.getProfile(req as any, res));
userRoutes.put('/me', authMiddleware, (req, res) => userController.updateProfile(req as any, res));
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

userRoutes.get('/notifications', authMiddleware, (req, res) => userController.listNotifications(req as any, res));
userRoutes.patch('/notifications/:id/read', authMiddleware, (req, res) => userController.markNotificationRead(req as any, res));
userRoutes.post('/notifications/read-all', authMiddleware, (req, res) => userController.markAllNotificationsRead(req as any, res));
userRoutes.post('/device-token', authMiddleware, (req, res) => userController.registerDeviceToken(req as any, res));
userRoutes.delete('/device-token', authMiddleware, (req, res) => userController.unregisterDeviceToken(req as any, res));

export default userRoutes;
