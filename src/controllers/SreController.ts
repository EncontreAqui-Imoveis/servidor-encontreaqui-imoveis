import { Request, Response } from 'express';
import { loadSreStats, updateExternalService, updateRelease } from '../services/sreStatsService';

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
            const success = await updateExternalService(name, { cost, status });
            if (success) {
                res.json({ message: 'Serviço atualizado com sucesso' });
            } else {
                res.status(404).json({ error: 'Serviço não encontrado' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar serviço' });
        }
    }

    public async handleGithubWebhook(req: Request, res: Response): Promise<void> {
        const payload = req.body;
        const repo = payload.repository?.name || 'backend';
        const version = payload.head_commit?.id?.substring(0, 7) || 'commiting';

        console.log(`Github Webhook: Deploy detectado no repo ${repo} (SHA: ${version})`);

        await updateRelease('github', repo, {
            version,
            status: 'building',
            impact: payload.head_commit?.message || 'Push to main'
        });

        res.json({ status: 'processed' });
    }

    public async handleRailwayWebhook(req: Request, res: Response): Promise<void> {
        const payload = req.body;

        const statusStr = payload.status || 'SUCCESS';

        let status = 'stable';
        if (statusStr === 'SUCCESS') status = 'success';
        else if (statusStr === 'FAILED' || statusStr === 'CRASHED') status = 'failed';
        else if (statusStr === 'BUILDING' || statusStr === 'INITIALIZING') status = 'building';
        else status = 'stable';

        const repo = payload.project?.name || 'backend';
        const version = payload.deployment?.meta?.commitHash?.substring(0, 7) || 'unknown';
        const impact = payload.deployment?.meta?.commitMessage || 'Railway Deploy';

        console.log(`Railway Webhook: Deploy ${statusStr} para ${repo} (SHA: ${version})`);

        await updateRelease('railway', repo, {
            version,
            status,
            impact
        });

        res.json({ status: 'processed' });
    }

    public async handleVercelWebhook(req: Request, res: Response): Promise<void> {
        const payload = req.body;
        const repo = payload.payload?.name || 'frontend';
        const version = payload.payload?.deployment?.id?.substring(0, 7) || 'deploy';

        let status = 'stable';
        if (payload.type === 'deployment.created') status = 'building';
        else if (payload.type === 'deployment.succeeded') status = 'success';
        else if (payload.type === 'deployment.error') status = 'failed';
        else if (payload.type === 'deployment.canceled') status = 'rollback';

        console.log(`Vercel Webhook: Deploy detectado para ${repo} (Status: ${status})`);

        await updateRelease('vercel', repo, {
            version,
            status,
            impact: 'Vercel Preview/Prod'
        });

        res.json({ status: 'processed' });
    }
}

export default new SreController();
