"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
class DashboardController {
    async getStats(req, res) {
        try {
            const [propertiesResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM properties');
            const [brokersResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM brokers');
            const [usersResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM users');
            const stats = {
                totalProperties: propertiesResult[0].total,
                totalBrokers: brokersResult[0].total,
                totalUsers: usersResult[0].total,
            };
            return res.json(stats);
        }
        catch (error) {
            console.error('Erro ao buscar estatísticas do dashboard:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}
exports.dashboardController = new DashboardController();
