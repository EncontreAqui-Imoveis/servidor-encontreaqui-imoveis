import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { NegotiationEventBus } from '../../../src/modules/negotiations/domain/events/NegotiationEventBus';
import { ConflictError } from '../../../src/modules/negotiations/domain/errors/ConflictError';
import { ValidationError } from '../../../src/modules/negotiations/domain/errors/ValidationError';
import { AwaitingSignaturesState } from '../../../src/modules/negotiations/domain/states/AwaitingSignaturesState';
import { DocumentationPhaseState } from '../../../src/modules/negotiations/domain/states/DocumentationPhaseState';
import { ProposalSentState } from '../../../src/modules/negotiations/domain/states/ProposalSentState';
import type {
  NegotiationDocumentsRepository,
  NegotiationRepositories,
  NegotiationSnapshot,
  NegotiationStateContext,
  TransactionManager,
} from '../../../src/modules/negotiations/domain/states/NegotiationState';

const createBaseSnapshot = (): NegotiationSnapshot => ({
  id: 'neg-1',
  status: 'PROPOSAL_SENT',
  version: 1,
  propertyId: 10,
  capturingBrokerId: 101,
  sellingBrokerId: 202,
  buyerClientId: 303,
  finalValue: 100000,
  paymentDetails: { method: 'MONEY', amount: 100000 },
  proposalValidityDate: '2026-02-12',
});

const createContext = (overrides?: Partial<NegotiationStateContext>) => {
  const trx = { execute: vi.fn() };
  const mockDocsRepo = mock<NegotiationDocumentsRepository>();
  mockDocsRepo.countPendingOrRejected.mockResolvedValue({
    pendingOrRejected: 0,
    approved: 1,
  });

  const repositories: NegotiationRepositories = {
    negotiations: {
      updateStatusWithOptimisticLock: vi.fn(),
      updateDraftWithOptimisticLock: vi.fn(),
    },
    negotiationDocuments: mockDocsRepo,
    properties: {
      getPropertyValue: vi.fn(),
      updateLifecycleStatus: vi.fn(),
      markUnderNegotiation: vi.fn(),
      markAvailable: vi.fn(),
    },
  };

  const transactionManager: TransactionManager<typeof trx> = {
    run: async (fn: (trx: any) => Promise<any>) => fn(trx),
  };

  const context: NegotiationStateContext = {
    negotiation: createBaseSnapshot(),
    repositories,
    transactionManager,
    eventBus: new NegotiationEventBus(),
  };

  return { context: { ...context, ...(overrides ?? {}) }, trx, repositories };
};

describe('ProposalSentState', () => {
  it('approves proposal and marks property under negotiation', async () => {
    const { context, trx, repositories } = createContext();
    const state = new ProposalSentState(context);

    const result = await state.approveProposal(999);

    expect(repositories.negotiations.updateStatusWithOptimisticLock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: context.negotiation.id,
        toStatus: 'IN_NEGOTIATION',
        expectedVersion: context.negotiation.version,
        trx,
      })
    );
    expect(repositories.properties.markUnderNegotiation).toHaveBeenCalledWith({
      id: context.negotiation.propertyId,
      trx,
    });
    expect(result.status).toBe('IN_NEGOTIATION');
    expect(result.version).toBe(context.negotiation.version + 1);
  });
});

describe('DocumentationPhaseState', () => {
  it('blocks moveToContractDrafting when pending docs exist', async () => {
    const { context, repositories } = createContext({
      negotiation: { ...createBaseSnapshot(), status: 'DOCUMENTATION_PHASE' },
    });
    repositories.negotiationDocuments.countPendingOrRejected.mockResolvedValue({
      pendingOrRejected: 2,
      approved: 1,
    });

    const state = new DocumentationPhaseState(context);

    await expect(state.moveToContractDrafting(1)).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks moveToContractDrafting when no approved docs', async () => {
    const { context, repositories } = createContext({
      negotiation: { ...createBaseSnapshot(), status: 'DOCUMENTATION_PHASE' },
    });
    repositories.negotiationDocuments.countPendingOrRejected.mockResolvedValue({
      pendingOrRejected: 0,
      approved: 0,
    });

    const state = new DocumentationPhaseState(context);

    await expect(state.moveToContractDrafting(1)).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves to CONTRACT_DRAFTING when docs are approved', async () => {
    const { context, trx, repositories } = createContext({
      negotiation: { ...createBaseSnapshot(), status: 'DOCUMENTATION_PHASE' },
    });

    const state = new DocumentationPhaseState(context);
    const result = await state.moveToContractDrafting(1);

    expect(repositories.negotiations.updateStatusWithOptimisticLock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: context.negotiation.id,
        toStatus: 'CONTRACT_DRAFTING',
        trx,
      })
    );
    expect(result.status).toBe('CONTRACT_DRAFTING');
  });
});

describe('AwaitingSignaturesState', () => {
  it('cancels negotiation and re-exposes property', async () => {
    const { context, trx, repositories } = createContext({
      negotiation: { ...createBaseSnapshot(), status: 'AWAITING_SIGNATURES' },
    });

    const state = new AwaitingSignaturesState(context);
    const result = await state.cancel(123);

    expect(repositories.negotiations.updateStatusWithOptimisticLock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: context.negotiation.id,
        toStatus: 'CANCELLED',
        trx,
      })
    );
    expect(repositories.properties.markAvailable).toHaveBeenCalledWith({
      id: context.negotiation.propertyId,
      trx,
    });
    expect(result.status).toBe('CANCELLED');
  });

  it('throws ConflictError when status does not match', async () => {
    const { context } = createContext({
      negotiation: { ...createBaseSnapshot(), status: 'DOCUMENTATION_PHASE' },
    });
    const state = new AwaitingSignaturesState(context);

    await expect(state.cancel(1)).rejects.toBeInstanceOf(ConflictError);
  });
});
