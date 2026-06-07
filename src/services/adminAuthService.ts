import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

import type AuthRequest from '../middlewares/auth';
import {
  ApplicationError,
  InternalError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import { signAdminReauthToken, signAdminToken } from './adminControllerSupport';

type AdminRow = RowDataPacket & {
  id: number;
  name?: string | null;
  email?: string | null;
  password_hash?: string | null;
  token_version?: number | null;
};

type AdminPublicRow = Omit<AdminRow, 'password_hash'>;

export type AdminLoginResult = {
  admin: AdminPublicRow;
  token: string;
};

export type AdminLogoutResult = {
  message: string;
};

export type AdminReauthResult = {
  reauthToken: string;
  expiresInSeconds: number;
};

export async function login(params: {
  email?: unknown;
  password?: unknown;
}): Promise<AdminLoginResult> {
  const { email, password } = params;
  const passwordValue = String(password ?? '');

  if (!email || !password) {
    throw new InvalidInputError('Email e senha sao obrigatorios.');
  }

  try {
    const [rows] = await adminDb.query<AdminRow[]>(
      'SELECT id, name, email, password_hash, token_version FROM admins WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      throw new UnauthorizedError('Credenciais invalidas.');
    }

    const admin = rows[0];
    const passwordHash = String((admin as { password_hash?: unknown }).password_hash ?? '');
    const isPasswordCorrect = await bcrypt.compare(passwordValue, passwordHash);
    if (!isPasswordCorrect) {
      throw new UnauthorizedError('Credenciais invalidas.');
    }

    const token = signAdminToken(admin.id, admin.token_version);
    const { password_hash: _passwordHash, ...publicAdmin } = admin as AdminPublicRow & {
      password_hash?: unknown;
    };
    return { admin: publicAdmin, token };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro no login do admin:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}

export async function logout(req: AuthRequest): Promise<AdminLogoutResult> {
  const adminId = Number(req.userId);

  if (!Number.isFinite(adminId) || adminId <= 0) {
    throw new UnauthorizedError('Administrador nao autenticado.');
  }

  try {
    const [result] = await adminDb.query<ResultSetHeader>(
      'UPDATE admins SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [adminId]
    );

    if (result.affectedRows === 0) {
      throw new NotFoundError('Administrador nao encontrado.');
    }

    return { message: 'Logout realizado com sucesso.' };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro no logout do admin:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}

export async function reauth(req: AuthRequest, password: unknown): Promise<AdminReauthResult> {
  const adminId = Number(req.userId);
  const passwordValue = String(password ?? '').trim();

  if (!Number.isFinite(adminId) || adminId <= 0) {
    throw new UnauthorizedError('Administrador nao autenticado.');
  }

  if (!passwordValue) {
    throw new InvalidInputError('Senha atual do administrador e obrigatoria.');
  }

  try {
    const [rows] = await adminDb.query<AdminRow[]>(
      'SELECT id, password_hash, token_version FROM admins WHERE id = ? LIMIT 1',
      [adminId]
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundError('Administrador nao encontrado.');
    }

    const admin = rows[0];
    const passwordHash = String((admin as { password_hash?: unknown }).password_hash ?? '');
    const isPasswordCorrect = await bcrypt.compare(passwordValue, passwordHash);
    if (!isPasswordCorrect) {
      throw new UnauthorizedError('Senha administrativa incorreta.');
    }

    const reauthToken = signAdminReauthToken(adminId, admin.token_version);
    return {
      reauthToken,
      expiresInSeconds: 600,
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao reautenticar administrador:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}
