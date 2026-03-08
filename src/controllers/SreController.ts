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
        // Match the frontend component expected key releases["github:backend"]
        const repo = payload.repository?.name === 'painel-adm-maisimoveis' || payload.repository?.name === 'frontend' ? 'frontend' : 'backend';

        let version = 'unknown';
        let status = 'stable';
        let impact = 'GitHub Action';

        if (payload.workflow_run) {
            // Evento workflow_run
            version = payload.workflow_run.head_commit?.id?.substring(0, 7) || payload.workflow_run.head_sha?.substring(0, 7) || 'unknown';
            impact = payload.workflow_run.head_commit?.message || `Workflow: ${payload.workflow_run.name}`;

            if (payload.workflow_run.status === 'completed') {
                if (payload.workflow_run.conclusion === 'success') status = 'success';
                else if (payload.workflow_run.conclusion === 'failure') status = 'failed';
                else status = 'rollback'; // cancelled, skipped
            } else {
                status = 'building';
            }
        } else if (payload.head_commit) {
            // Fallback para push event
            version = payload.head_commit.id?.substring(0, 7) || 'commiting';
            impact = payload.head_commit.message || 'Push to main';
            status = 'building';
        } else {
            res.json({ status: 'ignored' });
            return;
        }

        console.log(`Github Webhook: Evento detectado no repo ${repo} (SHA: ${version}) -> Status ${status}`);

        await updateRelease('github', repo, {
            version,
            status,
            impact
        });

        res.json({ status: 'processed' });
    }

    public async handleRailwayWebhook(req: Request, res: Response): Promise<void> {
        const payload = req.body;

        const eventType = payload.type || '';
        const statusStr = payload.status || 'SUCCESS';

        let status = 'stable';

        // Mapeamento Exaustivo de Eventos do Railway fornecido pelo usuário
        if (
            eventType === 'DEPLOYMENT_FAILED' ||
            eventType === 'DEPLOYMENT_CRASHED' ||
            eventType === 'DEPLOYMENT_OOM_KILLED' ||
            statusStr === 'FAILED' ||
            statusStr === 'CRASHED'
        ) {
            status = 'failed';
        } else if (
            eventType === 'DEPLOYMENT_BUILDING' ||
            eventType === 'DEPLOYMENT_DEPLOYING' ||
            eventType === 'DEPLOYMENT_QUEUED' ||
            eventType === 'DEPLOYMENT_WAITING' ||
            eventType === 'DEPLOYMENT_NEEDS_APPROVAL' ||
            statusStr === 'BUILDING' ||
            statusStr === 'INITIALIZING'
        ) {
            status = 'building';
        } else if (
            eventType === 'DEPLOYMENT_DEPLOYED' ||
            eventType === 'DEPLOYMENT_REDEPLOYED' ||
            eventType === 'DEPLOYMENT_RESTARTED' ||
            statusStr === 'SUCCESS'
        ) {
            status = 'success';
        } else if (eventType === 'DEPLOYMENT_REMOVED') {
            status = 'rollback';
        } else {
            // Monitor Triggered, VolumeAlert Triggered, Slept, Resumed, etc.
            status = 'warning';
            if (eventType === 'DEPLOYMENT_RESUMED' || eventType === 'VOLUME_ALERT_RESOLVED') {
                status = 'stable';
            }
        }

        // Force map the Railway project name to 'backend' to match Frontend UI expectations
        const repo = 'backend';
        const version = payload.deployment?.meta?.commitHash?.substring(0, 7) || 'unknown';

        // Customizar impacto baseado no evento extremo
        let impact = payload.deployment?.meta?.commitMessage || 'Railway Deploy';
        if (eventType === 'VOLUME_ALERT_TRIGGERED') impact = '⚠️ Alerta de Espaço (Volume) no Railway!';
        else if (eventType === 'DEPLOYMENT_OOM_KILLED') impact = '💥 Servidor derrubado por falta de Memória (OOM)';
        else if (eventType === 'MONITOR_TRIGGERED') impact = '📉 Monitoramento de Saúde falhou';
        else if (eventType === 'DEPLOYMENT_SLEPT') impact = '💤 Servidor entrou em hibernação';

        console.log(`Railway Webhook: Evento ${eventType} para ${repo} (SHA: ${version}) -> Status ${status}`);

        // Save as 'github' platform so it groups correctly in the frontend UI with the git commits
        await updateRelease('github', repo, {
            version,
            status: status === 'warning' ? 'failed' : status, // Mapear warning tbm para visual failure por agora se for critico
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
