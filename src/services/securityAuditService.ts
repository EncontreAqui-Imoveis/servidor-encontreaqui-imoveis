import type { Request, Response } from 'express';

import connection from '../database/connection';
import { resolveOperationalRouteLabel } from '../utils/operationalRouteLabel';

export type SecurityAuditSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export type SecurityAuditEvent = {
  eventType: string;
  severity: SecurityAuditSeverity;
  requestId: string | null;
  actorRole: string;
  method: string;
  route: string;
  statusCode: number;
};

type AuditedRequest = Request & {
  requestId?: string;
  userRole?: string;
  adminRole?: string;
};

let writeFailureReported = false;

function normalizeRole(value: unknown): string {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return 'anonymous';
  if (role === 'admin' || role === 'document_operator') return role;
  if (role === 'broker' || role === 'client' || role === 'user') return role;
  return 'authenticated';
}

function normalizeRequestId(value: unknown): string | null {
  const requestId = String(value ?? '').trim();
  return /^[0-9a-f-]{8,64}$/i.test(requestId) ? requestId.slice(0, 64) : null;
}

function isLoginRoute(route: string): boolean {
  return ['/auth/login', '/user/login', '/broker/login', '/admin/login'].includes(route);
}

function eventForSuccessfulRequest(method: string, route: string): Pick<SecurityAuditEvent, 'eventType' | 'severity'> | null {
  if (isLoginRoute(route)) return { eventType: 'AUTH_LOGIN_SUCCEEDED', severity: 'INFO' };
  if (route.includes('/download') || route.endsWith('/documents.zip')) {
    return { eventType: 'DOCUMENT_DOWNLOADED', severity: 'INFO' };
  }
  if (method === 'DELETE') return { eventType: 'RESOURCE_DELETED', severity: 'WARNING' };
  if (route.includes('/documents/:documentId/status') || route.includes('/documents/:documentId/review')) {
    return { eventType: 'DOCUMENT_REVIEWED', severity: 'INFO' };
  }
  if (route.includes('/evaluate-side') || route.includes('/evaluate-category')) {
    return { eventType: 'CONTRACT_REVIEWED', severity: 'INFO' };
  }
  if (
    route.includes('/transition') ||
    route.includes('/finalize') ||
    route.includes('/reopen') ||
    route.includes('/generate-draft') ||
    route.endsWith('/draft')
  ) {
    return { eventType: 'WORKFLOW_TRANSITIONED', severity: 'WARNING' };
  }
  if (method === 'POST' && route.endsWith('/documents')) {
    return { eventType: 'DOCUMENT_UPLOADED', severity: 'INFO' };
  }
  if (method === 'PUT' && route.endsWith('/data')) {
    return { eventType: 'CONTRACT_DATA_UPDATED', severity: 'INFO' };
  }
  if (route.includes('/webhook/')) return { eventType: 'WEBHOOK_ACCEPTED', severity: 'INFO' };
  return null;
}

/**
 * Maps only transport metadata into an audit event. It intentionally cannot
 * receive request bodies, query strings, entity IDs or user identifiers.
 */
export function buildSecurityAuditEvent(req: AuditedRequest, res: Pick<Response, 'statusCode'>): SecurityAuditEvent | null {
  const route = resolveOperationalRouteLabel(req);
  const method = String(req.method ?? 'GET').toUpperCase().slice(0, 12);
  const statusCode = Number(res.statusCode ?? 0);

  const event = statusCode === 401
    ? { eventType: isLoginRoute(route) ? 'AUTH_LOGIN_DENIED' : 'AUTHENTICATION_DENIED', severity: 'WARNING' as const }
    : statusCode === 403
      ? { eventType: 'AUTHORIZATION_DENIED', severity: 'WARNING' as const }
      : statusCode === 429
        ? { eventType: 'RATE_LIMITED', severity: 'WARNING' as const }
        : statusCode >= 500
          ? { eventType: 'SERVER_ERROR', severity: 'HIGH' as const }
          : statusCode >= 200 && statusCode < 400
            ? eventForSuccessfulRequest(method, route)
            : null;

  if (!event) return null;

  return {
    ...event,
    requestId: normalizeRequestId(req.requestId),
    actorRole: normalizeRole(req.adminRole ?? req.userRole),
    method,
    route,
    statusCode,
  };
}

export async function recordSecurityAuditEvent(event: SecurityAuditEvent): Promise<void> {
  try {
    await connection.query(
      `
        INSERT INTO security_audit_events (
          event_type, severity, request_id, actor_role, http_method, route, status_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        event.eventType,
        event.severity,
        event.requestId,
        event.actorRole,
        event.method,
        event.route,
        event.statusCode,
      ],
    );
    writeFailureReported = false;
  } catch (error) {
    // Auditing must never change the HTTP result. One bounded log protects
    // observability without creating an error storm if the table is unavailable.
    if (!writeFailureReported) {
      writeFailureReported = true;
      console.error('SECURITY_AUDIT_PERSISTENCE_FAILED', {
        message: error instanceof Error ? error.message : 'Erro não identificado',
      });
    }
  }
}
