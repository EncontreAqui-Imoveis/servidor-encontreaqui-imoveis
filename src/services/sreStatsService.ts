import fs from 'fs';
import os from 'os';
import { RowDataPacket } from 'mysql2';

import connection from '../database/connection';
import { getRegistry } from '../middlewares/metrics';

const ENABLED_VALUES = new Set(['1', 'true', 'yes']);
const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const MIN_SNAPSHOT_INTERVAL_MS = 60 * 1000;
const MAX_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 90;

type HealthStatus = 'healthy' | 'warning' | 'critical';
type Trend = 'up' | 'down' | 'neutral';

type MetricSnapshot = {
  latencyMs: number;
  requestsPerSecond: number;
  errorRatePercent: number;
  cpuPercent: number;
  memoryPercent: number;
};

type MetricHistoryRow = RowDataPacket & { value: number | string };
type ReleaseRow = RowDataPacket & {
  id: number;
  platform: string;
  repo: string;
  version: string;
  status: string;
  impact: string | null;
  applied_at: Date | string;
};
type ExternalServiceRow = RowDataPacket & {
  name: string;
  provider: string;
  status: 'operational' | 'degraded' | 'outage';
  latency: string | null;
  cost: number | string;
};

export interface SreStats {
  latency: SreMetricCard & { p99: string };
  traffic: SreMetricCard & { rps: string };
  errors: SreMetricCard & { rate: string };
  saturation: SreMetricCard & { cpu: string; memory: string };
  availability: Record<string, { uptimeCurrent: number; downtimeMinutes: number; history: number[] }>;
  alerts: SreAlert[];
  externalServices: SreExternalService[];
  releases: Record<string, SreRelease[]>;
}

type SreMetricCard = {
  unit: string;
  status: HealthStatus;
  trend: Trend;
  trendValue: string;
  history: number[];
};
type SreAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  service: string;
  message: string;
  duration: string;
  time: string;
};
type SreExternalService = {
  name: string;
  provider: string;
  status: 'operational' | 'degraded' | 'outage';
  latency?: string;
  cost: number;
};
type SreRelease = {
  version: string;
  date: string;
  time: string;
  status: 'success' | 'rollback' | 'stable' | 'failed' | 'building';
  impact: string;
};

export function isSreStatsEnabled(value = process.env.SRE_STATS_ENABLED): boolean {
  return ENABLED_VALUES.has(String(value ?? '').trim().toLowerCase());
}

function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function getSreSnapshotIntervalMs(value = process.env.SRE_METRICS_SNAPSHOT_INTERVAL_MS): number {
  return parseBoundedInteger(value, DEFAULT_SNAPSHOT_INTERVAL_MS, MIN_SNAPSHOT_INTERVAL_MS, MAX_SNAPSHOT_INTERVAL_MS);
}

export function getSreRetentionIntervalMs(value = process.env.SRE_RETENTION_INTERVAL_MS): number {
  return parseBoundedInteger(value, DEFAULT_RETENTION_INTERVAL_MS, MIN_SNAPSHOT_INTERVAL_MS, DEFAULT_RETENTION_INTERVAL_MS);
}

export function getSreRetentionDays(value = process.env.SRE_METRICS_RETENTION_DAYS): number {
  return parseBoundedInteger(value, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentageChange(history: number[]): { trend: Trend; value: string } {
  if (history.length < 2) return { trend: 'neutral', value: 'sem histórico' };
  const previous = history[history.length - 2];
  const current = history[history.length - 1];
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
    return { trend: 'neutral', value: 'sem comparação' };
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) < 0.1) return { trend: 'neutral', value: '0.0%' };
  return { trend: change > 0 ? 'up' : 'down', value: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` };
}

/** Calculates a quantile from cumulative Prometheus histogram buckets. */
export function calculateHistogramQuantile(
  quantile: number,
  buckets: Array<{ upperBound: number; count: number }>,
): number {
  const sorted = buckets
    .filter((bucket) => Number.isFinite(bucket.upperBound) && Number.isFinite(bucket.count))
    .sort((left, right) => left.upperBound - right.upperBound);
  const total = sorted.at(-1)?.count ?? 0;
  if (total <= 0) return 0;

  const target = total * quantile;
  let previousCount = 0;
  let previousUpperBound = 0;
  for (const bucket of sorted) {
    if (bucket.count >= target) {
      const bucketDelta = bucket.count - previousCount;
      if (bucketDelta <= 0) return bucket.upperBound;
      return previousUpperBound + ((target - previousCount) / bucketDelta) * (bucket.upperBound - previousUpperBound);
    }
    previousCount = bucket.count;
    previousUpperBound = bucket.upperBound;
  }
  return sorted.at(-1)?.upperBound ?? 0;
}

function statusFor(value: number, warning: number, critical: number): HealthStatus {
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'healthy';
}

export class SreStatsService {
  private metricsTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;
  private snapshotInFlight = false;
  private retentionInFlight = false;

  start(): void {
    if (this.metricsTimer || this.retentionTimer) return;
    void this.takeMetricsSnapshot();
    void this.pruneMetricHistory();
    this.metricsTimer = setInterval(() => void this.takeMetricsSnapshot(), getSreSnapshotIntervalMs());
    this.retentionTimer = setInterval(() => void this.pruneMetricHistory(), getSreRetentionIntervalMs());
  }

  stop(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.metricsTimer = undefined;
    this.retentionTimer = undefined;
  }

  private async takeMetricsSnapshot(): Promise<void> {
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      const metrics = await this.getRuntimeMetrics();
      const entries: Array<[string, number]> = [
        ['latency_ms', metrics.latencyMs],
        ['requests_per_second', metrics.requestsPerSecond],
        ['error_rate_percent', metrics.errorRatePercent],
        ['cpu_percent', metrics.cpuPercent],
        ['memory_percent', metrics.memoryPercent],
      ];
      for (const [metricName, value] of entries) {
        await connection.query(
          'INSERT INTO sre_metrics_history (metric_name, value, source) VALUES (?, ?, ?)',
          [metricName, value, 'backend'],
        );
      }
    } catch (error) {
      console.error('SRE_METRICS_SNAPSHOT_FAILED', {
        message: error instanceof Error ? error.message : 'Erro não identificado',
      });
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private async pruneMetricHistory(): Promise<void> {
    if (this.retentionInFlight) return;
    this.retentionInFlight = true;
    try {
      await connection.query(
        'DELETE FROM sre_metrics_history WHERE timestamp < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)',
        [getSreRetentionDays()],
      );
    } catch (error) {
      console.error('SRE_METRICS_RETENTION_FAILED', {
        message: error instanceof Error ? error.message : 'Erro não identificado',
      });
    } finally {
      this.retentionInFlight = false;
    }
  }

  private getContainerMetrics(): { cpuPercent: number; memoryPercent: number } {
    try {
      if (fs.existsSync('/sys/fs/cgroup/memory.current') && fs.existsSync('/sys/fs/cgroup/memory.max')) {
        const current = safeNumber(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
        const maximumRaw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
        const maximum = maximumRaw === 'max' ? os.totalmem() : safeNumber(maximumRaw);
        const memoryPercent = maximum > 0 ? Math.min(100, (current / maximum) * 100) : 0;
        const cpuPercent = Math.min(100, (os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100);
        return { cpuPercent, memoryPercent };
      }
      const memoryPercent = Math.min(100, (1 - os.freemem() / os.totalmem()) * 100);
      const cpuPercent = process.platform === 'win32'
        ? 0
        : Math.min(100, (os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100);
      return { cpuPercent, memoryPercent };
    } catch {
      return { cpuPercent: 0, memoryPercent: 0 };
    }
  }

  private async getRuntimeMetrics(): Promise<MetricSnapshot> {
    const { cpuPercent, memoryPercent } = this.getContainerMetrics();
    const metrics = await getRegistry().getMetricsAsJSON();
    const duration = metrics.find((metric) => metric.name === 'http_request_duration_seconds');
    const responses = metrics.find((metric) => metric.name === 'http_responses_total');
    const bucketTotals = (duration?.values ?? [])
      .filter((value) => value.labels?.le !== undefined)
      .reduce<Map<string, number>>((totals, value) => {
        const upperBound = String(value.labels?.le ?? '');
        if (upperBound === '+Inf') return totals;
        totals.set(upperBound, (totals.get(upperBound) ?? 0) + safeNumber(value.value));
        return totals;
      }, new Map());
    const latencyMs = calculateHistogramQuantile(
      0.99,
      [...bucketTotals.entries()].map(([upperBound, count]) => ({ upperBound: Number(upperBound), count })),
    ) * 1000;
    const responseValues = responses?.values ?? [];
    const totalResponses = responseValues.reduce((total, value) => total + safeNumber(value.value), 0);
    const failedResponses = responseValues
      .filter((value) => Number(value.labels?.code ?? 0) >= 400)
      .reduce((total, value) => total + safeNumber(value.value), 0);
    return {
      latencyMs,
      requestsPerSecond: totalResponses / Math.max(process.uptime(), 1),
      errorRatePercent: totalResponses > 0 ? (failedResponses / totalResponses) * 100 : 0,
      cpuPercent,
      memoryPercent,
    };
  }

  private async getMetricHistory(metricName: string, count = 24): Promise<number[]> {
    try {
      const [rows] = await connection.query<MetricHistoryRow[]>(
        `SELECT value FROM sre_metrics_history WHERE metric_name = ? AND source = 'backend' ORDER BY timestamp DESC LIMIT ?`,
        [metricName, count],
      );
      return rows.map((row) => safeNumber(row.value)).reverse();
    } catch (error) {
      console.error('SRE_METRICS_HISTORY_UNAVAILABLE', {
        message: error instanceof Error ? error.message : 'Erro não identificado',
      });
      return [];
    }
  }

  public async getSreStats(): Promise<SreStats> {
    const metrics = await this.getRuntimeMetrics();
    const [latencyHistory, trafficHistory, errorHistory, cpuHistory, memoryHistory] = await Promise.all([
      this.getMetricHistory('latency_ms'),
      this.getMetricHistory('requests_per_second'),
      this.getMetricHistory('error_rate_percent'),
      this.getMetricHistory('cpu_percent'),
      this.getMetricHistory('memory_percent'),
    ]);
    const saturationHistory = cpuHistory.length > 0 ? cpuHistory : memoryHistory;
    const latencyTrend = percentageChange(latencyHistory);
    const trafficTrend = percentageChange(trafficHistory);
    const errorTrend = percentageChange(errorHistory);
    const saturationTrend = percentageChange(saturationHistory);

    return {
      latency: {
        p99: metrics.latencyMs.toFixed(0), unit: 'ms', status: statusFor(metrics.latencyMs, 500, 1000),
        trend: latencyTrend.trend, trendValue: latencyTrend.value, history: latencyHistory,
      },
      traffic: {
        rps: metrics.requestsPerSecond.toFixed(2), unit: 'req/s', status: 'healthy',
        trend: trafficTrend.trend, trendValue: trafficTrend.value, history: trafficHistory,
      },
      errors: {
        rate: metrics.errorRatePercent.toFixed(3), unit: '%', status: statusFor(metrics.errorRatePercent, 0.1, 1),
        trend: errorTrend.trend, trendValue: errorTrend.value, history: errorHistory,
      },
      saturation: {
        cpu: metrics.cpuPercent.toFixed(1), memory: metrics.memoryPercent.toFixed(1), unit: '%',
        status: statusFor(Math.max(metrics.cpuPercent, metrics.memoryPercent), 80, 95),
        trend: saturationTrend.trend, trendValue: saturationTrend.value, history: saturationHistory,
      },
      // Uptime externo exige uma fonte verificável. Não fabricamos disponibilidade.
      availability: { 'Processo atual': { uptimeCurrent: Number((process.uptime() / 60).toFixed(2)), downtimeMinutes: 0, history: [] } },
      alerts: this.buildAlerts(metrics),
      externalServices: await this.getExternalServices(),
      releases: await this.getReleases(),
    };
  }

  private buildAlerts(metrics: MetricSnapshot): SreAlert[] {
    const alerts: SreAlert[] = [];
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (metrics.errorRatePercent >= 1) {
      alerts.push({ id: 'http-error-rate', severity: 'critical', service: 'API', message: `Taxa de respostas de erro: ${metrics.errorRatePercent.toFixed(2)}%.`, duration: 'amostra atual', time });
    }
    if (metrics.latencyMs >= 500) {
      alerts.push({ id: 'http-latency', severity: 'warning', service: 'API', message: `Latência P99 estimada: ${metrics.latencyMs.toFixed(0)} ms.`, duration: 'amostra atual', time });
    }
    if (Math.max(metrics.cpuPercent, metrics.memoryPercent) >= 80) {
      alerts.push({ id: 'runtime-saturation', severity: 'warning', service: 'Runtime', message: `Saturação de runtime: CPU ${metrics.cpuPercent.toFixed(1)}%, memória ${metrics.memoryPercent.toFixed(1)}%.`, duration: 'amostra atual', time });
    }
    return alerts;
  }

  private async getReleases(): Promise<Record<string, SreRelease[]>> {
    try {
      const [rows] = await connection.query<ReleaseRow[]>(
        'SELECT platform, repo, version, status, impact, applied_at FROM sre_releases ORDER BY applied_at DESC LIMIT 50',
      );
      return rows.reduce<Record<string, SreRelease[]>>((grouped, row) => {
        const key = `${row.platform}:${row.repo}`;
        const appliedAt = new Date(row.applied_at);
        const status = ['success', 'rollback', 'stable', 'failed', 'building'].includes(row.status)
          ? row.status as SreRelease['status']
          : 'stable';
        (grouped[key] ??= []).push({
          version: row.version,
          date: appliedAt.toLocaleDateString('pt-BR'),
          time: appliedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          status,
          impact: row.impact ?? '',
        });
        return grouped;
      }, {});
    } catch (error) {
      console.error('SRE_RELEASES_UNAVAILABLE', { message: error instanceof Error ? error.message : 'Erro não identificado' });
      return {};
    }
  }

  private async getExternalServices(): Promise<SreExternalService[]> {
    try {
      const [rows] = await connection.query<ExternalServiceRow[]>(
        'SELECT name, provider, status, latency, cost FROM sre_external_services ORDER BY name ASC',
      );
      return rows.map((row) => ({
        name: row.name, provider: row.provider, status: row.status,
        ...(row.latency ? { latency: row.latency } : {}), cost: safeNumber(row.cost),
      }));
    } catch (error) {
      console.error('SRE_EXTERNAL_SERVICES_UNAVAILABLE', { message: error instanceof Error ? error.message : 'Erro não identificado' });
      return [];
    }
  }

  public async updateExternalService(name: string, data: { cost?: number; status?: 'operational' | 'degraded' | 'outage' }): Promise<boolean> {
    const fields: string[] = [];
    const values: Array<number | string> = [];
    if (data.cost !== undefined) {
      if (!Number.isFinite(data.cost) || data.cost < 0) return false;
      fields.push('cost = ?'); values.push(data.cost);
    }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (fields.length === 0) return false;
    const [result] = await connection.query(
      `UPDATE sre_external_services SET ${fields.join(', ')} WHERE name = ?`, [...values, name],
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  public async updateRelease(platform: string, repo: string, data: { version?: string; status?: string; impact?: string; applied_at?: Date }): Promise<boolean> {
    const version = String(data.version ?? 'unknown').trim().slice(0, 50) || 'unknown';
    const status = String(data.status ?? 'success').trim().slice(0, 50) || 'success';
    const impact = String(data.impact ?? 'Webhook de deploy').trim().slice(0, 4000);
    const [existing] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM sre_releases WHERE platform = ? AND repo = ? AND version = ? LIMIT 1', [platform, repo, version],
    );
    if (existing.length > 0) {
      await connection.query(
        'UPDATE sre_releases SET status = ?, impact = ?, applied_at = ? WHERE id = ?',
        [status, impact, data.applied_at ?? new Date(), existing[0].id],
      );
      return true;
    }
    await connection.query(
      'INSERT INTO sre_releases (platform, repo, version, status, impact, applied_at) VALUES (?, ?, ?, ?, ?, ?)',
      [platform, repo, version, status, impact, data.applied_at ?? new Date()],
    );
    return true;
  }
}

const sreStatsService = new SreStatsService();
export function startSreStatsService(): void { sreStatsService.start(); }
export function stopSreStatsService(): void { sreStatsService.stop(); }
export async function loadSreStats(): Promise<SreStats> { return sreStatsService.getSreStats(); }
export function updateExternalService(name: string, data: { cost?: number; status?: 'operational' | 'degraded' | 'outage' }): Promise<boolean> {
  return sreStatsService.updateExternalService(name, data);
}
export function updateRelease(platform: string, repo: string, data: { version?: string; status?: string; impact?: string; applied_at?: Date }): Promise<boolean> {
  return sreStatsService.updateRelease(platform, repo, data);
}
