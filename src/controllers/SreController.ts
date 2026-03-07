import { Request, Response } from 'express';
import { loadSreStats } from '../services/sreStatsService';

class SreController {
    async getStats(req: Request, res: Response) {
        try {
            const stats = await loadSreStats();
            return res.json(stats);
        } catch (error) {
            console.error('Erro ao buscar estatísticas SRE:', error);
            return res.status(500).json({
                error: 'Ocorreu um erro ao processar as métricas de infraestrutura.'
            });
        }
    }
}

export const sreController = new SreController();
