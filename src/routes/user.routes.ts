import { Router } from 'express';
import { userController } from '../controllers/UserController';
import { authMiddleware } from '../middlewares/auth';

const userRoutes = Router();

userRoutes.post('/register', userController.register);
userRoutes.post('/login', userController.login);
userRoutes.post('/sync', userController.syncUser);
userRoutes.get('/me', authMiddleware, (req, res) => userController.getProfile(req as any, res));
userRoutes.post('/auth/google', userController.googleLogin);

export default userRoutes;