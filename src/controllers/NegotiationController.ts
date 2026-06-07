import { Response } from 'express';

import type { AuthRequest } from '../middlewares/auth';
import {
  deleteMyProposal as deleteMyProposalService,
  updateProposalFromWizard as updateProposalFromWizardService,
} from '../services/negotiationProposalMutationService';
import { generateProposal as generateProposalService } from '../services/negotiationProposalWorkflowService';
import { generateProposalFromProperty as generateProposalFromPropertyService } from '../services/negotiationProposalGenerationService';
import {
  downloadLatestProposal as downloadLatestProposalService,
  uploadSignedProposal as uploadSignedProposalService,
} from '../services/negotiationSignedProposalService';
import { downloadDocument as downloadDocumentService } from '../services/negotiationDocumentDownloadService';
import { lookupClientByCpf as lookupClientByCpfService } from '../services/negotiationClientLookupService';
import { listMine as listMineService } from '../services/negotiationMineListingService';

class NegotiationController {
  async listMine(req: AuthRequest, res: Response): Promise<Response> {
    return listMineService(req, res);
  }

  async generateProposal(req: AuthRequest, res: Response): Promise<Response> {
    return generateProposalService(req, res);
  }

  async generateProposalFromProperty(req: AuthRequest, res: Response): Promise<Response> {
    return generateProposalFromPropertyService(req, res);
  }

  async uploadSignedProposal(req: AuthRequest, res: Response): Promise<Response> {
    return uploadSignedProposalService(req, res);
  }

  async downloadDocument(req: AuthRequest, res: Response): Promise<Response> {
    return downloadDocumentService(req, res);
  }

  async downloadLatestProposal(req: AuthRequest, res: Response): Promise<Response> {
    return downloadLatestProposalService(req, res);
  }

  async lookupClientByCpf(req: AuthRequest, res: Response): Promise<Response> {
    return lookupClientByCpfService(req, res);
  }

  async updateProposalFromWizard(req: AuthRequest, res: Response): Promise<Response> {
    return updateProposalFromWizardService(req, res);
  }

  async deleteMyProposal(req: AuthRequest, res: Response): Promise<Response> {
    return deleteMyProposalService(req, res);
  }
}

export const negotiationController = new NegotiationController();
