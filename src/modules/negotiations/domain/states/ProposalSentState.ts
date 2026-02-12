import { ConflictError } from '../errors/ConflictError';
import { ValidationError } from '../errors/ValidationError';
import {
  NegotiationSnapshot,
  NegotiationState,
  NegotiationStatus,
  ProposalData,
} from './NegotiationState';

export class ProposalSentState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'PROPOSAL_SENT';
  }

  async approveProposal(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    return transactionManager.run(async (trx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: 'IN_NEGOTIATION',
        expectedVersion: negotiation.version,
        actorId,
        metadata: metadata ?? null,
        trx,
      });

      await repositories.properties.markUnderNegotiation({
        id: negotiation.propertyId,
        trx,
      });

      return {
        ...negotiation,
        status: 'IN_NEGOTIATION',
        version: negotiation.version + 1,
      };
    });
  }

  async generateAndStorePdf(data: ProposalData): Promise<void> {
    const pdfService = this.context.proposalPdfService;
    if (!pdfService) {
      throw new ValidationError('ProposalPdfService is not configured.');
    }

    const pdfBuffer = await pdfService.generateProposal(data);
    const negotiationId = String(this.context.negotiation.id ?? '').trim();
    if (!negotiationId) {
      throw new ValidationError('Negotiation id is required to persist proposal PDF.');
    }

    await this.context.repositories.negotiationDocuments.saveProposal(
      negotiationId,
      pdfBuffer
    );
  }

  async cancel(
    actorId: number,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    return transactionManager.run(async (trx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: 'CANCELLED',
        expectedVersion: negotiation.version,
        actorId,
        metadata: metadata ?? null,
        trx,
      });

      await repositories.properties.markAvailable({
        id: negotiation.propertyId,
        trx,
      });

      return {
        ...negotiation,
        status: 'CANCELLED',
        version: negotiation.version + 1,
      };
    });
  }
}
