import { ConflictError } from '../errors/ConflictError';
import { ValidationError } from '../errors/ValidationError';
import {
  NegotiationSnapshot,
  NegotiationState,
  NegotiationStatus,
  PaymentDetails,
  ProposalData,
} from './NegotiationState';
import { ProposalSentState } from './ProposalSentState';

export interface DraftUpdateInput {
  actorId: number;
  paymentDetails: PaymentDetails;
  finalValue: number | null;
  proposalValidityDate: string | null;
  selfAsSellingBroker: boolean;
  sellingBrokerId: number | null;
  propertyValue?: number;
}

export class DraftState extends NegotiationState {
  getStatus(): NegotiationStatus {
    return 'PROPOSAL_DRAFT';
  }

  async updateDraft(input: DraftUpdateInput): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    return transactionManager.run(async (trx) => {
      const propertyValue = await repositories.properties.getPropertyValue({
        id: negotiation.propertyId,
        trx,
      });

      if (input.propertyValue !== undefined && input.propertyValue !== propertyValue) {
        throw new ValidationError('Property value is read-only and must match the property table.');
      }

      const resolvedSellingBrokerId = input.selfAsSellingBroker
        ? negotiation.capturingBrokerId
        : input.sellingBrokerId ?? null;

      if (!input.selfAsSellingBroker && !resolvedSellingBrokerId) {
        throw new ValidationError('Selling broker is required when not self-assigned.');
      }

      const updatedRows = await repositories.negotiations.updateDraftWithOptimisticLock({
        id: negotiation.id,
        expectedVersion: negotiation.version,
        paymentDetails: input.paymentDetails,
        finalValue: input.finalValue ?? null,
        proposalValidityDate: input.proposalValidityDate ?? null,
        sellingBrokerId: resolvedSellingBrokerId,
        trx,
      });

      if (updatedRows === 0) {
        throw new ConflictError('Negotiation version conflict.');
      }

      return {
        ...negotiation,
        paymentDetails: input.paymentDetails,
        finalValue: input.finalValue ?? null,
        proposalValidityDate: input.proposalValidityDate ?? null,
        sellingBrokerId: resolvedSellingBrokerId,
        version: negotiation.version + 1,
      };
    });
  }

  async sendProposal(
    actorId: number,
    proposalData?: ProposalData,
    metadata?: Record<string, unknown>
  ): Promise<NegotiationSnapshot> {
    const updated = await this.persistTransition({
      toStatus: 'PROPOSAL_SENT',
      actorId,
      metadata,
    });

    if (proposalData && this.context.proposalPdfService) {
      const nextState = new ProposalSentState({
        ...this.context,
        negotiation: updated,
      });
      await nextState.generateAndStorePdf(proposalData);
    }

    return updated;
  }
}
