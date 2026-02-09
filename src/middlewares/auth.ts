import { Request, Response, NextFunction } from 'express';
import connection from '../database/connection';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';

interface UserFromDB extends RowDataPacket {
  id: number;
  role: string;
  broker_status?: string;
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  firebase_uid?: string;
}

const jwtSecret = requireEnv('JWT_SECRET');

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }

  const [scheme, token] = authorization.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      id: number;
      role: string;
    };

    req.userId = decoded.id;
    req.userRole = decoded.role;

    if (decoded.role === 'broker') {
      const [brokerRows] = await connection.query(
        'SELECT status FROM brokers WHERE id = ?',
        [decoded.id]
      );
      const brokers = brokerRows as any[];
      if (brokers.length > 0 && brokers[0].status === 'rejected') {
        return res.status(403).json({
          error:
            'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.',
        });
      }
    }

    return next();
  } catch (error) {
    console.error('Erro de autenticação:', error);
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

export async function isBroker(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const [brokerRows] = await connection.query(
      'SELECT status FROM brokers WHERE id = ?',
      [req.userId]
    );
    const brokers = brokerRows as any[];

    if (brokers.length === 0) {
      const [userRows] = await connection.query(
        'SELECT role FROM users WHERE id = ?',
        [req.userId]
      );
      const users = userRows as any[];
      const role = String(users[0]?.role ?? '').trim().toLowerCase();
      if (role !== 'broker') {
        return res.status(403).json({
          error: 'Acesso negado. Rota exclusiva para corretores.',
        });
      }

      // Garante registro do corretor quando o usuario ja tem role broker.
      await connection.query(
        'INSERT IGNORE INTO brokers (id, creci, status) VALUES (?, ?, ?)',
        [req.userId, null, 'approved']
      );
      req.userRole = 'broker';
      return next();
    }

    if (brokers[0].status !== 'approved') {
      return res.status(403).json({
        error:
          'Acesso negado. Sua conta de corretor n??o foi aprovada ou foi rejeitada. Para se registrar como cliente, use um email diferente.',
      });
    }

    req.userRole = 'broker';
    return next();
  } catch (error) {
    console.error('Erro ao verificar status do corretor:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export function isAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({
      error: 'Acesso negado. Rota exclusiva para administradores.',
    });
  }
  return next();
}

export function isClient(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== 'client') {
    return res.status(403).json({
      error: 'Acesso negado. Rota exclusiva para clientes.',
    });
  }
  return next();
}

export default AuthRequest;
