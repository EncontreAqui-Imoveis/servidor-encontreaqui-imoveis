"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNegotiationsCompositionRoot = buildNegotiationsCompositionRoot;
const NegotiationEventBus_1 = require("../domain/events/NegotiationEventBus");
const CommissionRulesRepository_1 = require("./CommissionRulesRepository");
const CommissionService_1 = require("./CommissionService");
const CommissionsRepository_1 = require("./CommissionsRepository");
const ExternalPdfService_1 = require("./ExternalPdfService");
const NegotiationDocumentsRepository_1 = require("./NegotiationDocumentsRepository");
const NegotiationRepository_1 = require("./NegotiationRepository");
const PropertiesRepository_1 = require("./PropertiesRepository");
function buildNegotiationsCompositionRoot(params) {
    const eventBus = params.eventBus ?? new NegotiationEventBus_1.NegotiationEventBus();
    const negotiationRepository = new NegotiationRepository_1.NegotiationRepository();
    const negotiationDocumentsRepository = new NegotiationDocumentsRepository_1.NegotiationDocumentsRepository(params.executor);
    const propertiesRepository = new PropertiesRepository_1.PropertiesRepository(params.executor);
    const commissionRulesRepository = new CommissionRulesRepository_1.CommissionRulesRepository(params.executor);
    const commissionsRepository = new CommissionsRepository_1.CommissionsRepository(params.executor);
    const pdfService = new ExternalPdfService_1.ExternalPdfService();
    const commissionService = new CommissionService_1.CommissionService({
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
