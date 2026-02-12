import { NegotiationEventBus } from '../domain/events/NegotiationEventBus';
import type { TransactionManager } from '../domain/states/NegotiationState';
import { CommissionRulesRepository } from './CommissionRulesRepository';
import { CommissionService } from './CommissionService';
import { CommissionsRepository } from './CommissionsRepository';
import { ExternalPdfService } from './ExternalPdfService';
import { NegotiationDocumentsRepository } from './NegotiationDocumentsRepository';
import { NegotiationRepository } from './NegotiationRepository';
import { PropertiesRepository } from './PropertiesRepository';
import type { SqlExecutor } from './NegotiationRepository';

export interface NegotiationsCompositionRoot {
  eventBus: NegotiationEventBus;
  repositories: {
    negotiations: NegotiationRepository;
    negotiationDocuments: NegotiationDocumentsRepository;
    properties: PropertiesRepository;
    commissionRules: CommissionRulesRepository;
    commissions: CommissionsRepository;
  };
  services: {
    commissionService: CommissionService;
    pdfService: ExternalPdfService;
  };
}

export function buildNegotiationsCompositionRoot(params: {
  executor: SqlExecutor;
  transactionManager: TransactionManager<SqlExecutor>;
  eventBus?: NegotiationEventBus;
}): NegotiationsCompositionRoot {
  const eventBus = params.eventBus ?? new NegotiationEventBus();

  const negotiationRepository = new NegotiationRepository();
  const negotiationDocumentsRepository = new NegotiationDocumentsRepository(params.executor);
  const propertiesRepository = new PropertiesRepository(params.executor);
  const commissionRulesRepository = new CommissionRulesRepository(params.executor);
  const commissionsRepository = new CommissionsRepository(params.executor);
  const pdfService = new ExternalPdfService();

  const commissionService = new CommissionService({
    eventBus,
    transactionManager: params.transactionManager,
    commissionRulesRepository,
    commissionsRepository,
  });

  return {
    eventBus,
    repositories: {
      negotiations: negotiationRepository,
      negotiationDocuments: negotiationDocumentsRepository,
      properties: propertiesRepository,
      commissionRules: commissionRulesRepository,
      commissions: commissionsRepository,
    },
    services: {
      commissionService,
      pdfService,
    },
  };
}
