import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { resolveOperationalRouteLabel } from '../utils/operationalRouteLabel';

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
    app: 'mais-imoveis-backend'
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
    registers: [register],
});

const httpResponsesTotal = new client.Counter({
    name: 'http_responses_total',
    help: 'Completed HTTP responses by route and status code',
    labelNames: ['method', 'route', 'code'],
    registers: [register],
});

const securityEventsTotal = new client.Counter({
    name: 'security_events_total',
    help: 'Security-relevant HTTP response events without personal data',
    labelNames: ['event', 'route', 'code'],
    registers: [register],
});

function securityEventForStatus(statusCode: number): string | null {
    if (statusCode === 401) return 'authentication_denied';
    if (statusCode === 403) return 'authorization_denied';
    if (statusCode === 429) return 'rate_limited';
    if (statusCode >= 500) return 'server_error';
    return null;
}

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const end = httpRequestDurationMicroseconds.startTimer();
    res.on('finish', () => {
        const route = resolveOperationalRouteLabel(req);
        end({ method: req.method, route, code: res.statusCode });
        httpResponsesTotal.inc({ method: req.method, route, code: res.statusCode });

        const securityEvent = securityEventForStatus(res.statusCode);
        if (securityEvent) {
            securityEventsTotal.inc({ event: securityEvent, route, code: res.statusCode });
        }
    });
    next();
};

export const getMetrics = async () => {
    return await register.metrics();
};

export const getRegistry = () => register;
