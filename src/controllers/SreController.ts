import { Request, Response } from 'express';
import { loadSreStats, updateExternalService } from '../services/sreStatsService';

class SreController {
    public async getStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await loadSreStats();
            res.json(stats);
        } catch (error) {
            console.error('Erro ao buscar SRE stats:', error);
            res.status(500).json({ error: 'Erro interno ao buscar estatísticas SRE' });
        }
    }

    public async updateService(req: Request, res: Response): Promise<void> {
        const { name } = req.params;
        const { cost, status } = req.body;

        try {
            const success = updateExternalService(name, { cost, status });
            if (success) {
                res.json({ message: 'Serviço atualizado com sucesso' });
            } else {
                res.status(404).json({ error: 'Serviço não encontrado' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar serviço' });
        }
    }

    public async handleWebhook(req: Request, res: Response): Promise<void> {
        // Logica simplificada de webhook - em produção validaria assinaturas
        const payload = req.body;
        console.log('Webhook SRE recebido:', payload);

        // Mock de processamento de deploy
        res.json({ status: 'received' });
    }
}

export default new SreController();
