import { RowDataPacket } from 'mysql2';
import {
  ApplicationError,
  ConflictError,
  InternalError,
  InvalidInputError,
  NotFoundError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import {
  approveBrokerAccount,
  deleteUserAccount,
  isActiveBrokerStatus,
  loadUserLifecycleSnapshot,
  rejectBrokerAccount,
} from './adminAccountLifecycleService';
import { notifyAdmins } from './notificationService';
import { notifyUsers, resolveUserNotificationRole } from './userNotificationService';
import { hasValidCreci, normalizeCreci, sanitizePartialAddressInput } from './adminControllerSupport';

type BrokerStatus = 'pending_verification' | 'approved' | 'rejected';

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function isValidEmail(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function hasValidPhone(value: unknown): boolean {
  const length = normalizePhone(value).length;
  return length >= 10 && length <= 13;
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

function normalizeBrokerStatus(value: unknown): BrokerStatus | undefined {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'pending_verification' || normalized === 'approved' || normalized === 'rejected') {
    return normalized;
  }
  return undefined;
}

export async function updateBrokerAccount(params: {
  brokerId: number;
  body: Record<string, unknown>;
}): Promise<{
  message: string;
  status: string;
  role: 'broker' | 'client';
}> {
  const { brokerId, body } = params;
  const {
    name,
    email,
    phone,
    creci,
    status,
    agencyId,
    agency_id,
    street,
    number,
    complement,
    bairro,
    city,
    state,
    cep,
  } = body ?? {};
  const resolvedAgencyId = agencyId ?? agency_id;

  if (Number.isNaN(brokerId)) {
    throw new InvalidInputError('Identificador de corretor invalido.');
  }

  const normalizedStatus = normalizeBrokerStatus(status);
  if (status !== undefined && normalizedStatus === undefined) {
    throw new InvalidInputError('Status de corretor inválido.');
  }

  const partialAddressInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    street,
    number,
    complement,
    bairro,
    city,
    state,
    cep,
  })) {
    if (value !== undefined) {
      partialAddressInput[key] = value;
    }
  }

  const addressResult =
    Object.keys(partialAddressInput).length > 0
      ? sanitizePartialAddressInput(partialAddressInput)
      : null;
  if (addressResult && !addressResult.ok) {
    throw new InvalidInputError('Endereco incompleto ou invalido.', {
      fields: addressResult.errors,
    });
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
    if (!snapshot || snapshot.broker_id == null) {
      await tx.rollback();
      throw new NotFoundError('Corretor nao encontrado.');
    }

    const userSetParts: string[] = [];
    const userParams: unknown[] = [];

    if (name !== undefined) {
      const normalizedName = stringOrNull(name);
      if (!normalizedName || normalizedName.length > 120) {
        await tx.rollback();
        throw new InvalidInputError('Nome inválido.');
      }
      userSetParts.push('name = ?');
      userParams.push(normalizedName);
    }

    if (email !== undefined) {
      const normalizedEmail = stringOrNull(email)?.toLowerCase() ?? null;
      if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        await tx.rollback();
        throw new InvalidInputError('Email inválido.');
      }
      const [duplicateRows] = await tx.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
        [normalizedEmail, brokerId],
      );
      if (duplicateRows.length > 0) {
        await tx.rollback();
        throw new ConflictError('Email ja cadastrado.');
      }
      userSetParts.push('email = ?');
      userParams.push(normalizedEmail);
    }

    if (phone !== undefined) {
      if (!hasValidPhone(phone)) {
        await tx.rollback();
        throw new InvalidInputError('Telefone inválido. Use entre 10 e 13 dígitos com DDD.');
      }
      userSetParts.push('phone = ?');
      userParams.push(normalizePhone(phone));
    }

    if (addressResult?.ok) {
      for (const [key, value] of Object.entries(addressResult.value)) {
        userSetParts.push(`${key} = ?`);
        userParams.push(value);
      }
    }

    if (userSetParts.length > 0) {
      userParams.push(brokerId);
      await tx.query(`UPDATE users SET ${userSetParts.join(', ')} WHERE id = ?`, userParams);
    }

    const brokerSetParts: string[] = [];
    const brokerParams: unknown[] = [];

    if (creci !== undefined) {
      const normalizedCreciValue = normalizeCreci(creci);
      if (!normalizedCreciValue || !hasValidCreci(normalizedCreciValue)) {
        await tx.rollback();
        throw new InvalidInputError('CRECI inválido.');
      }
      const [duplicateBrokerRows] = await tx.query<RowDataPacket[]>(
        'SELECT id FROM brokers WHERE creci = ? AND id <> ? LIMIT 1',
        [normalizedCreciValue, brokerId],
      );
      if (duplicateBrokerRows.length > 0) {
        await tx.rollback();
        throw new ConflictError('CRECI ja cadastrado.');
      }
      brokerSetParts.push('creci = ?');
      brokerParams.push(normalizedCreciValue);
    }

    if (resolvedAgencyId !== undefined) {
      const agencyValue =
        resolvedAgencyId === null ||
        resolvedAgencyId === '' ||
        resolvedAgencyId === 0 ||
        resolvedAgencyId === '0'
          ? null
          : Number(resolvedAgencyId);
      if (agencyValue !== null && (!Number.isFinite(agencyValue) || agencyValue <= 0)) {
        await tx.rollback();
        throw new InvalidInputError('Agencia inválida.');
      }
      brokerSetParts.push('agency_id = ?');
      brokerParams.push(agencyValue);
    }

    if (normalizedStatus === 'pending_verification') {
      brokerSetParts.push('status = ?');
      brokerParams.push(normalizedStatus);
    }

    if (brokerSetParts.length > 0) {
      brokerParams.push(brokerId);
      await tx.query(`UPDATE brokers SET ${brokerSetParts.join(', ')} WHERE id = ?`, brokerParams);
    }

    let finalRole: 'broker' | 'client' = isActiveBrokerStatus(snapshot.broker_status) ? 'broker' : 'client';
    let finalStatus = snapshot.broker_status ?? 'rejected';

    if (normalizedStatus === 'approved') {
      const result = await approveBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        throw new NotFoundError('Corretor nao encontrado.');
      }
      finalRole = 'broker';
      finalStatus = 'approved';
    } else if (normalizedStatus === 'rejected') {
      const result = await rejectBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        throw new NotFoundError('Corretor nao encontrado.');
      }
      finalRole = 'client';
      finalStatus = 'rejected';
    } else if (normalizedStatus === 'pending_verification') {
      finalRole = 'broker';
      finalStatus = 'pending_verification';
    } else if (brokerSetParts.length > 0 || userSetParts.length > 0) {
      const refreshed = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
      finalRole = refreshed && isActiveBrokerStatus(refreshed.broker_status) ? 'broker' : 'client';
      finalStatus = refreshed?.broker_status ?? finalStatus;
    }

    await tx.commit();

    if (normalizedStatus === 'approved') {
      await notifyBrokerApprovedChange(brokerId);
    } else if (normalizedStatus === 'rejected') {
      await notifyBrokerRejectedChange(brokerId);
    }

    return {
      message: 'Corretor atualizado com sucesso.',
      status: finalStatus,
      role: finalRole,
    };
  } catch (error) {
    await tx.rollback();
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao atualizar corretor:', error);
    throw new InternalError('Erro interno do servidor.');
  } finally {
    tx.release();
  }
}

export async function updateClientAccount(params: {
  clientId: number;
  body: Record<string, unknown>;
}): Promise<{
  message: string;
  role: 'client';
}> {
  const { clientId, body } = params;
  const { name, email, phone, street, number, complement, bairro, city, state, cep } = body ?? {};

  if (Number.isNaN(clientId)) {
    throw new InvalidInputError('Identificador de cliente invalido.');
  }

  const partialAddressInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    street,
    number,
    complement,
    bairro,
    city,
    state,
    cep,
  })) {
    if (value !== undefined) {
      partialAddressInput[key] = value;
    }
  }

  const addressResult =
    Object.keys(partialAddressInput).length > 0
      ? sanitizePartialAddressInput(partialAddressInput)
      : null;
  if (addressResult && !addressResult.ok) {
    throw new InvalidInputError('Endereco incompleto ou invalido.', {
      fields: addressResult.errors,
    });
  }

  try {
    const snapshot = await loadUserLifecycleSnapshot(adminDb, clientId);
    if (!snapshot) {
      throw new NotFoundError('Cliente nao encontrado.');
    }
    if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
      throw new InvalidInputError('Use a rota de corretores para editar uma conta ativa de corretor.');
    }

    const setParts: string[] = [];
    const paramsList: unknown[] = [];

    if (name !== undefined) {
      const normalizedName = stringOrNull(name);
      if (!normalizedName || normalizedName.length > 120) {
        throw new InvalidInputError('Nome inválido.');
      }
      setParts.push('name = ?');
      paramsList.push(normalizedName);
    }

    if (email !== undefined) {
      const normalizedEmail = stringOrNull(email)?.toLowerCase() ?? null;
      if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        throw new InvalidInputError('Email inválido.');
      }
      const [duplicateRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
        [normalizedEmail, clientId],
      );
      if (duplicateRows.length > 0) {
        throw new ConflictError('Email ja cadastrado.');
      }
      setParts.push('email = ?');
      paramsList.push(normalizedEmail);
    }

    if (phone !== undefined) {
      if (!hasValidPhone(phone)) {
        throw new InvalidInputError('Telefone inválido. Use entre 10 e 13 dígitos com DDD.');
      }
      setParts.push('phone = ?');
      paramsList.push(normalizePhone(phone));
    }

    if (addressResult?.ok) {
      for (const [key, value] of Object.entries(addressResult.value)) {
        setParts.push(`${key} = ?`);
        paramsList.push(value);
      }
    }

    if (setParts.length === 0) {
      throw new InvalidInputError('Nenhum campo valido foi enviado para atualização.');
    }

    paramsList.push(clientId);
    await adminDb.query(`UPDATE users SET ${setParts.join(', ')} WHERE id = ?`, paramsList);

    return {
      message: 'Cliente atualizado com sucesso.',
      role: 'client',
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao atualizar cliente:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function deleteUserAccountAdmin(userId: number): Promise<{ message: string }> {
  if (Number.isNaN(userId)) {
    throw new InvalidInputError('Identificador de usuario invalido.');
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();
    const result = await deleteUserAccount(tx, userId);
    if (!result.affected) {
      await tx.rollback();
      throw new NotFoundError('Usuario nao encontrado.');
    }
    await tx.commit();
    return { message: 'Usuario deletado com sucesso.' };
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

export async function deleteClientAccountAdmin(clientId: number): Promise<{ message: string }> {
  if (Number.isNaN(clientId)) {
    throw new InvalidInputError('Identificador de cliente invalido.');
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();
    const snapshot = await loadUserLifecycleSnapshot(tx, clientId, { forUpdate: true });
    if (!snapshot) {
      await tx.rollback();
      throw new NotFoundError('Cliente nao encontrado.');
    }
    if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
      await tx.rollback();
      throw new InvalidInputError('Use a rota de corretores para excluir uma conta ativa de corretor.');
    }

    const result = await deleteUserAccount(tx, clientId);
    if (!result.affected) {
      await tx.rollback();
      throw new NotFoundError('Cliente nao encontrado.');
    }

    await tx.commit();
    return { message: 'Cliente deletado com sucesso.' };
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

export async function deleteBrokerAccountAdmin(brokerId: number): Promise<{ message: string }> {
  if (Number.isNaN(brokerId)) {
    throw new InvalidInputError('Identificador de corretor invalido.');
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();
    const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
    if (!snapshot || snapshot.broker_id == null) {
      await tx.rollback();
      throw new NotFoundError('Corretor nao encontrado.');
    }

    const result = await deleteUserAccount(tx, brokerId);
    if (!result.affected) {
      await tx.rollback();
      throw new NotFoundError('Corretor nao encontrado.');
    }

    await tx.commit();
    return { message: 'Corretor deletado com sucesso.' };
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
