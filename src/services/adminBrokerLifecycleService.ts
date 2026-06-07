import { RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';
import { uploadToCloudinary, deleteCloudinaryAsset } from '../config/cloudinary';
import { notifyAdmins } from './notificationService';
import { notifyUsers, resolveUserNotificationRole } from './userNotificationService';
import {
  ApplicationError,
  ConflictError,
  InternalError,
  InvalidInputError,
  NotFoundError,
} from '../errors/ApplicationError';
import {
  approveBrokerAccount,
  isActiveBrokerStatus,
  loadUserLifecycleSnapshot,
  rejectBrokerAccount,
} from './adminAccountLifecycleService';
import { hasValidCreci, normalizeCreci } from './adminControllerSupport';

type BrokerStatus = 'pending_verification' | 'approved' | 'rejected';

type BrokerMutationResponse = {
  message: string;
  status?: string;
  role?: 'broker' | 'client';
  creci?: string;
};

type BrokerDocumentFiles = {
  [fieldname: string]: Express.Multer.File[];
};

type BrokerDocumentDeleteType = 'creciFront' | 'creciBack' | 'selfie';

function normalizeDocumentValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function updateBrokerRecordWithLegacyUpdatedAtFallback(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  brokerId: number,
  status: string,
): Promise<void> {
  try {
    await db.query('UPDATE brokers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      status,
      brokerId,
    ]);
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
    if (code !== 'ER_BAD_FIELD_ERROR' || !message.includes("unknown column 'updated_at'")) {
      throw error;
    }
    await db.query('UPDATE brokers SET status = ? WHERE id = ?', [status, brokerId]);
  }
}

async function promoteBrokerRecordWithLegacyUpdatedAtFallback(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  brokerId: number,
  creci: string,
): Promise<void> {
  try {
    await db.query(
      `UPDATE brokers SET creci = ?, status = 'approved', agency_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [creci, brokerId],
    );
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
    if (code !== 'ER_BAD_FIELD_ERROR' || !message.includes("unknown column 'updated_at'")) {
      throw error;
    }
    await db.query(
      `UPDATE brokers SET creci = ?, status = 'approved', agency_id = NULL
       WHERE id = ?`,
      [creci, brokerId],
    );
  }
}

async function notifyBrokerApprovedChange(brokerId: number): Promise<void> {
  try {
    await notifyAdmins(`Corretor #${brokerId} aprovado pelo admin.`, 'broker', brokerId);
  } catch (notifyError) {
    console.error('Erro ao notificar admins sobre aprovacao de corretor:', notifyError);
  }

  try {
    const role = await resolveUserNotificationRole(brokerId);
    if (role === 'broker') {
      await notifyUsers({
        message: 'Parabens, voce se tornou corretor cadastrado na Encontre Aqui.',
        recipientIds: [brokerId],
        recipientRole: 'broker',
        relatedEntityType: 'broker',
        relatedEntityId: brokerId,
      });
    }
  } catch (notifyError) {
    console.error('Erro ao notificar corretor aprovado:', notifyError);
  }
}

async function notifyBrokerRejectedChange(brokerId: number): Promise<void> {
  try {
    await notifyAdmins(`Corretor #${brokerId} rejeitado pelo admin.`, 'broker', brokerId);
  } catch (notifyError) {
    console.error('Erro ao notificar admins sobre rejeicao de corretor:', notifyError);
  }

  try {
    await notifyUsers({
      message: 'Sua solicitacao para se tornar corretor foi rejeitada. Sua conta voltou para cliente.',
      recipientIds: [brokerId],
      recipientRole: 'client',
      relatedEntityType: 'broker',
      relatedEntityId: brokerId,
    });
  } catch (notifyError) {
    console.error('Erro ao notificar rejeicao de corretor:', notifyError);
  }
}

async function getBrokerDocumentRow(brokerId: number) {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    'SELECT creci_front_url, creci_back_url, selfie_url FROM broker_documents WHERE broker_id = ?',
    [brokerId],
  );
  return rows[0] ?? null;
}

export async function promoteClientToBroker(
  clientId: number,
  creci: unknown,
): Promise<BrokerMutationResponse> {
  if (Number.isNaN(clientId) || clientId <= 0) {
    throw new InvalidInputError('Identificador de cliente invalido.');
  }
  if (creci == null || String(creci).trim() === '') {
    throw new InvalidInputError('CRECI e obrigatorio.');
  }
  if (!hasValidCreci(creci)) {
    throw new InvalidInputError('CRECI inválido. Use 4 a 8 números com sufixo opcional (ex: 12345678-A).');
  }

  const normalizedCreci = normalizeCreci(creci);
  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const [dupCreci] = await tx.query<RowDataPacket[]>(
      'SELECT id FROM brokers WHERE creci = ? AND id <> ? LIMIT 1',
      [normalizedCreci, clientId],
    );
    if (dupCreci.length > 0) {
      await tx.rollback();
      throw new ConflictError('CRECI ja vinculado a outro corretor.');
    }

    const snapshot = await loadUserLifecycleSnapshot(tx, clientId, { forUpdate: true });
    if (!snapshot) {
      await tx.rollback();
      throw new NotFoundError('Usuario nao encontrado.');
    }

    if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
      await tx.rollback();
      throw new InvalidInputError('Usuario ja e corretor ativo. Use a gestao de corretores.');
    }

    if (snapshot.broker_id != null) {
      await promoteBrokerRecordWithLegacyUpdatedAtFallback(tx, clientId, normalizedCreci);
    } else {
      await tx.query(
        `INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, 'approved', NULL)`,
        [clientId, normalizedCreci],
      );
    }

    await tx.commit();
    await notifyBrokerApprovedChange(clientId);
    return {
      message: 'Usuario promovido a corretor com sucesso.',
      role: 'broker',
      status: 'approved',
      creci: normalizedCreci,
    };
  } catch (error) {
    await tx.rollback();
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw new InternalError('Erro interno do servidor.');
  } finally {
    tx.release();
  }
}

async function applyBrokerStatus(
  brokerId: number,
  normalizedStatus: BrokerStatus,
): Promise<BrokerMutationResponse> {
  const tx = await adminDb.getConnection();
  let committed = false;
  let role: 'broker' | 'client' = 'client';
  try {
    await tx.beginTransaction();

    const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
    if (!snapshot || snapshot.broker_id == null) {
      await tx.rollback();
      throw new NotFoundError('Corretor nao encontrado.');
    }

    role = isActiveBrokerStatus(snapshot.broker_status) ? 'broker' : 'client';

    if (normalizedStatus === 'approved') {
      const result = await approveBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        throw new NotFoundError('Corretor nao encontrado.');
      }
      role = 'broker';
    } else if (normalizedStatus === 'rejected') {
      const result = await rejectBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        throw new NotFoundError('Corretor nao encontrado.');
      }
      role = 'client';
    } else {
      await updateBrokerRecordWithLegacyUpdatedAtFallback(tx, brokerId, normalizedStatus);
      role = 'broker';
    }

    await tx.commit();
    committed = true;

    if (normalizedStatus === 'approved') {
      await notifyBrokerApprovedChange(brokerId);
    } else if (normalizedStatus === 'rejected') {
      await notifyBrokerRejectedChange(brokerId);
    } else {
      try {
        await notifyAdmins(
          `Status do corretor #${brokerId} atualizado para ${normalizedStatus}.`,
          'broker',
          brokerId,
        );
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre status do corretor:', notifyError);
      }
    }

    return {
      message: 'Status do corretor atualizado com sucesso.',
      status: normalizedStatus,
      role,
    };
  } catch (error) {
    if (!committed) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        console.error('Erro ao reverter transação (status corretor):', rollbackError);
      }
    }
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw new InternalError('Erro interno do servidor.');
  } finally {
    tx.release();
  }
}

export async function approveBroker(brokerId: number): Promise<BrokerMutationResponse> {
  const result = await applyBrokerStatus(brokerId, 'approved');
  return {
    ...result,
    message: 'Corretor aprovado com sucesso.',
  };
}

export async function rejectBroker(brokerId: number): Promise<BrokerMutationResponse> {
  const result = await applyBrokerStatus(brokerId, 'rejected');
  return {
    ...result,
    message: 'Corretor rejeitado com sucesso.',
  };
}

export async function cleanupBroker(brokerId: number): Promise<BrokerMutationResponse> {
  const result = await applyBrokerStatus(brokerId, 'rejected');
  return {
    ...result,
    message: 'Corretor rebaixado para cliente com sucesso.',
  };
}

export async function updateBrokerStatus(
  brokerId: number,
  status: unknown,
): Promise<BrokerMutationResponse> {
  if (Number.isNaN(brokerId)) {
    throw new InvalidInputError('Identificador de corretor inválido.');
  }

  if (typeof status !== 'string') {
    throw new InvalidInputError('Status inválido.');
  }

  const normalizedStatus = status.trim() as BrokerStatus;
  const allowedStatuses = new Set<BrokerStatus>(['pending_verification', 'approved', 'rejected']);
  if (!allowedStatuses.has(normalizedStatus)) {
    throw new InvalidInputError('Status de corretor não suportado.');
  }

  if (normalizedStatus === 'approved') {
    return approveBroker(brokerId);
  }
  if (normalizedStatus === 'rejected') {
    return rejectBroker(brokerId);
  }
  return applyBrokerStatus(brokerId, normalizedStatus);
}

export async function uploadBrokerDocuments(
  brokerId: number,
  files: BrokerDocumentFiles | undefined,
): Promise<BrokerMutationResponse> {
  if (Number.isNaN(brokerId)) {
    throw new InvalidInputError('Identificador de corretor inválido.');
  }
  if (!files || Object.keys(files).length === 0) {
    throw new InvalidInputError('Nenhum documento enviado.');
  }

  const fileFieldToColumnMap = {
    creciFront: 'creci_front_url',
    creciBack: 'creci_back_url',
    selfie: 'selfie_url',
  } as const;

  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();

    const [broker] = await db.query<RowDataPacket[]>('SELECT id FROM brokers WHERE id = ?', [brokerId]);
    if (broker.length === 0) {
      await db.rollback();
      throw new NotFoundError('Corretor não encontrado.');
    }

    const uploadTasks = Object.entries(fileFieldToColumnMap).filter((entry) => !!files[entry[0]]);
    if (uploadTasks.length === 0) {
      await db.rollback();
      throw new InvalidInputError('Nenhum documento válido enviado.');
    }

    const toUpload: { [field: string]: string } = {};
    for (const [fileField, column] of uploadTasks) {
      const fileList = files[fileField];
      if (!fileList || fileList.length === 0 || !fileList[0]) {
        continue;
      }
      const result = await uploadToCloudinary(fileList[0], 'brokers/documents');
      toUpload[column] = result.url;
    }

    if (Object.keys(toUpload).length === 0) {
      await db.rollback();
      throw new InvalidInputError('Nenhum documento válido enviado.');
    }

    const existingDocRow = await getBrokerDocumentRow(brokerId);
    const creciFrontUrl = toUpload.creci_front_url ?? normalizeDocumentValue(existingDocRow?.creci_front_url);
    const creciBackUrl = toUpload.creci_back_url ?? normalizeDocumentValue(existingDocRow?.creci_back_url);
    const selfieUrl = toUpload.selfie_url ?? normalizeDocumentValue(existingDocRow?.selfie_url);

    await db.query(
      `INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         creci_front_url = VALUES(creci_front_url),
         creci_back_url = VALUES(creci_back_url),
         selfie_url = VALUES(selfie_url),
         status = 'pending',
         updated_at = CURRENT_TIMESTAMP`,
      [brokerId, creciFrontUrl, creciBackUrl, selfieUrl],
    );

    await db.commit();
    return { message: 'Documentos atualizados com sucesso.' };
  } catch (error) {
    await db.rollback();
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw new InternalError('Erro interno do servidor.');
  } finally {
    db.release();
  }
}

export async function deleteBrokerDocument(
  brokerId: number,
  docType: BrokerDocumentDeleteType,
): Promise<BrokerMutationResponse> {
  if (Number.isNaN(brokerId)) {
    throw new InvalidInputError('Identificador de corretor inválido.');
  }

  const allowedDocTypes: BrokerDocumentDeleteType[] = ['creciFront', 'creciBack', 'selfie'];
  if (!docType || !allowedDocTypes.includes(docType)) {
    throw new InvalidInputError('Tipo de documento inválido.');
  }

  const columnMap: Record<BrokerDocumentDeleteType, string> = {
    creciFront: 'creci_front_url',
    creciBack: 'creci_back_url',
    selfie: 'selfie_url',
  };
  const column = columnMap[docType];

  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();

    const [docs] = await db.query<RowDataPacket[]>(
      `SELECT ${column} FROM broker_documents WHERE broker_id = ?`,
      [brokerId],
    );

    if (docs.length > 0 && docs[0][column]) {
      const url = String(docs[0][column] ?? '').trim();
      if (url) {
        await deleteCloudinaryAsset({ url, invalidate: true });
      }

      await db.query(
        `UPDATE broker_documents SET ${column} = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE broker_id = ?`,
        ['' , brokerId],
      );
    }

    await db.commit();
    return { message: 'Documento removido com sucesso.' };
  } catch (error) {
    await db.rollback();
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw new InternalError('Erro interno do servidor.');
  } finally {
    db.release();
  }
}
