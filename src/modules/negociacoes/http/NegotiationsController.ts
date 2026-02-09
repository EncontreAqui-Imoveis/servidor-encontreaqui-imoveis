import { Response } from 'express';
import { uploadToCloudinary } from '../../../config/cloudinary';
import { AuthRequest } from '../../../middlewares/auth';
import { NegotiationService } from '../application/NegotiationService';
import { ValidationError } from '../application/validators';

type UploadedFiles = Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined;

function getUploadedFile(files: UploadedFiles, fieldName: string): Express.Multer.File | null {
  if (!files) {
    return null;
  }
  if (Array.isArray(files)) {
    return files[0] ?? null;
  }
  return files[fieldName]?.[0] ?? null;
}

async function resolveUploadedUrl(params: {
  files?: UploadedFiles;
  fieldName: string;
  folder: string;
  fallbackUrl: unknown;
}): Promise<string> {
  const fallback = String(params.fallbackUrl ?? '').trim();
  const file = getUploadedFile(params.files, params.fieldName);

  if (file) {
    const uploaded = await uploadToCloudinary(file, params.folder);
    return uploaded.url;
  }

  if (fallback) {
    return fallback;
  }

  throw new ValidationError(`${params.fieldName} é obrigatório.`);
}

export class NegotiationsController {
  constructor(private readonly service = new NegotiationService()) {}

  create = async (req: AuthRequest, res: Response) => {
    try {
      const negotiation = await this.service.createNegotiation({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        propertyId: req.body.property_id,
        captadorUserId: req.body.captador_user_id,
        sellerBrokerUserId: req.body.seller_broker_user_id,
      });

      return res.status(201).json(negotiation);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  submitForActivation = async (req: AuthRequest, res: Response) => {
    try {
      const negotiation = await this.service.submitForActivation({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
      });

      return res.status(200).json(negotiation);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  activateByAdmin = async (req: AuthRequest, res: Response) => {
    try {
      const negotiation = await this.service.activateByAdmin({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        slaDays: req.body.sla_days,
      });

      return res.status(200).json(negotiation);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  uploadDocument = async (req: AuthRequest, res: Response) => {
    try {
      const docUrl = await resolveUploadedUrl({
        files: req.files as UploadedFiles,
        fieldName: 'doc_file',
        folder: 'negotiations/documents',
        fallbackUrl: req.body.doc_url,
      });

      const document = await this.service.uploadDocument({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        docName: req.body.doc_name,
        docUrl,
      });

      return res.status(201).json(document);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  reviewDocument = async (req: AuthRequest, res: Response) => {
    try {
      const reviewed = await this.service.reviewDocument({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        docId: req.params.docId,
        status: req.body.status,
        reviewComment: req.body.review_comment,
      });

      return res.status(200).json(reviewed);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  publishContract = async (req: AuthRequest, res: Response) => {
    try {
      const contractUrl = await resolveUploadedUrl({
        files: req.files as UploadedFiles,
        fieldName: 'contract_file',
        folder: 'negotiations/contracts',
        fallbackUrl: req.body.contract_url,
      });

      const contract = await this.service.publishContract({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        contractUrl,
      });

      return res.status(200).json(contract);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  uploadSignature = async (req: AuthRequest, res: Response) => {
    try {
      const signedFileUrl = await resolveUploadedUrl({
        files: req.files as UploadedFiles,
        fieldName: 'signed_file',
        folder: 'negotiations/signatures',
        fallbackUrl: req.body.signed_file_url,
      });

      let signedProofImageUrl: string | null = null;
      const proofFile = getUploadedFile(req.files as UploadedFiles, 'signed_proof_image');
      if (proofFile) {
        const uploaded = await uploadToCloudinary(proofFile, 'negotiations/signature-proof');
        signedProofImageUrl = uploaded.url;
      } else if (req.body.signed_proof_image_url) {
        signedProofImageUrl = String(req.body.signed_proof_image_url).trim();
      }

      const signature = await this.service.uploadSignature({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        signedByRole: req.body.signed_by_role,
        signedFileUrl,
        signedProofImageUrl,
        signedByUserId: req.body.signed_by_user_id,
      });

      return res.status(201).json(signature);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  validateSignature = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.service.validateSignature({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        signatureId: req.params.sigId,
        status: req.body.status,
        comment: req.body.comment,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  submitClose = async (req: AuthRequest, res: Response) => {
    try {
      const paymentProofUrl = await resolveUploadedUrl({
        files: req.files as UploadedFiles,
        fieldName: 'payment_proof',
        folder: 'negotiations/payment-proof',
        fallbackUrl: req.body.payment_proof_url,
      });

      const result = await this.service.submitClose({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        closeType: req.body.close_type,
        commissionMode: req.body.commission_mode,
        commissionTotalPercent: req.body.commission_total_percent,
        commissionTotalAmount: req.body.commission_total_amount,
        paymentProofUrl,
        splits: req.body.splits,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  approveClose = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.service.approveClose({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  markNoCommission = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.service.markNoCommission({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
        reason: req.body.reason,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  getDetails = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.service.getNegotiationDetails({
        actorUserId: Number(req.userId),
        actorRole: req.userRole,
        negotiationId: req.params.id,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error);
    }
  };

  private handleError(res: Response, error: unknown) {
    if (error instanceof ValidationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('Erro no módulo de negociações:', error);
    return res.status(500).json({ error: 'Erro interno no módulo de negociações.' });
  }
}

export const negotiationsController = new NegotiationsController();
