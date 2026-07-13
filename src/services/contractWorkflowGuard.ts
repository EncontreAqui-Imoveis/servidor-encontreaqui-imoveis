import type { ContractAccessContext } from '../types/contractAuth';

export type ContractParticipantMutation =
  | 'data_update'
  | 'document_upload'
  | 'document_delete';

export class ContractWorkflowGuardError extends Error {
  readonly statusCode = 403;
  readonly code = 'CONTRACT_READ_ONLY';

  constructor(readonly status: string, readonly action: ContractParticipantMutation) {
    super('Contrato em modo somente leitura nesta etapa do fluxo.');
  }
}

/**
 * This must be invoked after the caller has locked the contract row with FOR UPDATE.
 * Admin and explicit automated signature flows are operational exceptions and are
 * audited by their own services.
 */
export function assertParticipantMutationAllowed(
  contract: { status: string | null | undefined },
  context: ContractAccessContext,
  action: ContractParticipantMutation = 'data_update',
  options: { automatedSignatureFlow?: boolean } = {}
): void {
  if (context.userRole === 'admin' || options.automatedSignatureFlow) {
    return;
  }

  const status = String(contract.status ?? '').trim().toUpperCase();
  if (status !== 'AWAITING_DOCS') {
    throw new ContractWorkflowGuardError(status || 'UNKNOWN', action);
  }
}

export function isContractWorkflowGuardError(
  error: unknown
): error is ContractWorkflowGuardError {
  return error instanceof ContractWorkflowGuardError;
}
