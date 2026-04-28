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

class RegistrationDraftController {
  private ensureDraftFlowEnabled() {
    if (!isDraftRegistrationEnabled()) {
      throw new DraftFlowError(503, 'DRAFT_FLOW_DISABLED', 'Fluxo de rascunho está temporariamente desativado.');
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
      return res.status(error.statusCode).json({
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
            400,
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
          502,
          'DRAFT_DOCUMENTS_STORAGE_FAILED',
          'Falha ao enviar documentos de corretor.',
        );
      }
    } catch (error) {
      return this.handleError(req, res, error);
    }
  }

  async finalize(req: Request, res: Response) {
    try {
      this.ensureDraftFlowEnabled();
      const requestedAction = String(req.body?.action ?? '')
        .trim()
        .toLowerCase();
      const action: DraftFinalizeAction =
        requestedAction === 'send_later' ? 'send_later' : 'submit_documents';
      const body = req.body ?? {};
      const requestContext = {
        ip: req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : req.ip,
        userAgent: req.get('user-agent'),
      };
      const response = await finalizeRegistrationDraft(this.draftId(req), this.draftToken(req), action, {
        acceptedTerms: body.acceptedTerms,
        acceptedPrivacyPolicy: body.acceptedPrivacyPolicy,
        acceptedBrokerAgreement: body.acceptedBrokerAgreement,
        termsVersion: body.termsVersion,
        privacyPolicyVersion: body.privacyPolicyVersion,
        brokerAgreementVersion: body.brokerAgreementVersion,
      }, requestContext);
      return res.status(200).json({ status: 'ok', ...response });
    } catch (error) {
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
