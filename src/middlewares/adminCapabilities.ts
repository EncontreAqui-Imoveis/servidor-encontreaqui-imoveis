import type { NextFunction, Response } from 'express';

import type { AuthRequest } from './auth';

export type AdminPanelRole = 'admin' | 'document_operator' | 'operational_assistant';
export type AdminCapability =
  | 'review_documents'
  | 'replace_documents'
  | 'manage_contract_workflow'
  | 'manage_administration'
  | 'delete';

const ROLE_CAPABILITIES: Record<AdminPanelRole, ReadonlySet<AdminCapability>> = {
  admin: new Set([
    'review_documents',
    'replace_documents',
    'manage_contract_workflow',
    'manage_administration',
    'delete',
  ]),
  // Operador documental pode revisar e substituir; exclusoes manuais continuam
  // reservadas ao administrador titular.
  document_operator: new Set(['review_documents', 'replace_documents']),
  // Auxiliar operacional pode gerenciar o fluxo de contratos e revisar/substituir
  // documentos, mas nao tem acesso a operacoes administrativas nem a exclusao de dados.
  operational_assistant: new Set([
    'review_documents',
    'replace_documents',
    'manage_contract_workflow',
  ]),
};

export function normalizeAdminPanelRole(value: unknown): AdminPanelRole {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'document_operator') return 'document_operator';
  if (normalized === 'operational_assistant') return 'operational_assistant';
  return 'admin';
}

export function hasAdminCapability(
  role: AdminPanelRole | undefined,
  capability: AdminCapability
): boolean {
  return ROLE_CAPABILITIES[role ?? 'admin'].has(capability);
}

export function getAdminCapabilities(role: AdminPanelRole | undefined) {
  return {
    canReviewDocuments: hasAdminCapability(role, 'review_documents'),
    canReplaceDocuments: hasAdminCapability(role, 'replace_documents'),
    canCreateDocuments: hasAdminCapability(role, 'manage_contract_workflow'),
    canManageContractWorkflow: hasAdminCapability(role, 'manage_contract_workflow'),
    canManageAdministration: hasAdminCapability(role, 'manage_administration'),
    canDeleteDocuments: hasAdminCapability(role, 'delete'),
    canDeleteEntities: hasAdminCapability(role, 'delete'),
    canClearNotifications: hasAdminCapability(role, 'delete'),
  } as const;
}

export function requireAdminCapability(capability: AdminCapability) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.userRole !== 'admin' || req.adminValidated !== true) {
      return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
    }

    if (!hasAdminCapability(req.adminRole, capability)) {
      return res.status(403).json({
        error: capability === 'delete'
          ? 'Sua conta administrativa não possui permissão para excluir dados.'
          : capability === 'manage_contract_workflow'
            ? 'Sua conta administrativa não possui permissão para alterar o fluxo do contrato.'
            : capability === 'manage_administration'
              ? 'Sua conta administrativa não possui permissão para esta operação administrativa.'
            : 'Sua conta administrativa não possui permissão para esta ação documental.',
        code: 'ADMIN_CAPABILITY_DENIED',
      });
    }

    return next();
  };
}

/** O multer deve executar antes deste middleware para disponibilizar o multipart. */
export function requireRestrictedAdminDocumentReplacement(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (
    req.userRole === 'admin' &&
    req.adminValidated === true &&
    req.adminRole === 'document_operator'
  ) {
    const rawDocumentId = req.body?.replaceDocumentId ?? req.body?.replace_document_id;
    const documentId = Number(rawDocumentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return res.status(403).json({
        error: 'A conta administrativa documental só pode substituir um documento existente.',
        code: 'ADMIN_DOCUMENT_CREATE_FORBIDDEN',
      });
    }
  }
  return next();
}

export function forbidRestrictedAdminDocumentCreate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (
    req.userRole === 'admin' &&
    req.adminValidated === true &&
    req.adminRole === 'document_operator'
  ) {
    return res.status(403).json({
      error: 'A conta administrativa documental só pode substituir documentos existentes.',
      code: 'ADMIN_DOCUMENT_CREATE_FORBIDDEN',
    });
  }
  return next();
}

// Rotas de contrato tambem sao acessiveis por participantes. Para eles nada muda;
// a restricao adicional so se aplica ao administrador documental.
export function restrictAdminManualDeletion(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (
    req.userRole === 'admin' &&
    req.adminValidated === true &&
    !hasAdminCapability(req.adminRole, 'delete')
  ) {
    return res.status(403).json({
      error: 'A conta administrativa documental não pode excluir arquivos manualmente.',
      code: 'ADMIN_MANUAL_DELETE_FORBIDDEN',
    });
  }
  return next();
}
