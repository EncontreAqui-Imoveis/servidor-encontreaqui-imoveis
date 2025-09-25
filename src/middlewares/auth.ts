import { Request, Response, NextFunction } from 'express';
import admin from '../config/firebaseAdmin';
import connection from '../database/connection';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';

interface UserFromDB extends RowDataPacket {
  id: number;
  role: string;
  broker_status?: string;
}

interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  firebase_uid?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const { authorization } = req.headers;
  
  if (!authorization) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }

  const [scheme, token] = authorization.split(' ');
  if (!/Bearer$/i.test(scheme) || !token) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  try {
    // Tenta verificar como JWT tradicional primeiro
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { 
        id: number; 
        role: string;
      };
      
      req.userId = decoded.id;
      req.userRole = decoded.role;

      // ✅ VERIFICAÇÃO EXTRA: Se for broker, verificar status
      if (decoded.role === 'broker') {
        const [brokerRows] = await connection.query(
          'SELECT status FROM brokers WHERE id = ?',
          [decoded.id]
        );
        const brokers = brokerRows as any[];
        
        if (brokers.length > 0 && brokers[0].status === 'rejected') {
          return res.status(403).json({ 
            error: 'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.' 
          });
        }
      }
      
      return next();
    } catch (jwtError) {
      // Fallback para Firebase
      const decodedToken = await admin.auth().verifyIdToken(token);
      const firebase_uid = decodedToken.uid;

      const [userRows] = await connection.query<UserFromDB[]>(
        `SELECT u.id, 
                u.role,
                b.status as broker_status
         FROM users u
         LEFT JOIN brokers b ON u.id = b.id
         WHERE u.firebase_uid = ?`,
        [firebase_uid]
      );

      if ((userRows as UserFromDB[]).length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      const user = (userRows as UserFromDB[])[0];
      req.userId = user.id;
      
      // Define a role correta considerando status do corretor
      const brokerStatus = (user.broker_status ?? '').toString().toLowerCase();
      const normalizedBrokerStatus = brokerStatus
        .normalize('NFD')
        .replace(/[^a-z]/g, '');

      if (['approved', 'verificado', 'verified', 'aprovado'].includes(normalizedBrokerStatus)) {
        req.userRole = 'broker';
      } else {
        req.userRole = user.role ?? 'user';
      }

      // ✅ VERIFICAÇÃO EXTRA: Se for broker, verificar status
      if (req.userRole === 'broker') {
        const [brokerRows] = await connection.query(
          'SELECT status FROM brokers WHERE id = ?',
          [req.userId]
        );
        const brokers = brokerRows as any[];
        
        if (brokers.length > 0 && brokers[0].status === 'rejected') {
          return res.status(403).json({ 
            error: 'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.' 
          });
        }
      }

      req.firebase_uid = firebase_uid;
      
      return next();
    }
  } catch (error) {
    console.error('Erro de autenticação:', error);
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

export async function isBroker(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'broker') {
    return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para corretores.' });
  }

  try {
    // ✅ Verificar se o corretor está aprovado
    const [brokerRows] = await connection.query(
      'SELECT status FROM brokers WHERE id = ?',
      [req.userId]
    );
    const brokers = brokerRows as any[];
    
    if (brokers.length === 0 || brokers[0].status !== 'approved') {
      return res.status(403).json({ 
        error: 'Acesso negado. Sua conta de corretor não foi aprovada ou foi rejeitada. Para se registrar como cliente, use um email diferente.' 
      });
    }

    return next();
  } catch (error) {
    console.error('Erro ao verificar status do corretor:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export function isAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
  }
  return next();
}

export default AuthRequest;