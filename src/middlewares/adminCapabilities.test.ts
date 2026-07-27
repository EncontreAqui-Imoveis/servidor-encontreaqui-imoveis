import { describe, expect, it, vi } from 'vitest';

import {
  forbidRestrictedAdminDocumentCreate,
  getAdminCapabilities,
  requireRestrictedAdminDocumentReplacement,
} from './adminCapabilities';
import type { AuthRequest } from './auth';

function responseStub() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function documentOperatorRequest(body: Record<string, unknown> = {}): AuthRequest {
  return {
    body,
    userRole: 'admin',
    adminValidated: true,
    adminRole: 'document_operator',
  } as AuthRequest;
}

describe('admin document operator capabilities', () => {
  it('only exposes document review and replacement capabilities', () => {
    expect(getAdminCapabilities('document_operator')).toEqual({
      canReviewDocuments: true,
      canReplaceDocuments: true,
      canCreateDocuments: false,
      canManageContractWorkflow: false,
      canDeleteDocuments: false,
      canDeleteEntities: false,
      canClearNotifications: false,
    });
  });

  it('rejects a new document upload from the restricted administrator', () => {
    const request = documentOperatorRequest();
    const response = responseStub();
    const next = vi.fn();

    forbidRestrictedAdminDocumentCreate(request, response as any, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ADMIN_DOCUMENT_CREATE_FORBIDDEN',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('requires an existing document id for a restricted replacement', () => {
    const response = responseStub();
    const next = vi.fn();

    requireRestrictedAdminDocumentReplacement(
      documentOperatorRequest({ replaceDocumentId: 'invalid' }),
      response as any,
      next
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a restricted replacement when an existing document id is provided', () => {
    const response = responseStub();
    const next = vi.fn();

    requireRestrictedAdminDocumentReplacement(
      documentOperatorRequest({ replaceDocumentId: '42' }),
      response as any,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});
