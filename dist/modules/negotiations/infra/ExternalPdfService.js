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
    endpointUrl;
    jwtSecret;
    constructor(params) {
        const rawBaseUrl = (params?.baseUrl ?? process.env.PDF_SERVICE_URL ?? 'http://localhost:8080')
            .trim()
            .replace(/\/+$/, '');
        const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseUrl);
        this.baseUrl = hasScheme ? rawBaseUrl : `http://${rawBaseUrl}`;
        this.endpointUrl = this.baseUrl.endsWith('/generate-proposal')
            ? this.baseUrl
            : `${this.baseUrl}/generate-proposal`;
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
        try {
            const response = await axios_1.default.post(this.endpointUrl, payload, {
                responseType: 'arraybuffer',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            return Buffer.from(response.data);
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                const responseStatus = error.response?.status;
                const responseStatusText = error.response?.statusText ?? null;
                const responseData = (() => {
                    const data = error.response?.data;
                    if (data == null)
                        return null;
                    if (typeof data === 'string')
                        return data.slice(0, 500);
                    if (Buffer.isBuffer(data))
                        return data.toString('utf8', 0, 500);
                    if (data instanceof ArrayBuffer)
                        return Buffer.from(data).toString('utf8', 0, 500);
                    if (ArrayBuffer.isView(data)) {
                        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8', 0, 500);
                    }
                    try {
                        return JSON.stringify(data).slice(0, 500);
                    }
                    catch {
                        return String(data).slice(0, 500);
                    }
                })();
                console.error('ExternalPdfService.generateProposal failed', {
                    endpointUrl: this.endpointUrl,
                    baseUrl: this.baseUrl,
                    axiosCode: error.code ?? null,
                    responseStatus,
                    responseStatusText,
                    responseData,
                });
            }
            else {
                console.error('ExternalPdfService.generateProposal failed with non-axios error', {
                    endpointUrl: this.endpointUrl,
                    baseUrl: this.baseUrl,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            throw error;
        }
    }
}
exports.ExternalPdfService = ExternalPdfService;
