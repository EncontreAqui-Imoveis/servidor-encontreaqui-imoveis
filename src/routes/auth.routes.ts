import { Router } from 'express';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middlewares/auth';

const authRoutes = Router();

authRoutes.post('/register', (req, res) => authController.register(req, res));
authRoutes.post('/login', (req, res) => authController.login(req, res));
authRoutes.post('/google', (req, res) => authController.google(req, res));
authRoutes.post('/otp/request', (req, res) => authController.requestOtp(req, res));
authRoutes.post('/otp/resend', (req, res) => authController.resendOtp(req, res));
authRoutes.post('/otp/verify', (req, res) => authController.verifyOtp(req, res));
authRoutes.post('/verify-phone', (req, res) => authController.verifyPhone(req, res));
authRoutes.get('/check-email', (req, res) => authController.checkEmail(req, res));
authRoutes.post('/password-reset/request', (req, res) =>
  authController.requestPasswordReset(req, res),
);


// Perfil
authRoutes.get('/me', authMiddleware, (req, res) => {
  // delegar para user.routes GET /users/me, mas mantendo compatibilidade
  return res.redirect(307, '/users/me');
});

export default authRoutes;
