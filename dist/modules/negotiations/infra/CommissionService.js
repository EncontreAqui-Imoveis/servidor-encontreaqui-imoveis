"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommissionService = void 0;
const ValidationError_1 = require("../domain/errors/ValidationError");
const toRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) {
        return result[0];
    }
    return result;
};
class CommissionService {
    eventBus;
    transactionManager;
    commissionRulesRepository;
    commissionsRepository;
    constructor(params) {
        this.eventBus = params.eventBus;
        this.transactionManager = params.transactionManager;
        this.commissionRulesRepository = params.commissionRulesRepository;
        this.commissionsRepository = params.commissionsRepository;
        this.eventBus.onDealClosed((payload) => {
            void this.handleDealClosed(payload.negotiationId);
        });
    }
    async handleDealClosed(negotiationId) {
        await this.transactionManager.run(async (trx) => {
            const negotiation = await this.fetchNegotiation(trx, negotiationId);
            const rule = await this.fetchActiveRule(trx);
            const commissions = this.calculateCommissions(negotiation, rule);
            if (commissions.length === 0) {
                return;
            }
            await this.insertCommissions(trx, negotiation.id, commissions);
        });
    }
    async fetchNegotiation(trx, negotiationId) {
        const sql = `
      SELECT id, final_value, capturing_broker_id, selling_broker_id
      FROM negotiations
      WHERE id = ?
      LIMIT 1
    `;
        const rows = toRows(await trx.execute(sql, [negotiationId]));
        const negotiation = rows?.[0];
        if (!negotiation) {
            throw new ValidationError_1.ValidationError('Negotiation not found for commission calculation.');
        }
        return negotiation;
    }
    async fetchActiveRule(trx) {
        return this.commissionRulesRepository.getActiveRule({ trx });
    }
    calculateCommissions(negotiation, rule) {
        const finalValue = Number(negotiation.final_value ?? 0);
        if (!Number.isFinite(finalValue) || finalValue <= 0) {
            throw new ValidationError_1.ValidationError('final_value is required to calculate commissions.');
        }
        const capturingPercentage = rule.capturingPercentage;
        const sellingPercentage = rule.sellingPercentage;
        const totalPercentage = rule.totalPercentage;
        if (negotiation.selling_broker_id === null) {
            throw new ValidationError_1.ValidationError('selling_broker_id is required to calculate commissions.');
        }
        if (negotiation.capturing_broker_id === negotiation.selling_broker_id) {
            return [
                {
                    brokerId: negotiation.capturing_broker_id,
                    role: 'CAPTURING',
                    amount: Number(((finalValue * totalPercentage) / 100).toFixed(2)),
                },
            ];
        }
        return [
            {
                brokerId: negotiation.capturing_broker_id,
                role: 'CAPTURING',
                amount: Number(((finalValue * capturingPercentage) / 100).toFixed(2)),
            },
            {
                brokerId: negotiation.selling_broker_id,
                role: 'SELLING',
                amount: Number(((finalValue * sellingPercentage) / 100).toFixed(2)),
            },
        ];
    }
    async insertCommissions(trx, negotiationId, commissions) {
        await this.commissionsRepository.insertMany({
            negotiationId,
            commissions,
            trx,
        });
    }
}
exports.CommissionService = CommissionService;
