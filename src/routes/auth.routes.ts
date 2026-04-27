import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/AuthController';
import { registrationDraftController } from '../controllers/RegistrationDraftController';
import { authMiddleware } from '../middlewares/auth';
import { brokerDocsUpload } from '../middlewares/uploadMiddleware';

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

function handleDraftUploadError(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!error) {
    return next();
  }

  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code && ['LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_PART_COUNT'].includes(code)) {
      return res.status(400).json({
        status: 'error',
        code: 'DRAFT_DOCUMENTS_INVALID',
        error: error.message || 'Arquivo(s) de documento de rascunho inválidos.',
      });
    }
  }

  return res.status(400).json({
    status: 'error',
    code: 'DRAFT_DOCUMENTS_INVALID',
    error: error instanceof Error ? error.message : 'Arquivo(s) de documento de rascunho inválidos.',
  });
}

authRoutes.post('/register', (req, res) => authController.register(req, res));
authRoutes.post('/register/draft', authLightLimiter, (req, res) =>
  registrationDraftController.create(req, res),
);
authRoutes.patch('/register/draft/:draftId', authLightLimiter, (req, res) =>
  registrationDraftController.patch(req, res),
);
authRoutes.get('/register/draft/:draftId', authLightLimiter, (req, res) =>
  registrationDraftController.get(req, res),
);
authRoutes.post('/register/draft/:draftId/verify-email', authSensitiveLimiter, (req, res) =>
  registrationDraftController.sendEmailVerification(req, res),
);
authRoutes.post('/register/draft/:draftId/verify-email/confirm', authSensitiveLimiter, (req, res) =>
  registrationDraftController.confirmEmailCode(req, res),
);
authRoutes.post('/register/draft/:draftId/verify-phone', authSensitiveLimiter, (req, res) =>
  registrationDraftController.requestPhoneVerification(req, res),
);
authRoutes.post('/register/draft/:draftId/verify-phone/confirm', authSensitiveLimiter, (req, res) =>
  registrationDraftController.confirmPhoneOtp(req, res),
);
authRoutes.post(
  '/register/draft/:draftId/submit-documents',
  authSensitiveLimiter,
  brokerDocsUpload.fields([
    { name: 'crecifront', maxCount: 1 },
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciback', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  handleDraftUploadError,
  (req, res) => registrationDraftController.submitDocuments(req, res),
);
authRoutes.post('/register/draft/:draftId/finalize', authSensitiveLimiter, (req, res) =>
  registrationDraftController.finalize(req, res),
);
authRoutes.post('/register/draft/:draftId/discard', authLightLimiter, (req, res) =>
  registrationDraftController.discard(req, res),
);
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
