import os from 'os';
import connection from '../database/connection';
import { getRegistry } from '../middlewares/metrics';
import client from 'prom-client';

export interface SreStats {
    latency: {
        p99: string;
        unit: string;
        status: 'healthy' | 'warning' | 'critical';
        trend: 'up' | 'down' | 'neutral';
        trendValue: string;
        history: number[];
    };
    traffic: {
        rps: string;
        unit: string;
        status: 'healthy' | 'warning' | 'critical';
        trend: 'up' | 'down' | 'neutral';
        trendValue: string;
        history: number[];
    };
    errors: {
        rate: string;
        unit: string;
        status: 'healthy' | 'warning' | 'critical';
        trend: 'up' | 'down' | 'neutral';
        trendValue: string;
        history: number[];
    };
    saturation: {
        cpu: string;
        memory: string;
        unit: string;
        status: 'healthy' | 'warning' | 'critical';
        trend: 'up' | 'down' | 'neutral';
        trendValue: string;
        history: number[];
    };
    availability: Record<string, {
        uptimeCurrent: number;
        downtimeMinutes: number;
        history: number[];
    }>;
    alerts: {
        id: string;
        severity: 'critical' | 'warning' | 'info';
        service: string;
        message: string;
        duration: string;
        time: string;
    }[];
    externalServices: {
        name: string;
        provider: string;
        status: 'operational' | 'degraded' | 'outage';
        latency?: string;
        cost: number;
    }[];
    releases: Record<string, {
        version: string;
        date: string;
        time: string;
        status: 'success' | 'rollback' | 'stable';
        impact: string;
    }[]>;
}

function generateHistory(baseline: number, count: number, variance: number = 0.2): number[] {
    const history: number[] = [];
    for (let i = 0; i < count; i++) {
        const factor = 1 + (Math.random() * variance * 2 - variance);
        history.push(Number((baseline * factor).toFixed(2)));
    }
    return history;
}

export class SreStatsService {
    private externalServices: { name: string; provider: string; status: 'operational' | 'degraded' | 'outage'; latency?: string; cost: number }[] = [
        { name: 'Vercel', provider: 'Deployment', status: 'operational', latency: '45ms', cost: 135.50 },
        { name: 'Railway', provider: 'API Engine', status: 'operational', latency: '82ms', cost: 180.00 },
        { name: 'Cloudflare R2', provider: 'Storage', status: 'operational', cost: 45.00 },
        { name: 'Cloudinary', provider: 'CDN', status: 'operational', cost: 89.90 },
        { name: 'Brevo', provider: 'Email/Marketing', status: 'operational', cost: 50.00 },
        { name: 'Firebase', provider: 'Auth/Push', status: 'operational', cost: 0.00 }
    ];

    private async getSystemLoadFactor(): Promise<number> {
        try {
            const [props] = await connection.query('SELECT COUNT(*) as total FROM properties') as any;
            const [users] = await connection.query('SELECT COUNT(*) as total FROM users') as any;
            const totalItems = (props[0]?.total || 0) + (users[0]?.total || 0);

            const cpuUsage = os.loadavg()[0] * 10;
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const memUsage = ((totalMem - freeMem) / totalMem) * 100;
            const currentUtil = (cpuUsage + memUsage) / 2;

            return Math.min(1, (currentUtil / 100) * 0.7 + (totalItems / 5000) * 0.3);
        } catch (e) {
            return 0.5; // Fallback
        }
    }

    private generateAvailabilityData() {
        return {
            "Minuto": { uptimeCurrent: 100, downtimeMinutes: 0, history: [100, 100, 100, 100, 100] },
            "Hora": { uptimeCurrent: 99.99, downtimeMinutes: 0.1, history: generateHistory(100, 10, 0.01) },
            "Dia": { uptimeCurrent: 99.98, downtimeMinutes: 0.5, history: generateHistory(99.99, 10, 0.02) },
            "Semana": { uptimeCurrent: 99.88, downtimeMinutes: 12.0, history: generateHistory(99.88, 7, 0.05) },
            "Mês": { uptimeCurrent: 99.92, downtimeMinutes: 34.5, history: generateHistory(99.92, 30, 0.1) },
            "Ano": { uptimeCurrent: 99.50, downtimeMinutes: 438, history: generateHistory(99.5, 12, 0.5) }
        };
    }

    private async getRealMetrics() {
        const registry = getRegistry();
        const metrics = await registry.getMetricsAsJSON();

        // Find our histogram
        const durationMetric: any = metrics.find((m: any) => m.name === 'http_request_duration_seconds');

        let p99 = 0;
        let avgLatency = 0;
        let totalReqs = 0;
        let errorReqs = 0;

        if (durationMetric && durationMetric.values) {
            // Very simplified calculation for p99 from Histogram buckets
            // In a real SRE tool we'd use Prometheus queries, here we aggregate the current registry state
            totalReqs = durationMetric.values.filter((v: any) => v.metricName === 'http_request_duration_seconds_count').reduce((a: any, b: any) => a + b.value, 0);

            errorReqs = durationMetric.values.filter((v: any) => v.metricName === 'http_request_duration_seconds_count' && v.labels.code >= 400).reduce((a: any, b: any) => a + b.value, 0);

            const sum = durationMetric.values.find((v: any) => v.metricName === 'http_request_duration_seconds_sum')?.value || 0;
            avgLatency = totalReqs > 0 ? (sum / totalReqs) * 1000 : 45; // ms
            p99 = avgLatency * 1.5; // Heuristic p99 based on avg for mock-real transition
        }

        return {
            latency: p99 || 45,
            errorRate: totalReqs > 0 ? (errorReqs / totalReqs) * 100 : 0,
            rps: totalReqs / 60 // Assuming we are looking at a window, simplified
        };
    }

    private releases: Record<string, any[]> = {
        "github:backend": [
            { version: "1.4.9", date: "Hoje", time: "18:10", status: "success", impact: "Nenhum" },
            { version: "1.4.8", date: "Hoje", time: "14:20", status: "stable", impact: "Nenhum" }
        ],
        "github:frontend": [
            { version: "2.1.0", date: "Ontem", time: "09:30", status: "success", impact: "UX Melhorada" }
        ],
        "vercel:frontend": [
            { version: "2.1.0", date: "Ontem", time: "09:45", status: "success", impact: "Prod Deployed" }
        ]
    };

    public async getSreStats(): Promise<SreStats> {
        const loadFactor = await this.getSystemLoadFactor();
        const cpuUtil = os.loadavg()[0] * 10;
        const memoryUtil = (1 - os.freemem() / os.totalmem()) * 100;
        const real = await this.getRealMetrics();

        return {
            latency: {
                p99: `${real.latency.toFixed(0)}`,
                unit: 'ms',
                status: real.latency > 500 ? 'warning' : 'healthy',
                trend: real.latency > 100 ? 'up' : 'down',
                trendValue: `2.4%`,
                history: generateHistory(real.latency, 24)
            },
            traffic: {
                rps: `${real.rps.toFixed(1)}`,
                unit: 'req/s',
                status: 'healthy',
                trend: 'neutral',
                trendValue: '0%',
                history: generateHistory(real.rps || 0.5, 24)
            },
            errors: {
                rate: `${real.errorRate.toFixed(3)}`,
                unit: '%',
                status: real.errorRate > 1 ? 'critical' : real.errorRate > 0.1 ? 'warning' : 'healthy',
                trend: 'neutral',
                trendValue: '0%',
                history: generateHistory(real.errorRate, 24, 0.5)
            },
            saturation: {
                cpu: `${cpuUtil.toFixed(1)}`,
                memory: `${memoryUtil.toFixed(1)}`,
                unit: '%',
                status: cpuUtil > 80 ? 'warning' : 'healthy',
                trend: 'neutral',
                trendValue: '2.1%',
                history: generateHistory(cpuUtil, 24)
            },
            availability: this.generateAvailabilityData(),
            alerts: [
                {
                    id: '1',
                    severity: 'info',
                    service: 'Sistema de Monitoramento',
                    message: 'Coleta de métricas reais via prom-client ativa.',
                    duration: '1m',
                    time: 'Agora'
                }
            ],
            externalServices: this.externalServices,
            releases: this.releases
        };
    }

    public updateRelease(platform: string, repo: string, data: any) {
        const key = `${platform}:${repo}`;
        if (!this.releases[key]) this.releases[key] = [];

        this.releases[key].unshift({
            version: data.version || 'unknown',
            date: 'Hoje',
            time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: data.status || 'success',
            impact: data.impact || 'Webhook Deploy'
        });

        // Keep last 10
        if (this.releases[key].length > 10) this.releases[key].pop();
        return true;
    }

    public updateExternalService(name: string, data: { cost?: number; status?: 'operational' | 'degraded' | 'outage' }) {
        const service = this.externalServices.find(s => s.name.toLowerCase() === name.toLowerCase());
        if (service) {
            if (data.cost !== undefined) service.cost = data.cost;
            if (data.status !== undefined) service.status = data.status;
            return true;
        }
        return false;
    }
}

const sreStatsService = new SreStatsService();
export async function loadSreStats() {
    return sreStatsService.getSreStats();
}

export function updateExternalService(name: string, data: any) {
    return sreStatsService.updateExternalService(name, data);
}

export function updateRelease(platform: string, repo: string, data: any) {
    return sreStatsService.updateRelease(platform, repo, data);
}
