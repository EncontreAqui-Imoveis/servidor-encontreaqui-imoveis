import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { ConflictError, ForbiddenError, InternalError, InvalidInputError, NotFoundError, UnauthorizedError } from '../errors/ApplicationError';
import { hashNewPassword, validateNewPassword } from '../security/passwordPolicy';
import { signAdminToken } from './adminControllerSupport';
import { adminDb } from './adminPersistenceService';

type AssistantRow = RowDataPacket & {
  id: number;
  name: string | null;
  email: string | null;
  role: string | null;
  is_active: number | boolean | null;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
};

type PasswordRow = RowDataPacket & { id: number; password_hash: string | null; token_version: number | null };

function asRequiredText(value: unknown, label: string, maximum = 160): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new InvalidInputError(`${label} e obrigatorio.`);
  if (normalized.length > maximum) throw new InvalidInputError(`${label} excede o tamanho permitido.`);
  return normalized;
}

function asEmail(value: unknown): string {
  const email = asRequiredText(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvalidInputError('Informe um email valido.');
  return email;
}

function asAssistant(row: AssistantRow) {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    role: 'document_operator' as const,
    isActive: row.is_active == null || row.is_active === true || Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

async function assertAssistant(id: number): Promise<AssistantRow> {
  const [rows] = await adminDb.query<AssistantRow[]>(
    `SELECT id, name, email, role, is_active, created_at, updated_at, last_login_at
       FROM admins WHERE id = ? AND role = 'document_operator' LIMIT 1`,
    [id],
  );
  if (!rows.length) throw new NotFoundError('Auxiliar administrativo nao encontrado.');
  return rows[0];
}

function asId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new InvalidInputError('Identificador invalido.');
  return id;
}

export async function listAdministrativeAssistants(params: { search?: unknown; includeInactive?: unknown }) {
  const search = String(params.search ?? '').trim();
  const includeInactive = String(params.includeInactive ?? '').trim() === 'true';
  const filters = ["role = 'document_operator'"];
  const values: unknown[] = [];
  if (!includeInactive) filters.push('is_active = 1');
  if (search) {
    filters.push('(name LIKE ? OR email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await adminDb.query<AssistantRow[]>(
    `SELECT id, name, email, role, is_active, created_at, updated_at, last_login_at
       FROM admins WHERE ${filters.join(' AND ')} ORDER BY is_active DESC, name ASC, id DESC`,
    values,
  );
  return { data: rows.map(asAssistant) };
}

export async function createAdministrativeAssistant(input: { actorAdminId: unknown; name: unknown; email: unknown; password: unknown }) {
  const actorAdminId = asId(input.actorAdminId);
  const name = asRequiredText(input.name, 'Nome');
  const email = asEmail(input.email);
  const password = String(input.password ?? '');
  const passwordError = validateNewPassword(password, 'admin');
  if (passwordError) throw new InvalidInputError(passwordError.message, { code: passwordError.code });

  const [existing] = await adminDb.query<RowDataPacket[]>('SELECT id FROM admins WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
  if (existing.length) throw new ConflictError('Ja existe uma conta administrativa com este email.');

  const passwordHash = await hashNewPassword(password);
  const [result] = await adminDb.query<ResultSetHeader>(
    `INSERT INTO admins (name, email, password_hash, role, is_active, token_version, created_by_admin_id)
     VALUES (?, ?, ?, 'document_operator', 1, 1, ?)`,
    [name, email, passwordHash, actorAdminId],
  );
  return { data: asAssistant(await assertAssistant(result.insertId)) };
}

export async function updateAdministrativeAssistant(input: { id: unknown; name?: unknown; email?: unknown }) {
  const id = asId(input.id);
  await assertAssistant(id);
  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(asRequiredText(input.name, 'Nome'));
  }
  if (input.email !== undefined) {
    const email = asEmail(input.email);
    const [existing] = await adminDb.query<RowDataPacket[]>('SELECT id FROM admins WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [email, id]);
    if (existing.length) throw new ConflictError('Ja existe uma conta administrativa com este email.');
    updates.push('email = ?');
    values.push(email);
  }
  if (!updates.length) throw new InvalidInputError('Informe ao menos um campo para editar.');
  values.push(id);
  await adminDb.query<ResultSetHeader>(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`, values);
  return { data: asAssistant(await assertAssistant(id)) };
}

export async function setAdministrativeAssistantActive(input: { id: unknown; active: boolean }) {
  const id = asId(input.id);
  await assertAssistant(id);
  await adminDb.query<ResultSetHeader>(
    'UPDATE admins SET is_active = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
    [input.active ? 1 : 0, id],
  );
  return { data: asAssistant(await assertAssistant(id)) };
}

export async function resetAdministrativeAssistantPassword(input: { id: unknown; password: unknown }) {
  const id = asId(input.id);
  await assertAssistant(id);
  const password = String(input.password ?? '');
  const passwordError = validateNewPassword(password, 'admin');
  if (passwordError) throw new InvalidInputError(passwordError.message, { code: passwordError.code });
  await adminDb.query<ResultSetHeader>(
    'UPDATE admins SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
    [await hashNewPassword(password), id],
  );
  return { message: 'Senha do auxiliar atualizada. As sessoes anteriores foram encerradas.' };
}

export async function changeOwnAdministrativePassword(input: { adminId: unknown; currentPassword: unknown; newPassword: unknown }) {
  const adminId = asId(input.adminId);
  const currentPassword = String(input.currentPassword ?? '');
  const newPassword = String(input.newPassword ?? '');
  const passwordError = validateNewPassword(newPassword, 'admin');
  if (passwordError) throw new InvalidInputError(passwordError.message, { code: passwordError.code });
  const [rows] = await adminDb.query<PasswordRow[]>('SELECT id, password_hash, token_version FROM admins WHERE id = ? LIMIT 1', [adminId]);
  if (!rows.length) throw new NotFoundError('Administrador nao encontrado.');
  if (!(await bcrypt.compare(currentPassword, String(rows[0].password_hash ?? '')))) {
    throw new UnauthorizedError('Senha atual incorreta.');
  }
  if (await bcrypt.compare(newPassword, String(rows[0].password_hash ?? ''))) {
    throw new InvalidInputError('A nova senha deve ser diferente da senha atual.');
  }
  const nextVersion = Math.max(1, Number(rows[0].token_version) || 1) + 1;
  await adminDb.query<ResultSetHeader>(
    'UPDATE admins SET password_hash = ?, token_version = ? WHERE id = ?',
    [await hashNewPassword(newPassword), nextVersion, adminId],
  );
  return { message: 'Senha atualizada com sucesso.', token: signAdminToken(adminId, nextVersion) };
}
