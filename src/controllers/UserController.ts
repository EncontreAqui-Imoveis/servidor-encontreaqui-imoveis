import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import connection from '../database/connection';
import AuthRequest from '../middlewares/auth';
import admin from '../config/firebaseAdmin';
import { notifyAdmins } from '../services/notificationService';
import { resolveUserNotificationRole } from '../services/userNotificationService';
import { evaluateSupportRequestCooldown } from '../services/supportRequestService';
import { sanitizeAddressInput } from '../utils/address';

interface FavoriteRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  type: string;
  purpose: string;
  status: string;
  price: number | string;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
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
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_email?: string | null;
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
    price_sale: row.price_sale != null ? Number(row.price_sale) : null,
    price_rent: row.price_rent != null ? Number(row.price_rent) : null,
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
    broker_name: row.broker_name ?? null,
    broker_phone: row.broker_phone ?? null,
    broker_email: row.broker_email ?? null,
    favorited_at: row.favorited_at ?? null,
  };
}

class UserController {
  async register(req: Request, res: Response) {
    const {
      name,
      email,
      password,
      phone,
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha s?o obrigat?rios.' });
    }

    const addressResult = sanitizeAddressInput({
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    });
    if (!addressResult.ok) {
      return res.status(400).json({
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    try {
      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email já está em uso.' });
      }

      const passwordHash = await bcrypt.hash(password, 8);

      await connection.query(
        `
          INSERT INTO users (name, email, password_hash, phone, street, number, complement, bairro, city, state, cep)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          email,
          passwordHash,
          stringOrNull(phone),
          addressResult.value.street,
          addressResult.value.number,
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
        ]
      );

      return res.status(201).json({ message: 'Usuário criado com sucesso!' });
    } catch (error) {
      console.error('Erro no registro do usu?rio:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash FROM users WHERE email = ?',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const user = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(user.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
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
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      const [userRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, street, number, complement, bairro, city, state, cep FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      const user = userRows[0];

      const [brokerRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT b.status, bd.status AS broker_documents_status
          FROM brokers b
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE b.id = ?
        `,
        [userId]
      );

      if (brokerRows.length > 0) {
        const brokerStatus = String(brokerRows[0].status ?? '').trim();
        const isBroker = ['approved', 'pending_verification', 'pending_documents'].includes(brokerStatus);
        if (isBroker) {
          const docsStatus = String(brokerRows[0].broker_documents_status ?? '')
            .trim()
            .toLowerCase();
          const requiresDocuments = docsStatus.length === 0 || docsStatus === 'rejected';
          return res.json({
            role: 'broker',
            status: brokerStatus,
            requiresDocuments,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              street: user.street,
              number: user.number,
              complement: user.complement,
              bairro: user.bairro,
              city: user.city,
              state: user.state,
              cep: user.cep,
            },
          });
        }
      }

      return res.json({
        role: 'client',
        requiresDocuments: false,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          street: user.street,
          number: user.number,
          complement: user.complement,
          bairro: user.bairro,
          city: user.city,
          state: user.state,
          cep: user.cep,
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
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const { phone, street, number, complement, bairro, city, state, cep } = req.body ?? {};

    const addressResult = sanitizeAddressInput({
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    });
    if (!addressResult.ok) {
      return res.status(400).json({
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    try {
      await connection.query(
        'UPDATE users SET phone = ?, street = ?, number = ?, complement = ?, bairro = ?, city = ?, state = ?, cep = ? WHERE id = ?',
        [
          stringOrNull(phone),
          addressResult.value.street,
          addressResult.value.number,
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
          userId,
        ]
      );

      const [userRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, street, number, complement, bairro, city, state, cep FROM users WHERE id = ?',
        [userId]
      );

      const user = userRows[0];

      const [brokerRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT b.status, bd.status AS broker_documents_status
          FROM brokers b
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE b.id = ?
        `,
        [userId]
      );

      const brokerStatus = brokerRows.length > 0 ? String(brokerRows[0].status) : '';
      const isBroker = ['approved', 'pending_verification', 'pending_documents'].includes(brokerStatus);
      const role = isBroker ? 'broker' : 'client';
      const status = isBroker ? brokerStatus : undefined;
      const docsStatus = String(brokerRows[0]?.broker_documents_status ?? '')
        .trim()
        .toLowerCase();
      const requiresDocuments = isBroker && (docsStatus.length === 0 || docsStatus === 'rejected');

      return res.json({
        role,
        status,
        requiresDocuments,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          street: user.street,
          number: user.number,
          complement: user.complement,
          bairro: user.bairro,
          city: user.city,
          state: user.state,
          cep: user.cep,
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
        return res.status(401).json({ error: 'Acesso não autorizado.' });
      }

      const { uid, email } = req.body as { uid: string; email: string };

      if (!uid || !email) {
        return res.status(400).json({ error: 'UID e email são obrigatórios.' });
      }

      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE firebase_uid = ? OR email = ?',
        [uid, email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Usuário já existe.' });
      }

      await connection.query(
        'INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)',
        [uid, email, `User-${uid.substring(0, 8)}`]
      );

      return res.status(201).json({ message: 'Usuário sincronizado com sucesso!' });
    } catch (error) {
      console.error('Erro na sincronizacao do usuário:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async googleLogin(req: Request, res: Response) {
    const { idToken, profileType } = req.body as { idToken?: string; profileType?: string };

    if (!idToken) {
      return res.status(400).json({ error: 'Token do Google é obrigatório.' });
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
                 u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status,
                 bd.status AS broker_documents_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          LEFT JOIN broker_documents bd ON u.id = bd.broker_id
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
          (empty(user.phone) || empty(user.street) || empty(user.number) || empty(user.bairro) || empty(user.city) || empty(user.state) || empty(user.cep)) &&
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
            [user.id, null, 'pending_documents']
          );
          user.broker_status = 'pending_documents';
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
            [user.id, null, 'pending_documents']
          );
          user.broker_status = 'pending_documents';
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
          user.broker_status = 'pending_documents';
        }
      }

      const needsCompletion =
        !user.phone || !user.street || !user.number || !user.bairro || !user.city || !user.state || !user.cep;
      const brokerDocsStatus = String(user.broker_documents_status ?? '').trim().toLowerCase();
      const requiresDocuments =
        effectiveRole === 'broker' &&
        (brokerDocsStatus.length === 0 || brokerDocsStatus === 'rejected');

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
          street: user.street ?? null,
          number: user.number ?? null,
          complement: user.complement ?? null,
          bairro: user.bairro ?? null,
          city: user.city ?? null,
          state: user.state ?? null,
          cep: user.cep ?? null,
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
      return res.status(401).json({ error: 'Token do Google inválido.' });
    }
  }

  async firebaseLogin(req: Request, res: Response) {
    const {
      idToken,
      role,
      name: nameOverride,
      phone: phoneOverride,
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    } = req.body as {
      idToken?: string;
      role?: string;
      name?: string;
      phone?: string;
      street?: string;
      number?: string;
      complement?: string;
      bairro?: string;
      city?: string;
      state?: string;
      cep?: string;
    };

    if (!idToken) {
      return res.status(400).json({ error: 'Token do Firebase ? obrigat?rio.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { uid, email, name, phone_number: phone } = decodedToken as any;

      const fallbackEmail = email ?? `${uid}@noemail.firebase`;
      const displayName = name || `User-${uid.substring(0, 8)}`;

      const [userRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `,
        [uid, fallbackEmail]
      );

      let user: any;

      const hasAddressInput =
        street !== undefined ||
        number !== undefined ||
        complement !== undefined ||
        bairro !== undefined ||
        city !== undefined ||
        state !== undefined ||
        cep !== undefined;

      if (userRows.length > 0) {
        user = userRows[0];
        const updates: Array<[string, any]> = [];
        if (!user.firebase_uid) updates.push(['firebase_uid', uid]);
        if ((phone || phoneOverride) && user.phone !== (phoneOverride ?? phone)) {
          updates.push(['phone', phoneOverride ?? phone]);
        }
        if (email && user.email !== email) updates.push(['email', email]);
        if (nameOverride && user.name !== nameOverride) updates.push(['name', nameOverride]);

        if (hasAddressInput) {
          const addressResult = sanitizeAddressInput({
            street,
            number,
            complement,
            bairro,
            city,
            state,
            cep,
          });
          if (!addressResult.ok) {
            return res.status(400).json({
              error: 'Endereco incompleto ou invalido.',
              fields: addressResult.errors,
            });
          }
          updates.push(['street', addressResult.value.street]);
          updates.push(['number', addressResult.value.number]);
          updates.push(['complement', addressResult.value.complement]);
          updates.push(['bairro', addressResult.value.bairro]);
          updates.push(['city', addressResult.value.city]);
          updates.push(['state', addressResult.value.state]);
          updates.push(['cep', addressResult.value.cep]);
        }

        if (updates.length > 0) {
          const set = updates.map(([field]) => `${field} = ?`).join(', ');
          const values = updates.map(([, value]) => value);
          await connection.query(`UPDATE users SET ${set} WHERE id = ?`, [...values, user.id]);
        }
      } else {
        let addressPayload = {
          street: null as string | null,
          number: null as string | null,
          complement: null as string | null,
          bairro: null as string | null,
          city: null as string | null,
          state: null as string | null,
          cep: null as string | null,
        };

        if (hasAddressInput) {
          const addressResult = sanitizeAddressInput({
            street,
            number,
            complement,
            bairro,
            city,
            state,
            cep,
          });
          if (!addressResult.ok) {
            return res.status(400).json({
              error: 'Endereco incompleto ou invalido.',
              fields: addressResult.errors,
            });
          }
          addressPayload = addressResult.value;
        }

        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name, phone, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            uid,
            fallbackEmail,
            nameOverride ?? displayName,
            phoneOverride ?? phone ?? null,
            addressPayload.street,
            addressPayload.number,
            addressPayload.complement,
            addressPayload.bairro,
            addressPayload.city,
            addressPayload.state,
            addressPayload.cep,
          ]
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
          street: user.street ?? street ?? null,
          number: user.number ?? number ?? null,
          complement: user.complement ?? complement ?? null,
          bairro: user.bairro ?? bairro ?? null,
          city: user.city ?? city ?? null,
          state: user.state ?? state ?? null,
          cep: user.cep ?? cep ?? null,
          broker_status: user.broker_status,
        },
        token,
      });
    } catch (error) {
      console.error('Erro no login com Firebase:', error);
      return res.status(401).json({ error: 'Token do Firebase inv?lido.' });
    }
  }

  async addFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      const [favoriteRows] = await connection.query<RowDataPacket[]>(
        'SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (favoriteRows.length > 0) {
        return res.status(409).json({ error: 'Este imóvel ja esta nos seus favoritos.' });
      }

      await connection.query('INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)', [userId, propertyId]);

      return res.status(201).json({ message: 'Imóvel adicionado aos favoritos.' });
    } catch (error) {
      console.error('Erro ao adicionar favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async removeFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Favorito não encontrado.' });
      }

      return res.status(200).json({ message: 'Imóvel removido dos favoritos.' });
    } catch (error) {
      console.error('Erro ao remover favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async listFavorites(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
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
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            MAX(f.created_at) AS favorited_at
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
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

  async getMyProperties(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const offset = (page - 1) * limit;

      const countQuery = 'SELECT COUNT(*) as total FROM properties WHERE owner_id = ?';
      const [totalResult] = await connection.query(countQuery, [userId]);
      const total = (totalResult as any[])[0]?.total ?? 0;

      const dataQuery = `
        SELECT
          p.owner_id,
          p.broker_id,
          p.id,
          p.title,
          p.description,
          p.type,
          p.status,
          p.purpose,
          p.price,
          p.price_sale,
          p.price_rent,
          p.code,
          p.address,
          p.quadra,
          p.lote,
          p.numero,
          p.bairro,
          p.complemento,
          p.tipo_lote,
          p.city,
          p.state,
          p.bedrooms,
          p.bathrooms,
          p.area_construida,
          p.area_terreno,
          p.garage_spots,
          p.has_wifi,
          p.tem_piscina,
          p.tem_energia_solar,
          p.tem_automacao,
          p.tem_ar_condicionado,
          p.eh_mobiliada,
          p.valor_condominio,
          p.valor_iptu,
          p.video_url,
          p.created_at,
          u.name AS broker_name,
          u.phone AS broker_phone,
          u.email AS broker_email,
          GROUP_CONCAT(pi.image_url ORDER BY pi.id) AS images
        FROM properties p
        LEFT JOIN users u ON u.id = p.owner_id
        LEFT JOIN property_images pi ON p.id = pi.property_id
        WHERE p.owner_id = ?
        GROUP BY
          p.id, p.owner_id, p.broker_id, p.title, p.description, p.type, p.status, p.purpose,
          p.price, p.price_sale, p.price_rent, p.code, p.address, p.quadra, p.lote, p.numero,
          p.bairro, p.complemento, p.tipo_lote, p.city, p.state, p.bedrooms, p.bathrooms,
          p.area_construida, p.area_terreno, p.garage_spots, p.has_wifi, p.tem_piscina,
          p.tem_energia_solar, p.tem_automacao, p.tem_ar_condicionado, p.eh_mobiliada,
          p.valor_condominio, p.valor_iptu, p.video_url, p.created_at, u.name, u.phone, u.email
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const [dataRows] = await connection.query(dataQuery, [userId, limit, offset]);

      const parseBool = (value: unknown) => value === 1 || value === '1' || value === true;

      const properties = (dataRows as any[]).map((row) => ({
        ...row,
        price: Number(row.price),
        price_sale: row.price_sale != null ? Number(row.price_sale) : null,
        price_rent: row.price_rent != null ? Number(row.price_rent) : null,
        bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
        bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
        area_construida: row.area_construida != null ? Number(row.area_construida) : null,
        area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
        garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
        has_wifi: parseBool(row.has_wifi),
        tem_piscina: parseBool(row.tem_piscina),
        tem_energia_solar: parseBool(row.tem_energia_solar),
        tem_automacao: parseBool(row.tem_automacao),
        tem_ar_condicionado: parseBool(row.tem_ar_condicionado),
        eh_mobiliada: parseBool(row.eh_mobiliada),
        valor_condominio: row.valor_condominio != null ? Number(row.valor_condominio) : null,
        valor_iptu: row.valor_iptu != null ? Number(row.valor_iptu) : null,
        images: row.images ? row.images.split(',') : [],
      }));

      return res.json({
        success: true,
        data: properties,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error('Erro ao buscar imoveis do usuario:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async requestSupport(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [lastRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT created_at
          FROM support_requests
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId],
      );
      const lastRequestAt = lastRows[0]?.created_at
        ? new Date(lastRows[0].created_at)
        : null;
      const cooldown = evaluateSupportRequestCooldown(lastRequestAt);
      if (!cooldown.allowed) {
        return res.status(429).json({
          error: 'Voce ja enviou uma solicitacao nas ultimas 24 horas. Aguarde para reenviar.',
          retryAfterSeconds: cooldown.retryAfterSeconds,
        });
      }

      await connection.query(
        'INSERT INTO support_requests (user_id) VALUES (?)',
        [userId],
      );

      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT name, email FROM users WHERE id = ?',
        [userId]
      );
      const name = rows[0]?.name ? String(rows[0].name) : 'Usuario';
      const email = rows[0]?.email ? String(rows[0].email) : '';
      const label = email ? `${name} (${email})` : name;
      await notifyAdmins(
        `Solicitacao de anuncio recebida de ${label}.`,
        'announcement',
        Number(userId)
      );
      return res.status(201).json({ message: 'Solicitacao enviada.' });
    } catch (error) {
      console.error('Erro ao enviar solicitacao:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async listNotifications(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      const role = await resolveUserNotificationRole(Number(userId));
      const sql = `
        SELECT n.id,
               n.message,
               n.related_entity_type,
               n.related_entity_id,
               n.recipient_id,
               n.is_read,
               n.created_at
        FROM notifications n
        INNER JOIN (
          SELECT MAX(id) AS max_id
          FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
          GROUP BY message,
                   related_entity_type,
                   COALESCE(related_entity_id, 0),
                   recipient_id
        ) latest ON latest.max_id = n.id
        ORDER BY n.created_at DESC
      `;

      const [rows] = await connection.query<RowDataPacket[]>(sql, [userId, role]);
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
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ error: 'Identificador de notificação inválido.' });
    }

    try {
      const role = await resolveUserNotificationRole(Number(userId));
      const [result] = await connection.query<ResultSetHeader>(
        `
          DELETE FROM notifications
          WHERE id = ?
            AND recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
        `,
        [notificationId, userId, role],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Notificação não encontrada.' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao remover notificação:', error);
      return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
  }

  async markAllNotificationsRead(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      const role = await resolveUserNotificationRole(Number(userId));
      await connection.query(
        `
          DELETE FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
        `,
        [userId, role],
      );

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao limpar notificações:', error);
      return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
  }

  async registerDeviceToken(req: AuthRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
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
      return res.status(401).json({ error: 'Usuário não autenticado.' });
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
