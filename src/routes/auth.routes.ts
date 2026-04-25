import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middlewares/auth';

const authRoutes = Router();

const authWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);
const authLightWindowMs = Number(process.env.AUTH_LIGHT_RATE_LIMIT_WINDOW_MS);
const authLightLimit = Number(process.env.AUTH_LIGHT_RATE_LIMIT_MAX);

const authSensitiveLimiter = rateLimit({
  windowMs:
    Number.isFinite(authWindowMs) && authWindowMs > 0
      ? authWindowMs
      : 15 * 60 * 1000,
  limit: Number.isFinite(authLimit) && authLimit > 0 ? authLimit : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas em rotas de autenticacao. Tente novamente em instantes.',
  },
});

const authLightLimiter = rateLimit({
  windowMs:
    Number.isFinite(authLightWindowMs) && authLightWindowMs > 0
      ? authLightWindowMs
      : 15 * 60 * 1000,
  limit: Number.isFinite(authLightLimit) && authLightLimit > 0 ? authLightLimit : 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de consulta de autenticacao. Tente novamente em instantes.',
  },
});

authRoutes.post('/register', (req, res) => authController.register(req, res));
authRoutes.post('/login', authSensitiveLimiter, (req, res) =>
  authController.login(req, res)
);
authRoutes.post('/google', authSensitiveLimiter, (req, res) =>
  authController.google(req, res)
);
authRoutes.post('/otp/request', authSensitiveLimiter, (req, res) =>
  authController.requestOtp(req, res)
);
authRoutes.post('/otp/resend', authSensitiveLimiter, (req, res) =>
  authController.resendOtp(req, res)
);
authRoutes.post('/otp/verify', (req, res) => authController.verifyOtp(req, res));
authRoutes.post('/verify-phone', (req, res) => authController.verifyPhone(req, res));
authRoutes.post('/email-verification/send', authSensitiveLimiter, (req, res) =>
  authController.sendEmailVerification(req, res)
);
authRoutes.post('/email-verification/check', authLightLimiter, (req, res) =>
  authController.checkEmailVerification(req, res)
);
authRoutes.post('/email-verification/verify-code', authSensitiveLimiter, (req, res) =>
  authController.verifyEmailVerificationCode(req, res)
);
authRoutes.get('/check-email', authLightLimiter, (req, res) =>
  authController.checkEmail(req, res)
);
authRoutes.get('/check-creci', authLightLimiter, (req, res) =>
  authController.checkCreci(req, res)
);
authRoutes.post('/password-reset/request', authSensitiveLimiter, (req, res) =>
  authController.requestPasswordReset(req, res)
);
authRoutes.post('/password-reset/verify-code', authSensitiveLimiter, (req, res) =>
  authController.verifyPasswordResetCode(req, res)
);
authRoutes.post('/password-reset/confirm', authSensitiveLimiter, (req, res) =>
  authController.confirmPasswordReset(req, res)
);
authRoutes.post('/logout', authMiddleware, (req, res) =>
  authController.logout(req as any, res)
);


// Perfil
authRoutes.get('/me', authMiddleware, (req, res) => {
  // delegar para user.routes GET /users/me, mas mantendo compatibilidade
  return res.redirect(307, '/users/me');
});

export default authRoutes;
