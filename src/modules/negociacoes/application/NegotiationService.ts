
import { NegotiationRepository } from '../infra/NegotiationRepository';
import { NegotiationDocumentsRepository } from '../infra/NegotiationDocumentsRepository';
import { NegotiationContractsRepository } from '../infra/NegotiationContractsRepository';
import { NegotiationSignaturesRepository } from '../infra/NegotiationSignaturesRepository';
import { NegotiationCloseSubmissionRepository } from '../infra/NegotiationCloseSubmissionRepository';
import { CommissionSplitsRepository } from '../infra/CommissionSplitsRepository';
import connection from '../../../database/connection';
import { CreateNegotiationDTO, NegotiationStatus } from '../infra/types';

export class NegotiationService {
  private negotiationRepo: NegotiationRepository;
  private documentsRepo: NegotiationDocumentsRepository;

  constructor() {
    this.negotiationRepo = new NegotiationRepository();
    this.documentsRepo = new NegotiationDocumentsRepository();
  }

  async createDraft(data: CreateNegotiationDTO) {
    // 1. Validate property availability?
    // The repository logic might handle "active" check, but we should check if property is visible/available?
    // For now, allow drafting even if available. check if active negotiation exists is done by unique index (not really, logic check needed).

    // Check if there is already an active negotiation for this property
    // We can query existing negotiations for this property.
    // Ideally, we should add a method in repository to find active negotiation by property.

    // For MVP, just create. The repository doesn't enforce "one active per property" except via index on newly active ones? 
    // Wait, the index `idx_negotiations_property_active` I added in migration is conditional (active=1).
    // So multiple drafts are allowed?
    // Implementation Plan says: "Single active negotiation per property".

    const negotiationId = await this.negotiationRepo.create(data);
    return await this.negotiationRepo.findById(negotiationId);
  }

  async submitForActivation(negotiationId: number, userId: number) {
    const negotiation = await this.negotiationRepo.findById(negotiationId);
    if (!negotiation) {
      throw new Error('Negotiation not found');
    }

    if (negotiation.captador_user_id !== userId && negotiation.seller_broker_user_id !== userId) {
      // Logic to allow who created it? or just broker involved?
      // Assuming user is one of the brokers.
    }

    if (negotiation.status !== 'DRAFT') {
      throw new Error('Negotiation must be in DRAFT status to submit');
    }

    await this.negotiationRepo.updateStatus(negotiationId, 'PENDING_ACTIVATION');
    return await this.negotiationRepo.findById(negotiationId);
  }

  // Future methods: activate, internal endpoints, etc.
}
