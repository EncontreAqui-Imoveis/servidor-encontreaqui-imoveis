import { ConflictError } from '../errors/ConflictError';
import type { NegotiationEventBus } from '../events/NegotiationEventBus';

export type NegotiationStatus =
  | 'PROPOSAL_DRAFT'
  | 'PROPOSAL_SENT'
  | 'IN_NEGOTIATION'
  | 'DOCUMENTATION_PHASE'
  | 'CONTRACT_DRAFTING'
  | 'AWAITING_SIGNATURES'
  | 'SOLD'
  | 'RENTED'
  | 'CANCELLED';

export type PaymentMethod = 'MONEY' | 'PERMUTATION' | 'FINANCING' | 'OTHER';

export interface PaymentDetails {
  method: PaymentMethod;
  amount: number;
  details?: Record<string, unknown> | null;
}

export interface ProposalData {
  clientName: string;
  clientCpf: string;
  propertyAddress: string;
  brokerName: string;
  sellingBrokerName?: string | null;
  value: number;
  paymentMethod: string;
  validityDays: number;
}

export interface ProposalPdfService {
  generateProposal(data: ProposalData): Promise<Buffer>;
}

export interface NegotiationSnapshot {
  id: string;
  status: NegotiationStatus;
  version: number;
  propertyId: number;
  capturingBrokerId: number;
  sellingBrokerId: number | null;
  buyerClientId: number | null;
  finalValue: number | null;
  paymentDetails: PaymentDetails | null;
  proposalValidityDate: string | null;
}

export type OrmTransaction = unknown;

export interface TransactionManager<Tx = OrmTransaction> {
  run<T>(fn: (trx: Tx) => Promise<T>): Promise<T>;
}

export interface NegotiationsRepository<Tx = OrmTransaction> {
  updateStatusWithOptimisticLock(params: {
    id: string;
    fromStatus: NegotiationStatus;
    toStatus: NegotiationStatus;
    expectedVersion: number;
    actorId: number;
    metadata?: Record<string, unknown> | null;
    trx: Tx;
  }): Promise<void>;
  updateDraftWithOptimisticLock(params: {
    id: string;
    expectedVersion: number;
    paymentDetails: PaymentDetails;
    finalValue: number | null;
    proposalValidityDate: string | null;
    sellingBrokerId: number | null;
    trx: Tx;
  }): Promise<number>;
}

export interface PropertiesRepository<Tx = OrmTransaction> {
  getPropertyValue(params: { id: number; trx?: Tx }): Promise<number>;
  updateLifecycleStatus(params: {
    id: number;
    status: 'SOLD' | 'RENTED';
    trx: Tx;
  }): Promise<void>;
  markUnderNegotiation(params: { id: number; trx: Tx }): Promise<void>;
  markAvailable(params: { id: number; trx: Tx }): Promise<void>;
}

export interface NegotiationDocumentsRepository<Tx = OrmTransaction> {
  countPendingOrRejected(params: {
    negotiationId: string;
    trx?: Tx;
  }): Promise<{ pendingOrRejected: number; approved: number }>;
  findById(
    documentId: number,
    trx?: Tx
  ): Promise<{ fileContent: Buffer; type: string } | null>;
  saveProposal(
    negotiationId: string,
    pdfBuffer: Buffer,
    trx?: Tx
  ): Promise<number>;
}

export interface NegotiationRepositories<Tx = OrmTransaction> {
  negotiations: NegotiationsRepository<Tx>;
  negotiationDocuments: NegotiationDocumentsRepository<Tx>;
  properties: PropertiesRepository<Tx>;
}

export interface NegotiationStateContext<Tx = OrmTransaction> {
  negotiation: NegotiationSnapshot;
  repositories: NegotiationRepositories<Tx>;
  transactionManager: TransactionManager<Tx>;
  eventBus: NegotiationEventBus;
  proposalPdfService?: ProposalPdfService;
}

export abstract class NegotiationState<Tx = OrmTransaction> {
  protected readonly context: NegotiationStateContext<Tx>;

  constructor(context: NegotiationStateContext<Tx>) {
    this.context = context;
  }

  abstract getStatus(): NegotiationStatus;

  protected async persistTransition(params: {
    toStatus: NegotiationStatus;
    actorId: number;
    metadata?: Record<string, unknown>;
    trx?: Tx;
  }): Promise<NegotiationSnapshot> {
    const { negotiation, repositories, transactionManager } = this.context;

    if (negotiation.status !== this.getStatus()) {
      throw new ConflictError(
        `State mismatch. Expected ${this.getStatus()} but got ${negotiation.status}.`
      );
    }

    const runWith = async (trx: Tx) => {
      await repositories.negotiations.updateStatusWithOptimisticLock({
        id: negotiation.id,
        fromStatus: negotiation.status,
        toStatus: params.toStatus,
        expectedVersion: negotiation.version,
        actorId: params.actorId,
        metadata: params.metadata ?? null,
        trx,
      });

      return {
        ...negotiation,
        status: params.toStatus,
        version: negotiation.version + 1,
      };
    };

    if (params.trx) {
      return runWith(params.trx);
    }

    return transactionManager.run(runWith);
  }
}
