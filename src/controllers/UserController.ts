import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import connection from '../database/connection';
import AuthRequest from '../middlewares/auth';
import admin from '../config/firebaseAdmin';

interface FavoriteRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  type: string;
  purpose: string;
  status: string;
  price: number | string;
  code?: string | null;
  address: string;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  tipo_lote?: string | null;
  city: string;
  state: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_construida?: number | string | null;
  area_terreno?: number | string | null;
  garage_spots?: number | null;
  has_wifi?: number | boolean | null;
  tem_piscina?: number | boolean | null;
  tem_energia_solar?: number | boolean | null;
  tem_automacao?: number | boolean | null;
  tem_ar_condicionado?: number | boolean | null;
  eh_mobiliada?: number | boolean | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  video_url?: string | null;
  images?: string | null;
  favorited_at?: Date;
  agency_id?: number | null;
  agency_name?: string | null;
  agency_logo_url?: string | null;
  agency_address?: string | null;
  agency_city?: string | null;
  agency_state?: string | null;
  agency_phone?: string | null;
}

function toBoolean(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const asString = String(value).trim();
  return asString.length > 0 ? asString : null;
}

function mapFavorite(row: FavoriteRow) {
  const images = row.images ? row.images.split(',').filter(Boolean) : [];
  const agency = row.agency_id
    ? {
        id: Number(row.agency_id),
        name: row.agency_name,
        logo_url: row.agency_logo_url,
        address: row.agency_address,
        city: row.agency_city,
        state: row.agency_state,
        phone: row.agency_phone,
      }
    : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    purpose: row.purpose,
    status: row.status,
    price: Number(row.price),
    code: row.code ?? null,
    address: row.address,
    quadra: row.quadra ?? null,
    lote: row.lote ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    tipo_lote: row.tipo_lote ?? null,
    city: row.city,
    state: row.state,
    bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
    area_construida: row.area_construida != null ? Number(row.area_construida) : null,
    area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    has_wifi: toBoolean(row.has_wifi),
    tem_piscina: toBoolean(row.tem_piscina),
    tem_energia_solar: toBoolean(row.tem_energia_solar),
    tem_automacao: toBoolean(row.tem_automacao),
    tem_ar_condicionado: toBoolean(row.tem_ar_condicionado),
    eh_mobiliada: toBoolean(row.eh_mobiliada),
    valor_condominio: toNullableNumber(row.valor_condominio),
    valor_iptu: toNullableNumber(row.valor_iptu),
    video_url: row.video_url ?? null,
    images,
    agency,
    favorited_at: row.favorited_at ?? null,
  };
}

class UserController {
  async register(req: Request, res: Response) {
    const { name, email, password, phone, address, city, state } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }

    try {
      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email ja esta em uso.' });
      }

      const passwordHash = await bcrypt.hash(password, 8);

      await connection.query(
        `
          INSERT INTO users (name, email, password_hash, phone, address, city, state)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [name, email, passwordHash, stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state)]
      );

      return res.status(201).json({ message: 'Usuario criado com sucesso!' });
    } catch (error) {
      console.error('Erro no registro do usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash FROM users WHERE email = ?',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const user = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(user.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const token = jwt.sign(
        { id: user.id, role: 'user' },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );

      delete (user as any).password_hash;
      return res.status(200).json({ user, token });
    } catch (error) {
      console.error('Erro no login do usuário:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getProfile(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [userRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, address, city, state FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário nao encontrado.' });
      }

      const user = userRows[0];

      const [brokerRows] = await connection.query<RowDataPacket[]>(
        'SELECT status FROM brokers WHERE id = ?',
        [userId]
      );

      if (brokerRows.length > 0) {
        return res.json({
          role: 'broker',
          status: brokerRows[0].status,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            city: user.city,
            state: user.state,
          },
        });
      }

      return res.json({
        role: 'client',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          city: user.city,
          state: user.state,
        },
      });
    } catch (error) {
      console.error('Erro ao buscar perfil:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateProfile(req: AuthRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const { phone, address, city, state } = req.body ?? {};

    try {
      await connection.query(
        'UPDATE users SET phone = ?, address = ?, city = ?, state = ? WHERE id = ?',
        [stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state), userId]
      );

      const [userRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, address, city, state FROM users WHERE id = ?',
        [userId]
      );

      const user = userRows[0];

      const [brokerRows] = await connection.query<RowDataPacket[]>(
        'SELECT status FROM brokers WHERE id = ?',
        [userId]
      );

      const role = brokerRows.length > 0 ? 'broker' : 'client';
      const status = brokerRows.length > 0 ? brokerRows[0].status : undefined;

      return res.json({
        role,
        status,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          city: user.city,
          state: user.state,
        },
      });
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async syncUser(req: Request, res: Response) {
    try {
      const secret = req.headers['x-sync-secret'];
      if (secret !== process.env.SYNC_SECRET_KEY) {
        return res.status(401).json({ error: 'Acesso nao autorizado.' });
      }

      const { uid, email } = req.body as { uid: string; email: string };

      if (!uid || !email) {
        return res.status(400).json({ error: 'UID e email sao obrigatorios.' });
      }

      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE firebase_uid = ? OR email = ?',
        [uid, email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Usuario ja existe.' });
      }

      await connection.query(
        'INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)',
        [uid, email, `User-${uid.substring(0, 8)}`]
      );

      return res.status(201).json({ message: 'Usuario sincronizado com sucesso!' });
    } catch (error) {
      console.error('Erro na sincronizacao do usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async googleLogin(req: Request, res: Response) {
    const { idToken, profileType } = req.body as { idToken?: string; profileType?: string };

    if (!idToken) {
      return res.status(400).json({ error: 'Token do Google e obrigatorio.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { uid, email, name } = decodedToken as any;
      const requestedRole =
        profileType === 'broker' ? 'broker' : profileType === 'client' ? 'client' : 'auto';
      const autoMode = requestedRole === 'auto';

      const [userRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 u.phone, u.address, u.city, u.state,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `,
        [uid, email]
      );

      let user: any;
      let isNewUser = false;

      if (userRows.length > 0) {
        user = userRows[0];
        if (!user.firebase_uid) {
          await connection.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, user.id]);
        }

        const empty = (v: any) => v === null || v === undefined || String(v).trim() === '';
        const missingProfile =
          (empty(user.phone) || empty(user.city) || empty(user.state) || empty(user.address)) &&
          user.broker_status == null;
        const missingRole = !user.role;

        if (autoMode && (missingProfile || missingRole)) {
          return res.json({
            requiresProfileChoice: true,
            isNewUser: false,
            roleLocked: false,
            pending: { email, name },
          });
        }
      } else {
        if (autoMode) {
          return res.json({
            requiresProfileChoice: true,
            isNewUser: true,
            roleLocked: false,
            pending: { email, name },
          });
        }

        const chosenRole = requestedRole === 'broker' ? 'broker' : 'client';
        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)',
          [uid, email, name || `User-${uid.substring(0, 8)}`, chosenRole]
        );
        user = {
          id: result.insertId,
          name: name || `User-${uid.substring(0, 8)}`,
          email,
          role: chosenRole,
        };
        isNewUser = true;
        user.broker_status = null;

        if (chosenRole === 'broker') {
          await connection.query(
            'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
            [user.id, null, 'pending_verification']
          );
          user.broker_status = 'pending_verification';
        }
      }

      // Papel efetivo:
      // - Se solicitou broker explicitamente, promove/atualiza para broker.
      // - Se solicitou client explicitamente e não tinha role, fixa como client.
      // - Modo auto mantém papel existente.
      let effectiveRole: string = user.role ?? 'client';
      let roleLocked = true;

      if (!autoMode && requestedRole === 'broker') {
        effectiveRole = 'broker';
        roleLocked = false;
        await connection.query('UPDATE users SET role = ? WHERE id = ?', [effectiveRole, user.id]);
        const [brokerRows] = await connection.query<RowDataPacket[]>(
          'SELECT status FROM brokers WHERE id = ?',
          [user.id]
        );
        if (brokerRows.length === 0) {
          await connection.query(
            'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
            [user.id, null, 'pending_verification']
          );
          user.broker_status = 'pending_verification';
        } else {
          user.broker_status = brokerRows[0].status;
        }
      } else if (!autoMode && requestedRole === 'client' && !user.role) {
        effectiveRole = 'client';
        roleLocked = false;
        await connection.query('UPDATE users SET role = ? WHERE id = ?', [effectiveRole, user.id]);
      }

      // Se papel final é corretor, garanta status carregado
      if (effectiveRole === 'broker') {
        const [brokerRows] = await connection.query<RowDataPacket[]>(
          'SELECT status FROM brokers WHERE id = ?',
          [user.id]
        );
        if (brokerRows.length > 0) {
          user.broker_status = brokerRows[0].status;
        } else {
          user.broker_status = 'pending_verification';
        }
      }

      const needsCompletion =
        !user.phone || !user.city || !user.state || !user.address;
      const requiresDocuments =
        effectiveRole === 'broker' &&
        (!user.broker_status || user.broker_status !== 'approved');

      // No modo auto, se a conta for nova ou estiver incompleta/pedindo docs, devolve escolha antes de emitir token
      if (autoMode && (isNewUser || needsCompletion || requiresDocuments)) {
        return res.json({
          requiresProfileChoice: true,
          isNewUser,
          roleLocked,
          needsCompletion,
          requiresDocuments,
          pending: { email, name },
        });
      }

      const token = jwt.sign(
        { id: user.id, role: effectiveRole },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '7d' }
      );

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: effectiveRole,
          phone: user.phone ?? null,
          address: user.address ?? null,
          city: user.city ?? null,
          state: user.state ?? null,
          broker_status: user.broker_status,
        },
        token,
        needsCompletion,
        requiresDocuments,
        isNewUser,
        roleLocked,
      });
    } catch (error) {
      console.error('Erro no login com Google:', error);
      return res.status(401).json({ error: 'Token do Google invalido.' });
    }
  }

  async firebaseLogin(req: Request, res: Response) {
    const { idToken, role, name: nameOverride, phone: phoneOverride, address, city, state } = req.body as {
      idToken?: string;
      role?: string;
      name?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
    };

    if (!idToken) {
      return res.status(400).json({ error: 'Token do Firebase é obrigatório.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { uid, email, name, phone_number: phone } = decodedToken as any;

      const fallbackEmail = email ?? `${uid}@noemail.firebase`;
      const displayName = name || `User-${uid.substring(0, 8)}`;

      const [userRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 u.phone,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `,
        [uid, fallbackEmail]
      );

      let user: any;

      if (userRows.length > 0) {
        user = userRows[0];
        const updates: Array<[string, any]> = [];
        if (!user.firebase_uid) updates.push(['firebase_uid', uid]);
        if ((phone || phoneOverride) && user.phone !== (phoneOverride ?? phone)) {
          updates.push(['phone', phoneOverride ?? phone]);
        }
        if (email && user.email !== email) updates.push(['email', email]);
        if (nameOverride && user.name !== nameOverride) updates.push(['name', nameOverride]);
        if (address !== undefined) updates.push(['address', address]);
        if (city !== undefined) updates.push(['city', city]);
        if (state !== undefined) updates.push(['state', state]);
        if (updates.length > 0) {
          const set = updates.map(([field]) => `${field} = ?`).join(', ');
          const values = updates.map(([, value]) => value);
          await connection.query(`UPDATE users SET ${set} WHERE id = ?`, [...values, user.id]);
        }
      } else {
        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uid, fallbackEmail, nameOverride ?? displayName, phoneOverride ?? phone ?? null, address ?? null, city ?? null, state ?? null]
        );
        user = {
          id: result.insertId,
          name: nameOverride ?? displayName,
          email: fallbackEmail,
          role: 'client',
        };
      }

      const effectiveRole = role ?? user.role ?? 'client';

      const token = jwt.sign(
        { id: user.id, role: effectiveRole },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '7d' }
      );

      return res.json({
        user: {
          id: user.id,
          name: user.name ?? nameOverride ?? displayName,
          email: user.email ?? fallbackEmail,
          role: effectiveRole,
          phone: user.phone ?? phoneOverride ?? phone ?? null,
          address: user.address ?? address ?? null,
          city: user.city ?? city ?? null,
          state: user.state ?? state ?? null,
          broker_status: user.broker_status,
        },
        token,
      });
    } catch (error) {
      console.error('Erro no login com Firebase:', error);
      return res.status(401).json({ error: 'Token do Firebase invalido.' });
    }
  }

  async addFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const [favoriteRows] = await connection.query<RowDataPacket[]>(
        'SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (favoriteRows.length > 0) {
        return res.status(409).json({ error: 'Este imovel ja esta nos seus favoritos.' });
      }

      await connection.query('INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)', [userId, propertyId]);

      return res.status(201).json({ message: 'Imovel adicionado aos favoritos.' });
    } catch (error) {
      console.error('Erro ao adicionar favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async removeFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Favorito nao encontrado.' });
      }

      return res.status(200).json({ message: 'Imovel removido dos favoritos.' });
    } catch (error) {
      console.error('Erro ao remover favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async listFavorites(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [rows] = await connection.query<FavoriteRow[]>(
        `
          SELECT
            p.*,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            MAX(f.created_at) AS favorited_at
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE f.usuario_id = ?
          GROUP BY p.id
          ORDER BY favorited_at DESC
        `,
        [userId]
      );

      return res.status(200).json(rows.map(mapFavorite));
    } catch (error) {
      console.error('Erro ao listar favoritos:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNotifications(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const sql = `
        SELECT id, message, related_entity_type, related_entity_id, recipient_id, is_read, created_at
        FROM notifications
        WHERE recipient_id = ?
          OR recipient_id IS NULL
        ORDER BY created_at DESC
      `;

      const [rows] = await connection.query<RowDataPacket[]>(sql, [userId]);
      return res.status(200).json(rows);
    } catch (error) {
      console.error('Erro ao buscar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
  }

  async markNotificationRead(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const notificationId = Number(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ error: 'Identificador de notificacao invalido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        `
          UPDATE notifications
          SET is_read = 1
          WHERE id = ?
            AND (recipient_id = ? OR recipient_id IS NULL)
        `,
        [notificationId, userId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Notificacao nao encontrada.' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao marcar notificacao como lida:', error);
      return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
  }

  async markAllNotificationsRead(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      await connection.query(
        `
          UPDATE notifications
          SET is_read = 1
          WHERE recipient_id = ?
            OR recipient_id IS NULL
        `,
        [userId],
      );

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao marcar todas as notificacoes como lidas:', error);
      return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
  }

  async registerDeviceToken(req: AuthRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const { token, platform } = req.body ?? {};
    const trimmedToken = typeof token === 'string' ? token.trim() : '';
    const trimmedPlatform = typeof platform === 'string' ? platform.trim() : null;

    if (!trimmedToken) {
      return res.status(400).json({ error: 'Token do dispositivo e obrigatorio.' });
    }

    try {
      await connection.query(
        `
          INSERT INTO user_device_tokens (user_id, fcm_token, platform)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            platform = VALUES(platform),
            updated_at = CURRENT_TIMESTAMP
        `,
        [userId, trimmedToken, trimmedPlatform],
      );

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao registrar token do dispositivo:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async unregisterDeviceToken(req: AuthRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
    const tokenFromBody = typeof req.body?.token === 'string' ? req.body.token : null;
    const trimmedToken = (tokenFromBody ?? tokenFromQuery ?? '').trim();

    if (!trimmedToken) {
      return res.status(400).json({ error: 'Token do dispositivo e obrigatorio.' });
    }

    try {
      await connection.query(
        'DELETE FROM user_device_tokens WHERE user_id = ? AND fcm_token = ?',
        [userId, trimmedToken],
      );
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao remover token do dispositivo:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

}

export const userController = new UserController();
