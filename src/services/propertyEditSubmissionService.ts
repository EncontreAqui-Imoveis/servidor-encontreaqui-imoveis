import { ResultSetHeader, RowDataPacket } from 'mysql2';

import AuthRequest from '../middlewares/auth';
import { notifyAdmins } from './notificationService';
import { getPropertyDbConnection } from './propertyPersistenceService';
import {
  buildEditablePropertyState,
  preparePropertyEditPatch,
  type PropertyEditRequestRequesterRole,
} from './propertyEditRequestService';

type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';

type PropertyRow = RowDataPacket & {
  id: number;
  broker_id: number | null;
  owner_id: number | null;
  title: string;
  status: PropertyStatus;
};

type PropertyEditRequestRow = RowDataPacket & {
  id: number;
  status: string;
};

const PROPERTY_ERROR_CODES = {
  INVALID_FIELD: 'PROPERTY_INVALID_FIELD',
  NO_UPDATE_DATA: 'PROPERTY_NO_UPDATE_DATA',
  PENDING_EDIT_BLOCKED: 'PROPERTY_PENDING_EDIT_REQUEST',
  UNAUTHORIZED: 'PROPERTY_ACCESS_DENIED',
} as const;

function sendPropertyError(
  res: import('express').Response,
  statusCode: number,
  params: { error: string; code: (typeof PROPERTY_ERROR_CODES)[keyof typeof PROPERTY_ERROR_CODES]; field?: string }
): import('express').Response {
  return res.status(statusCode).json({
    error: params.error,
    code: params.code,
    ...(params.field ? { field: params.field } : {}),
  });
}

function resolveEditRequesterRole(req: AuthRequest): PropertyEditRequestRequesterRole {
  return String(req.userRole ?? '').toLowerCase() === 'broker' ? 'broker' : 'client';
}

export async function submitPropertyEditRequest(req: AuthRequest, res: import('express').Response) {
  const propertyId = Number(req.params.id);
  const userId = req.userId;

  if (!userId) {
    return sendPropertyError(res, 401, {
      error: 'Usuario nao autenticado.',
      code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
    });
  }

  if (Number.isNaN(propertyId)) {
    return sendPropertyError(res, 400, {
      error: 'Identificador de imóvel invalido.',
      code: PROPERTY_ERROR_CODES.INVALID_FIELD,
      field: 'id',
    });
  }

  const payload = (req.body ?? {}) as Record<string, unknown>;
  const db = await getPropertyDbConnection();

  try {
    await db.beginTransaction();

    const [propertyRows] = await db.query<PropertyRow[]>(
      'SELECT * FROM properties WHERE id = ? LIMIT 1 FOR UPDATE',
      [propertyId]
    );

    if (!propertyRows || propertyRows.length === 0) {
      await db.rollback();
      return sendPropertyError(res, 404, {
        error: 'Imóvel nao encontrado.',
        code: PROPERTY_ERROR_CODES.INVALID_FIELD,
        field: 'id',
      });
    }

    const property = propertyRows[0];
    const isOwner =
      (property.broker_id != null && property.broker_id === userId) ||
      (property.owner_id != null && property.owner_id === userId);

    if (!isOwner) {
      await db.rollback();
      return sendPropertyError(res, 403, {
        error: 'Acesso nao autorizado a este imovel.',
        code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
        field: 'userId',
      });
    }

    if (property.status === 'pending_approval') {
      await db.rollback();
      return sendPropertyError(res, 409, {
        error: 'Imóveis pendentes não podem solicitar edição até o fim da análise.',
        code: PROPERTY_ERROR_CODES.PENDING_EDIT_BLOCKED,
      });
    }

    const [pendingRows] = await db.query<PropertyEditRequestRow[]>(
      `
          SELECT id, status
          FROM property_edit_requests
          WHERE property_id = ? AND status = 'PENDING'
          LIMIT 1
          FOR UPDATE
        `,
      [propertyId]
    );

    if (pendingRows.length > 0) {
      await db.rollback();
      return sendPropertyError(res, 409, {
        error: 'Este imóvel já possui uma solicitação de edição pendente.',
        code: PROPERTY_ERROR_CODES.PENDING_EDIT_BLOCKED,
      });
    }

    const currentState = buildEditablePropertyState(property as Record<string, unknown>);
    const preparedPatch = preparePropertyEditPatch(payload, currentState);

    if (Object.keys(preparedPatch.diff).length === 0) {
      await db.rollback();
      return sendPropertyError(res, 400, {
        error: 'Nenhuma alteração válida foi identificada para enviar à aprovação.',
        code: PROPERTY_ERROR_CODES.NO_UPDATE_DATA,
      });
    }

    const requesterRole = resolveEditRequesterRole(req);

    const [insertResult] = await db.query<ResultSetHeader>(
      `
          INSERT INTO property_edit_requests (
            property_id,
            requester_user_id,
            requester_role,
            status,
            before_json,
            after_json,
            diff_json,
            review_reason,
            reviewed_by,
            reviewed_at
          ) VALUES (
            ?,
            ?,
            ?,
            'PENDING',
            CAST(? AS JSON),
            CAST(? AS JSON),
            CAST(? AS JSON),
            NULL,
            NULL,
            NULL
          )
        `,
      [
        propertyId,
        userId,
        requesterRole,
        JSON.stringify(preparedPatch.before),
        JSON.stringify(preparedPatch.after),
        JSON.stringify(preparedPatch.diff),
      ]
    );

    if (property.status === 'rejected') {
      await db.query(
        `UPDATE properties SET
            status = 'pending_approval',
            rejection_reason = NULL,
            visibility = 'HIDDEN',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [propertyId]
      );
    }

    await db.commit();

    try {
      await notifyAdmins(
        `Nova solicitacao de edicao do imovel '${property.title}'.`,
        'property',
        propertyId
      );
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre solicitacao de edicao:', notifyError);
    }

    return res.status(202).json({
      message: 'Solicitação de edição enviada para aprovação.',
      requestId: insertResult.insertId,
      ...(property.status === 'rejected' ? { status: 'pending_approval' as const } : {}),
    });
  } catch (error) {
    await db.rollback();
    const message = error instanceof Error ? error.message : '';
    if (message) {
      return sendPropertyError(res, 400, {
        error: message,
        code: PROPERTY_ERROR_CODES.INVALID_FIELD,
      });
    }
    console.error('Erro ao criar solicitacao de edicao do imovel:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    db.release();
  }
}
