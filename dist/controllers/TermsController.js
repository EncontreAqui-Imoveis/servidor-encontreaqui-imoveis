"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.termsController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
class TermsController {
    async getCurrentTerms(req, res) {
        try {
            const [terms] = await connection_1.default.query('SELECT * FROM broker_terms WHERE active = TRUE ORDER BY created_at DESC LIMIT 1');
            res.json(terms);
        }
        catch (error) {
            res.status(500).json({ error: 'Erro ao buscar termos.' });
        }
    }
    async acceptTerms(req, res) {
        const brokerId = req.userId;
        const { termsId } = req.body;
        try {
            await connection_1.default.query('INSERT INTO broker_acceptances (broker_id, terms_id) VALUES (?, ?)', [brokerId, termsId]);
            res.json({ message: 'Termos aceitos com sucesso.' });
        }
        catch (error) {
            res.status(500).json({ error: 'Erro ao registrar aceitação.' });
        }
    }
}
exports.termsController = new TermsController();
