import { Request, Response } from 'express';
import { getRequestId } from '../middlewares/requestContext';
import { deleteCloudinaryAsset, uploadToCloudinary } from '../config/cloudinary';
import { isDraftRegistrationEnabled } from '../config/featureFlags';
import {
  DraftFlowError,
  DraftFinalizeAction,
  createRegistrationDraft,
  patchRegistrationDraft,
  getRegistrationDraft,
  sendDraftEmailVerificationCode,
  confirmDraftEmailCode,
  requestDraftPhoneOtp,
  confirmDraftPhoneOtp,
  persistDraftDocuments,
  finalizeRegistrationDraft,
  discardRegistrationDraft,
} from '../services/registrationDraftService';

function draftErrorCodeToHttpStatus(code: string): number {
  switch (code) {
    case 'DRAFT_NOT_FOUND':
    case 'DRAFT_TOKEN_REQUIRED':
      return 401;
    case 'DRAFT_EXPIRED':
    case 'EMAIL_CODE_EXPIRED':
    case 'DRAFT_PASSWORD_EXPIRED':
    case 'PHONE_OTP_EXPIRED':
      return 410;
    case 'DRAFT_NOT_OPEN':
      return 409;
    case 'TERMS_ACCEPTANCE_REQUIRED':
    case 'PRIVACY_ACCEPTANCE_REQUIRED':
    case 'BROKER_AGREEMENT_REQUIRED':
    case 'DRAFT_INVALID_ACTION':
    case 'DRAFT_INVALID_INPUT':
    case 'DRAFT_PASSWORD_INVALID':
    case 'DRAFT_CRICI_INVALID':
    case 'DRAFT_ADDRESS_INVALID':
    case 'EMAIL_CODE_INVALID':
    case 'EMAIL_CODE_MISSING':
    case 'PHONE_REQUIRED':
    case 'PHONE_FIREBASE_TOKEN_REQUIRED':
    case 'PHONE_FIREBASE_TOKEN_MISSING_PHONE':
    case 'PHONE_OTP_INVALID':
    case 'DRAFT_DOCUMENTS_REQUIRED':
    case 'DRAFT_DOCUMENTS_INVALID':
    case 'DRAFT_PASSWORD_REQUIRED':
    case 'DRAFT_CRICI_REQUIRED':
    case 'DRAFT_DOCUMENTS_MISSING':
      return 400;
    case 'EMAIL_ALREADY_EXISTS':
    case 'DRAFT_ALREADY_EXISTS':
    case 'CRECI_ALREADY_EXISTS':
    case 'DRAFT_DUPLICATE_ACCOUNT':
      return 409;
    case 'EMAIL_CODE_LOCKED':
    case 'PHONE_OTP_LOCKED':
      return 423;
    case 'PHONE_OTP_RATE_LIMITED':
      return 429;
    case 'BROKER_ONLY':
      return 403;
    case 'PHONE_SESSION_NOT_FOUND':
      return 404;
    case 'EMAIL_CODE_CHALLENGE_FAILED':
    case 'EMAIL_PROVIDER_ERROR':
    case 'PHONE_VERIFICATION_UNAVAILABLE':
    case 'PHONE_OTP_DELIVERY_FAILED':
    case 'DRAFT_FLOW_DISABLED':
      return 503;
    case 'DRAFT_DOCUMENTS_STORAGE_FAILED':
      return 502;
    case 'EMAIL_CODE_CONFIRM_FAILED':
      return 503;
    default:
      return 500;
  }
}

class RegistrationDraftController {
  private ensureDraftFlowEnabled() {
    if (!isDraftRegistrationEnabled()) {
      throw new DraftFlowError('UNAVAILABLE', 'DRAFT_FLOW_DISABLED', 'Fluxo de rascunho está temporariamente desativado.');
    }
  }

  private draftToken(req: Request): string {
    return String(req.header('x-draft-token') || '').trim();
  }

  private draftId(req: Request): string {
    return String(req.params.draftId || '').trim();
  }

  private correlationId(req: Request): string | null {
    return getRequestId(req);
  }

  private async resolveDraftDocumentUrl(
    req: Request,
    uploaded: string[],
    fileFields: string[],
    bodyFields: string[],
  ): Promise<string> {
    const files = (req.files as { [field: string]: Express.Multer.File[] } | undefined) ?? {};
    for (const field of fileFields) {
      const file = files[field]?.[0];
      if (file) {
        const upload = await uploadToCloudinary(file, 'brokers/documents');
        uploaded.push(upload.url);
        return upload.url;
      }
    }

    for (const field of bodyFields) {
      const value = req.body?.[field];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }

    return '';
  }

  private async cleanupUploadedDocuments(urls: string[]) {
    await Promise.all(
      urls.map(async (url) => {
        try {
          await deleteCloudinaryAsset({ url });
        } catch {
          // ignore cleanup failures for now
        }
      }),
    );
  }

  private handleError(req: Request, res: Response, error: unknown) {
    if (error instanceof DraftFlowError) {
      return res.status(draftErrorCodeToHttpStatus(error.code)).json({
        status: 'error',
        code: error.code,
        error: error.message,
        retry_after_seconds: error.retryAfterSeconds,
        ...(error.fields ? { fields: error.fields } : {}),
        correlation_id: this.correlationId(req),
      });
    }
    console.error('Erro em fluxo de rascunho:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Erro interno do servidor.',
      correlation_id: this.correlationId(req),
    });
  }

  async create(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const body = req.body ?? {};
      const response = await createRegistrationDraft({
        email: String(body.email ?? ''),
        name: String(body.name ?? ''),
        password: typeof body.password === 'string' ? body.password : undefined,
        phone: body.phone,
        street: body.street,
        number: body.number,
        complement: body.complement,
        bairro: body.bairro,
        city: body.city,
        state: body.state,
        cep: body.cep,
        withoutNumber: body.withoutNumber,
        profileType: body.profileType,
        creci: body.creci,
        authProvider: body.authProvider,
        googleUid: body.googleUid,
        firebaseUid: body.firebaseUid,
        currentStep: body.currentStep,
      });
      return res.status(201).json({
        status: 'ok',
        ...response,
      });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  private resolveFinalizeAction(rawAction: unknown): DraftFinalizeAction {
    const normalized = String(rawAction ?? '').trim().toLowerCase().replace(/-/g, '_');
    const actionMap: Record<string, DraftFinalizeAction | undefined> = {
      '': 'submit_documents',
      submit_documents: 'submit_documents',
      submitdocuments: 'submit_documents',
      broker_submit_documents: 'submit_documents',
      send_later: 'send_later',
      sendlater: 'send_later',
      broker_send_later: 'send_later',
      client_finalize: 'submit_documents',
    };
    const action = actionMap[normalized];
    if (action) {
      return action;
    }
    throw new DraftFlowError('INVALID_INPUT', 'DRAFT_INVALID_ACTION', 'Acao de finalizacao invalida.');
  }

  private logDraftFinalizeRequest(
    req: Request,
    draftId: string,
    actionRaw: unknown,
    action: DraftFinalizeAction,
    body: Record<string, unknown>,
  ) {
    console.info('Finalize draft recebido', {
      requestId: this.correlationId(req),
      draftIdSuffix: String(draftId ?? '').slice(-8),
      actionRaw: String(actionRaw ?? ''),
      actionCanonical: action,
      acceptedTerms: body.acceptedTerms === true || body.acceptedTerms === 'true',
      acceptedPrivacyPolicy: body.acceptedPrivacyPolicy === true || body.acceptedPrivacyPolicy === 'true',
      acceptedBrokerAgreement: body.acceptedBrokerAgreement === true || body.acceptedBrokerAgreement === 'true',
      termsVersion: body.termsVersion,
      privacyPolicyVersion: body.privacyPolicyVersion,
      brokerAgreementVersion: body.brokerAgreementVersion,
    });
  }

  async get(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await getRegistrationDraft(this.draftId(req), this.draftToken(req));
      return res.status(200).json({ status: 'ok', draft: response });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async patch(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await patchRegistrationDraft(this.draftId(req), this.draftToken(req), req.body ?? {});
      return res.status(200).json({ status: 'ok', draft: response });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async sendEmailVerification(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await sendDraftEmailVerificationCode(this.draftId(req), this.draftToken(req));
      return res.status(200).json({ status: 'ok', ...response });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async confirmEmailCode(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const code = String(req.body?.code ?? '').trim();
      const response = await confirmDraftEmailCode(this.draftId(req), this.draftToken(req), code);
      const { status, ...payload } = response as { status?: string; [key: string]: unknown };
      return res.status(200).json({ ...payload, status: status ?? 'ok' });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async requestPhoneVerification(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await requestDraftPhoneOtp(this.draftId(req), this.draftToken(req), req.body?.phone);
      return res.status(200).json({ status: 'ok', ...response });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async confirmPhoneOtp(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await confirmDraftPhoneOtp(
        this.draftId(req),
        this.draftToken(req),
        req.body?.sessionToken,
        req.body?.code,
        req.body?.firebaseIdToken,
      );
      const { status, ...payload } = response as { status?: string; [key: string]: unknown };
      return res.status(200).json({ ...payload, status: status ?? 'ok' });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async submitDocuments(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const uploadedUrls: string[] = [];
      const draftId = this.draftId(req);
      const draftToken = this.draftToken(req);
      try {
        const creciFrontUrl = await this.resolveDraftDocumentUrl(
          req,
          uploadedUrls,
          ['crecifront', 'creciFront', 'front'],
          ['creciFrontUrl', 'creci_front_url', 'creciFront'],
        );
        const creciBackUrl = await this.resolveDraftDocumentUrl(
          req,
          uploadedUrls,
          ['creciback', 'creciBack', 'back'],
          ['creciBackUrl', 'creci_back_url', 'creciBack'],
        );
        const selfieUrl = await this.resolveDraftDocumentUrl(
          req,
          uploadedUrls,
          ['selfie'],
          ['selfieUrl', 'selfie_url'],
        );

        if (!creciFrontUrl || !creciBackUrl || !selfieUrl) {
          throw new DraftFlowError(
            'INVALID_INPUT',
            'DRAFT_DOCUMENTS_REQUIRED',
            'Envie fotos da frente/verso do creci e selfie.',
          );
        }

        const response = await persistDraftDocuments(draftId, draftToken, {
          creciFrontUrl,
          creciBackUrl,
          selfieUrl,
        });
        return res.status(200).json({
          status: 'ok',
          draft: response,
        });
      } catch (error) {
        await this.cleanupUploadedDocuments(uploadedUrls);
        if (error instanceof DraftFlowError) {
          throw error;
        }
        throw new DraftFlowError(
          'UNAVAILABLE',
          'DRAFT_DOCUMENTS_STORAGE_FAILED',
          'Falha ao enviar documentos de corretor.',
        );
      }
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async finalize(req: Request, res: Response) {
    const actionRaw = req.body?.action;
    const draftId = this.draftId(req);
    const body = req.body ?? {};
    try {
      this.ensureDraftFlowEnabled();
      const action = this.resolveFinalizeAction(actionRaw);
      this.logDraftFinalizeRequest(req, draftId, actionRaw, action, body as Record<string, unknown>);
      const requestContext = {
        ip: req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : req.ip,
        userAgent: req.get('user-agent'),
      };
      const response = await finalizeRegistrationDraft(draftId, this.draftToken(req), action, {
        acceptedTerms: body.acceptedTerms,
        acceptedPrivacyPolicy: body.acceptedPrivacyPolicy,
        acceptedBrokerAgreement: body.acceptedBrokerAgreement,
        termsVersion: body.termsVersion,
        privacyPolicyVersion: body.privacyPolicyVersion,
        brokerAgreementVersion: body.brokerAgreementVersion,
      }, requestContext);
      return res.status(200).json({ status: 'ok', ...response });
    } catch (error) {
      if (error instanceof DraftFlowError) {
        console.warn('Finalize draft falhou', {
          requestId: this.correlationId(req),
          draftIdSuffix: String(draftId).slice(-8),
          actionRaw: String(actionRaw ?? ''),
          errorCode: error.code,
        });
      }
      return this.handleError(req, res, error);
    }
  }

  async discard(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const response = await discardRegistrationDraft(this.draftId(req), this.draftToken(req));
      const { status, ...payload } = response as { status?: string; [key: string]: unknown };
      return res.status(200).json({ ...payload, status: status ?? 'ok' });
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }
}

export const registrationDraftController = new RegistrationDraftController();
