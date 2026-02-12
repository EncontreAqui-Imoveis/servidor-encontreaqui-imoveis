"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalPdfService = void 0;
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
class ExternalPdfService {
    baseUrl;
    jwtSecret;
    constructor(params) {
        this.baseUrl = (params?.baseUrl ?? process.env.PDF_SERVICE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
        this.jwtSecret = params?.jwtSecret ?? process.env.JWT_SECRET ?? '';
    }
    async generateProposal(data) {
        if (!this.jwtSecret) {
            throw new Error('JWT_SECRET is not configured for PDF service auth.');
        }
        const token = jsonwebtoken_1.default.sign({ scope: 'pdf-service' }, this.jwtSecret, {
            algorithm: 'HS256',
            expiresIn: '1m',
        });
        const payload = {
            client_name: data.clientName,
            client_cpf: data.clientCpf,
            property_address: data.propertyAddress,
            broker_name: data.brokerName,
            selling_broker_name: data.sellingBrokerName ?? '',
            value: data.value,
            payment_method: data.paymentMethod,
            validity_days: data.validityDays,
        };
        const response = await axios_1.default.post(`${this.baseUrl}/generate-proposal`, payload, {
            responseType: 'arraybuffer',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return Buffer.from(response.data);
    }
}
exports.ExternalPdfService = ExternalPdfService;
