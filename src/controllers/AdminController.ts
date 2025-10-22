import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import connection from '../database/connection';
import { uploadToCloudinary } from '../config/cloudinary';
import type AuthRequest from '../middlewares/auth';

type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';

type Nullable<T> = T | null;

const STATUS_MAP: Record<string, PropertyStatus> = {
  pendingapproval: 'pending_approval',
  pendente: 'pending_approval',
  pending: 'pending_approval',
  aprovado: 'approved',
  aprovada: 'approved',
  approved: 'approved',
  rejeitado: 'rejected',
  rejeitada: 'rejected',
  rejected: 'rejected',
  alugado: 'rented',
  alugada: 'rented',
  rented: 'rented',
  vendido: 'sold',
  vendida: 'sold',
  sold: 'sold',
};

const ALLOWED_STATUS = new Set<PropertyStatus>([
  'pending_approval',
  'approved',
  'rejected',
  'rented',
  'sold',
]);

function normalizeStatus(value: unknown): Nullable<PropertyStatus> {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  const status = STATUS_MAP[normalized];
  if (!status || !ALLOWED_STATUS.has(status)) {
    return null;
  }
  return status;
}

function parseDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Valor numerico invalido.');
  }
  return parsed;
}

function parseInteger(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Valor inteiro invalido.');
  }
  return Math.trunc(parsed);
}

function parseBoolean(value: unknown): 0 | 1 {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return value === 0 ? 0 : 1;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'sim', 'on'].includes(normalized) ? 1 : 0;
  }
  return 0;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const textual = String(value).trim();
  return textual.length > 0 ? textual : null;
}

class AdminController {
  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash FROM admins WHERE email = ?',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const admin = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(admin.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const token = jwt.sign(
        { id: admin.id, role: 'admin' },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );

      delete (admin as any).password_hash;
      return res.status(200).json({ admin, token });
    } catch (error) {
      console.error('Erro no login do admin:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listPropertiesWithBrokers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const searchTerm = String(req.query.search ?? '').trim();
      const searchColumn = String(req.query.searchColumn ?? 'p.title');
      const status = normalizeStatus(req.query.status);
      const sortBy = String(req.query.sortBy ?? 'p.created_at');
      const sortOrder = String(req.query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const allowedSearchColumns = new Set(['p.id', 'p.title', 'p.type', 'p.city', 'p.code', 'u.name']);
      const allowedSortColumns = new Set([
        'p.id',
        'p.title',
        'p.type',
        'p.city',
        'u.name',
        'p.price',
        'p.created_at',
        'p.code',
      ]);

      const safeSearchColumn = allowedSearchColumns.has(searchColumn) ? searchColumn : 'p.title';
      const safeSortBy = allowedSortColumns.has(sortBy) ? sortBy : 'p.created_at';

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (searchTerm) {
        whereClauses.push(`${safeSearchColumn} LIKE ?`);
        params.push(`%${searchTerm}%`);
      }

      if (status) {
        whereClauses.push('p.status = ?');
        params.push(status);
      }

      const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [totalRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM properties p ${where}`,
        params
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT
            p.id,
            p.code,
            p.title,
            p.type,
            p.status,
            p.price,
            p.city,
            p.bairro,
            p.purpose,
            p.created_at,
            u.name AS broker_name,
            u.phone AS broker_phone
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON b.id = u.id
          ${where}
          ORDER BY ${safeSortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.json({ data: rows, total });
    } catch (error) {
      console.error('Erro ao listar imoveis com corretores:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateBroker(req: Request, res: Response) {
    const { id } = req.params;
    const { name, email, phone, creci, status, agencyId, agency_id } = req.body;
    const resolvedAgencyId = agencyId ?? agency_id;

    try {
      await connection.query(
        'UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?',
        [stringOrNull(name), stringOrNull(email), stringOrNull(phone), id]
      );

      const updates: string[] = [];
      const params: any[] = [];

      if (creci !== undefined) {
        updates.push('creci = ?');
        params.push(stringOrNull(creci));
      }

      if (status !== undefined) {
        const normalized = normalizeStatus(status);
        if (!normalized) {
          return res.status(400).json({ error: 'Status de corretor invalido.' });
        }
        updates.push('status = ?');
        params.push(normalized);
      }

      if (resolvedAgencyId !== undefined) {
        updates.push('agency_id = ?');
        params.push(resolvedAgencyId ? Number(resolvedAgencyId) : null);
      }

      if (updates.length > 0) {
        params.push(id);
        await connection.query(`UPDATE brokers SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      return res.status(200).json({ message: 'Corretor atualizado com sucesso.' });
    } catch (error) {
      console.error('Erro ao atualizar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateClient(req: Request, res: Response) {
    const { id } = req.params;
    const { name, email, phone, address, city, state } = req.body;

    try {
      await connection.query(
        'UPDATE users SET name = ?, email = ?, phone = ?, address = ?, city = ?, state = ? WHERE id = ?',
        [
          stringOrNull(name),
          stringOrNull(email),
          stringOrNull(phone),
          stringOrNull(address),
          stringOrNull(city),
          stringOrNull(state),
          id,
        ]
      );

      return res.status(200).json({ message: 'Cliente atualizado com sucesso.' });
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getAllUsers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const [totalRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM users',
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT id, name, email, phone, role, created_at
          FROM users
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `,
        [limit, offset]
      );

      return res.json({ data: rows, total });
    } catch (error) {
      console.error('Erro ao listar usuarios:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteUser(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await connection.query('DELETE FROM users WHERE id = ?', [id]);
      return res.status(200).json({ message: 'Usuario deletado com sucesso.' });
    } catch (error) {
      console.error('Erro ao deletar usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteBroker(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await connection.query('DELETE FROM brokers WHERE id = ?', [id]);
      return res.status(200).json({ message: 'Corretor deletado com sucesso.' });
    } catch (error) {
      console.error('Erro ao deletar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteProperty(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await connection.query('DELETE FROM properties WHERE id = ?', [id]);
      return res.status(200).json({ message: 'Imovel deletado com sucesso.' });
    } catch (error) {
      console.error('Erro ao deletar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateProperty(req: Request, res: Response) {
    const { id } = req.params;
    const body = req.body ?? {};

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, status FROM properties WHERE id = ?',
        [id]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const property = propertyRows[0] as { status?: string };
      const currentStatus = String(property.status ?? '').trim().toLowerCase();
      const isApproved = currentStatus === 'approved';

      const bodyKeys = Object.keys(body);
      if (isApproved) {
        const invalidKeys = bodyKeys.filter((key) => key !== 'status');
        if (invalidKeys.length > 0) {
          return res.status(403).json({
            error: 'Imoveis aprovados so permitem atualizar o status.',
          });
        }
      }

      const allowedFields = isApproved
        ? new Set(['status'])
        : new Set([
            'title',
            'description',
            'type',
            'purpose',
            'status',
            'price',
            'code',
            'address',
            'quadra',
            'lote',
            'numero',
            'bairro',
            'complemento',
            'tipo_lote',
            'city',
            'state',
            'bedrooms',
            'bathrooms',
            'area_construida',
            'area_terreno',
            'garage_spots',
            'has_wifi',
            'tem_piscina',
            'tem_energia_solar',
            'tem_automacao',
            'tem_ar_condicionado',
            'eh_mobiliada',
            'valor_condominio',
            'valor_iptu',
            'video_url',
            'sale_value',
            'commission_rate',
            'commission_value',
          ]);

      const setParts: string[] = [];
      const params: any[] = [];

      for (const [key, value] of Object.entries(body)) {
        if (!allowedFields.has(key)) {
          continue;
        }

        switch (key) {
          case 'status': {
            const normalized = normalizeStatus(value);
            if (!normalized) {
              return res.status(400).json({ error: 'Status invalido.' });
            }
            setParts.push('status = ?');
            params.push(normalized);
            break;
          }
          case 'price':
          case 'sale_value':
          case 'commission_rate':
          case 'commission_value':
          case 'area_construida':
          case 'area_terreno':
          case 'valor_condominio':
          case 'valor_iptu': {
            try {
              setParts.push(`${key} = ?`);
              params.push(parseDecimal(value));
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'bedrooms':
          case 'bathrooms':
          case 'garage_spots': {
            try {
              setParts.push(`${key} = ?`);
              params.push(parseInteger(value));
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'has_wifi':
          case 'tem_piscina':
          case 'tem_energia_solar':
          case 'tem_automacao':
          case 'tem_ar_condicionado':
          case 'eh_mobiliada': {
            setParts.push(`${key} = ?`);
            params.push(parseBoolean(value));
            break;
          }
          default: {
            setParts.push(`${key} = ?`);
            params.push(stringOrNull(value));
          }
        }
      }

      if (setParts.length === 0) {
        return res.status(400).json({ error: 'Nenhum dado fornecido para atualizacao.' });
      }

      params.push(id);

      await connection.query(
        `UPDATE properties SET ${setParts.join(', ')} WHERE id = ?`,
        params
      );

      return res.status(200).json({ message: 'Imovel atualizado com sucesso.' });
    } catch (error) {
      console.error('Erro ao atualizar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getDashboardStats(req: Request, res: Response) {
    try {
      const [propertiesResult] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM properties'
      );
      const [brokersResult] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM brokers'
      );
      const [usersResult] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM users'
      );

      return res.json({
        totalProperties: propertiesResult[0]?.total ?? 0,
        totalBrokers: brokersResult[0]?.total ?? 0,
        totalUsers: usersResult[0]?.total ?? 0,
      });
    } catch (error) {
      console.error('Erro ao buscar estatisticas do dashboard:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listPendingBrokers(req: Request, res: Response) {
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            bd.creci_front_url,
            bd.creci_back_url,
            bd.selfie_url,
            bd.status AS document_status,
            b.created_at
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE b.status = 'pending_verification'
            AND (bd.status = 'pending' OR bd.status IS NULL)
        `
      );

      return res.status(200).json({ data: rows });
    } catch (error) {
      console.error('Erro ao buscar corretores pendentes:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getAllClients(req: Request, res: Response) {
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.phone, u.created_at
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE b.id IS NULL
        `
      );

      return res.status(200).json({ data: rows, total: rows.length });
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async approveBroker(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await connection.query('UPDATE brokers SET status = ? WHERE id = ?', ['approved', id]);
      await connection.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', ['approved', id]);
      return res.status(200).json({ message: 'Corretor aprovado com sucesso.' });
    } catch (error) {
      console.error('Erro ao aprovar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async rejectBroker(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await connection.query('UPDATE brokers SET status = ? WHERE id = ?', ['rejected', id]);
      await connection.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', ['rejected', id]);
      return res.status(200).json({ message: 'Corretor rejeitado com sucesso.' });
    } catch (error) {
      console.error('Erro ao rejeitar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listBrokers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const [totalRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM brokers'
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id AS agency_id,
            a.name AS agency_name,
            a.logo_url AS agency_logo_url,
            a.address AS agency_address,
            a.city AS agency_city,
            a.state AS agency_state,
            a.zip_code AS agency_zip_code,
            a.phone AS agency_phone,
            a.email AS agency_email,
            COUNT(p.id) AS property_count
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN properties p ON p.broker_id = b.id
          GROUP BY
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id,
            a.name,
            a.logo_url,
            a.address,
            a.city,
            a.state,
            a.zip_code,
            a.phone,
            a.email
          ORDER BY b.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [limit, offset]
      );

      return res.json({ data: rows, total });
    } catch (error) {
      console.error('Erro ao buscar corretores:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async approveProperty(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'UPDATE properties SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['approved', propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      return res.status(200).json({ message: 'Imovel aprovado com sucesso.' });
    } catch (error) {
      console.error('Erro ao aprovar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async rejectProperty(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'UPDATE properties SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['rejected', propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      return res.status(200).json({ message: 'Imovel rejeitado com sucesso.' });
    } catch (error) {
      console.error('Erro ao rejeitar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async addPropertyImage(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const files = req.files as Express.Multer.File[] | undefined;

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const uploadedUrls: string[] = [];

      for (const file of files) {
        const result = await uploadToCloudinary(file, 'properties/admin');
        uploadedUrls.push(result.url);
      }

      if (uploadedUrls.length > 0) {
        const values = uploadedUrls.map((url) => [propertyId, url]);
        await connection.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
      }

      return res.status(201).json({ message: 'Imagens adicionadas com sucesso.', images: uploadedUrls });
    } catch (error) {
      console.error('Erro ao adicionar imagens:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deletePropertyImage(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const imageId = Number(req.params.imageId);

    if (Number.isNaN(propertyId) || Number.isNaN(imageId)) {
      return res.status(400).json({ error: 'Identificadores invalidos.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM property_images WHERE id = ? AND property_id = ?',
        [imageId, propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imagem nao encontrada para este imovel.' });
      }

      return res.status(200).json({ message: 'Imagem removida com sucesso.' });
    } catch (error) {
      console.error('Erro ao remover imagem:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT
            id,
            message,
            related_entity_type,
            related_entity_id,
            is_read,
            created_at
          FROM notifications
          WHERE user_id = ? AND is_read = 0
          ORDER BY created_at DESC
        `,
        [adminId]
      );

      return res.status(200).json({ data: rows });
    } catch (error) {
      console.error('Erro ao buscar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
}

export const adminController = new AdminController();
