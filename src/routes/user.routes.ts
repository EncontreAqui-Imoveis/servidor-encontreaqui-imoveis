import { Router } from 'express';
import { userController } from '../controllers/UserController';
import { authMiddleware } from '../middlewares/auth';

const userRoutes = Router();

userRoutes.post('/register', userController.register);
userRoutes.post('/login', userController.login);
userRoutes.post('/sync', userController.syncUser);
userRoutes.post('/auth/google', userController.googleLogin);
userRoutes.get('/me', authMiddleware, (req, res) => userController.getProfile(req as any, res));

userRoutes.get('/favorites', authMiddleware, (req, res) => userController.listFavorites(req as any, res));
userRoutes.post('/favorites/:propertyId', authMiddleware, (req, res) => userController.addFavorite(req as any, res));
userRoutes.delete('/favorites/:propertyId', authMiddleware, (req, res) => userController.removeFavorite(req as any, res));

userRoutes.get('/notifications', authMiddleware, (req, res) => userController.listNotifications(req as any, res));

export default userRoutes;
