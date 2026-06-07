import { Response } from 'express';
import { RowDataPacket } from 'mysql2';
import AuthRequest from '../middlewares/auth';
import { getPropertyDbConnection, runPropertyQuery } from './propertyPersistenceService';
import { notifyAdmins } from './notificationService';
import {
  calculateCommissionAmount,
  normalizeRecurrenceInterval,
  normalizeStatus,
  parseDecimal,
  resolveDealAmount,
} from './propertyUpdateValidationService';

export type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';
type DealType = 'sale' | 'rent';
type RecurrenceInterval = 'none' | 'weekly' | 'monthly' | 'yearly';

type Nullable<T> = T | null;

type PropertyRow = RowDataPacket & {
  broker_id?: number | null;
  owner_id?: number | null;
  status?: string | null;
  purpose?: string | null;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
  price?: number | string | null;
  commission_rate?: number | string | null;
  valor_iptu?: number | string | null;
  valor_condominio?: number | string | null;
};

type PropertyDeletionRow = RowDataPacket & {
  broker_id?: number | null;
  owner_id?: number | null;
};

const DEAL_TYPE_MAP: Record<string, DealType> = {
  sale: 'sale',
  sold: 'sale',
  venda: 'sale',
  vendido: 'sale',
  vendida: 'sale',
  rent: 'rent',
  rented: 'rent',
  aluguel: 'rent',
  alugado: 'rent',
  alugada: 'rent',
  locacao: 'rent',
  locado: 'rent',
  locada: 'rent',
};

function normalizeDealType(value: unknown): Nullable<DealType> {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFD').replace(/[^\p{L}0-9]/gu, '').toLowerCase();
  return DEAL_TYPE_MAP[normalized] ?? null;
}

function purposeAllowsDeal(purpose: string, dealType: DealType): boolean {
  const lower = String(purpose ?? '').toLowerCase();
  return dealType === 'sale' ? lower.includes('vend') : lower.includes('alug');
}

function parseInteger(value: unknown, label = 'Valor inteiro'): Nullable<number> {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error(`${label} inválido.`);
  return parsed;
}

async function upsertSaleRecord(
  db: Awaited<ReturnType<typeof getPropertyDbConnection>>,
  payload: {
    propertyId: number;
    brokerId: number;
    dealType: DealType;
    salePrice: number;
    commissionRate: number;
    commissionAmount: number;
    iptuValue: number | null;
    condominioValue: number | null;
    isRecurring: number;
    commissionCycles: number;
    recurrenceInterval: RecurrenceInterval;
  }
) {
  const [existingSaleRows] = await db.query<any[]>('SELECT id FROM sales WHERE property_id = ? ORDER BY sale_date DESC LIMIT 1', [payload.propertyId]);
  if (existingSaleRows.length > 0) {
    await db.query(
      `UPDATE sales
         SET deal_type = ?,
             sale_price = ?,
             commission_rate = ?,
             commission_amount = ?,
             iptu_value = ?,
             condominio_value = ?,
             is_recurring = ?,
             commission_cycles = ?,
             recurrence_interval = ?,
             sale_date = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.dealType,
        payload.salePrice,
        payload.commissionRate,
        payload.commissionAmount,
        payload.iptuValue,
        payload.condominioValue,
        payload.isRecurring,
        payload.commissionCycles,
        payload.recurrenceInterval,
        existingSaleRows[0].id,
      ]
    );
    return;
  }

  await db.query(
    `INSERT INTO sales
       (property_id, broker_id, deal_type, sale_price, commission_rate, commission_amount, iptu_value, condominio_value, is_recurring, commission_cycles, recurrence_interval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.propertyId,
      payload.brokerId,
      payload.dealType,
      payload.salePrice,
      payload.commissionRate,
      payload.commissionAmount,
      payload.iptuValue,
      payload.condominioValue,
      payload.isRecurring,
      payload.commissionCycles,
      payload.recurrenceInterval,
    ]
  );
}

export async function resubmitRejectedProperty(req: AuthRequest, res: Response) {
  const propertyId = Number(req.params.id);
  const userId = req.userId;

  if (!userId) return res.status(401).json({ error: 'Usuario nao autenticado.' });
  if (req.userRole === 'client') return res.status(403).json({ error: 'Apenas corretores podem reenviar anuncios.' });
  if (Number.isNaN(propertyId)) return res.status(400).json({ error: 'Identificador de imovel invalido.' });

  try {
    const propertyRows = await runPropertyQuery<PropertyRow[]>('SELECT * FROM properties WHERE id = ?', [propertyId]);
    if (!propertyRows || propertyRows.length === 0) return res.status(404).json({ error: 'Imovel nao encontrado.' });

    const property = propertyRows[0];
    const isOwner = (property.broker_id != null && property.broker_id === userId) || (property.owner_id != null && property.owner_id === userId);
    if (!isOwner) return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
    if (property.status === 'pending_approval') return res.status(409).json({ error: 'Imovel ja esta em analise.' });
    if (property.status !== 'rejected') return res.status(409).json({ error: 'Somente imoveis rejeitados podem ser reenviados desta forma.' });

    await runPropertyQuery(
      `UPDATE properties SET status = 'pending_approval', rejection_reason = NULL, visibility = 'HIDDEN', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [propertyId]
    );

    try {
      await notifyAdmins(`Imovel #${propertyId} reenviado para analise apos rejeicao.`, 'property', propertyId);
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre reenvio de imovel:', notifyError);
    }

    return res.status(200).json({ message: 'Imovel reenviado para analise.', status: 'pending_approval' });
  } catch (error) {
    console.error('Erro ao reenviar imovel:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export async function updatePropertyStatus(req: AuthRequest, res: Response) {
  const { status } = req.body as { status?: string };
  const normalized = normalizeStatus(status);
  if (!normalized) return res.status(400).json({ error: 'Status informado é inválido.' });
  req.body = { status: normalized } as any;
  return res.status(200).json({ ok: true });
}

export async function closePropertyDeal(req: AuthRequest, res: Response) {
  const propertyId = Number(req.params.id);
  const brokerId = req.userId;
  if (!brokerId) return res.status(401).json({ error: 'Corretor não autenticado.' });
  if (Number.isNaN(propertyId)) return res.status(400).json({ error: 'Identificador de imóvel inválido.' });

  const { type, amount, commission_rate, commission_cycles, recurrence_interval } = req.body as { type?: string; amount?: number | string; commission_rate?: number | string; commission_cycles?: number | string; recurrence_interval?: string; };
  const dealType = normalizeDealType(type);
  if (!dealType) return res.status(400).json({ error: 'Tipo de negocio invalido.' });

  try {
    const propertyRows = await runPropertyQuery<PropertyRow[]>('SELECT * FROM properties WHERE id = ?', [propertyId]);
    if (!propertyRows || propertyRows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado.' });
    const property = propertyRows[0];
    if (property.broker_id !== brokerId) return res.status(403).json({ error: 'Acesso não autorizado a este imóvel.' });
    if (property.status === 'pending_approval' || property.status === 'rejected') return res.status(403).json({ error: 'Imóvel ainda não pode ser fechado.' });
    if (!purposeAllowsDeal(property.purpose ?? '', dealType)) return res.status(400).json({ error: 'Tipo de negocio nao permitido para esta finalidade.' });

    const fallbackPrice = dealType === 'sale' ? Number(property.price_sale ?? property.price) : Number(property.price_rent ?? property.price);
    let dealAmount: number;
    try { dealAmount = resolveDealAmount(amount, fallbackPrice); } catch (parseError) { return res.status(400).json({ error: (parseError as Error).message }); }

    let commissionRate: number;
    try { commissionRate = parseDecimal(commission_rate) ?? (property.commission_rate != null ? Number(property.commission_rate) : 5.0); } catch (parseError) { return res.status(400).json({ error: (parseError as Error).message }); }

    let commissionCyclesValue = 0;
    try {
      const parsedCycles = parseInteger(commission_cycles, 'Comissões já realizadas');
      if (parsedCycles != null) {
        if (parsedCycles < 0) return res.status(400).json({ error: 'Comissões já realizadas inválidas.' });
        commissionCyclesValue = parsedCycles;
      }
    } catch (parseError) { return res.status(400).json({ error: (parseError as Error).message }); }

    const normalizedInterval = normalizeRecurrenceInterval(recurrence_interval);
    if (recurrence_interval !== undefined && recurrence_interval !== null && normalizedInterval == null) return res.status(400).json({ error: 'Intervalo de recorrencia invalido.' });
    const recurrenceInterval = normalizedInterval ?? 'none';

    const commissionAmount = calculateCommissionAmount(dealAmount, commissionRate);
    const iptuValue = property.valor_iptu != null ? Number(property.valor_iptu) : null;
    const condominioValue = property.valor_condominio != null ? Number(property.valor_condominio) : null;
    const newStatus: PropertyStatus = dealType === 'sale' ? 'sold' : 'rented';
    const isRecurring = recurrenceInterval !== 'none' ? 1 : 0;

    const db = await getPropertyDbConnection();
    try {
      await db.beginTransaction();
      await db.query('UPDATE properties SET status = ?, sale_value = ?, commission_rate = ?, commission_value = ? WHERE id = ?', [newStatus, dealAmount, commissionRate, commissionAmount, propertyId]);
      await upsertSaleRecord(db, { propertyId, brokerId, dealType, salePrice: dealAmount, commissionRate, commissionAmount, iptuValue, condominioValue, isRecurring, commissionCycles: commissionCyclesValue, recurrenceInterval });
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }

    return res.status(200).json({
      message: 'Negócio fechado com sucesso.',
      status: newStatus,
      sale: { property_id: propertyId, deal_type: dealType, sale_price: dealAmount, commission_rate: commissionRate, commission_amount: commissionAmount, iptu_value: iptuValue, condominio_value: condominioValue, is_recurring: isRecurring, commission_cycles: commissionCyclesValue, recurrence_interval: recurrenceInterval },
    });
  } catch (error) {
    console.error('Erro ao fechar negocio:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export async function cancelPropertyDeal(req: AuthRequest, res: Response) {
  const propertyId = Number(req.params.id);
  const brokerId = req.userId;
  if (!brokerId) return res.status(401).json({ error: 'Corretor nao autenticado.' });
  if (Number.isNaN(propertyId)) return res.status(400).json({ error: 'Identificador de imóvel invalido.' });

  try {
    const propertyRows = await runPropertyQuery<PropertyRow[]>('SELECT id, broker_id, status FROM properties WHERE id = ?', [propertyId]);
    if (!propertyRows || propertyRows.length === 0) return res.status(404).json({ error: 'Imóvel nao encontrado.' });
    const property = propertyRows[0];
    if (property.broker_id !== brokerId) return res.status(403).json({ error: 'Acesso nao autorizado a este imóvel.' });
    if (property.status !== 'sold' && property.status !== 'rented') return res.status(400).json({ error: 'Este imóvel nao possui negocio fechado.' });

    const db = await getPropertyDbConnection();
    try {
      await db.beginTransaction();
      await db.query('UPDATE properties SET status = ?, sale_value = NULL, commission_rate = NULL, commission_value = NULL WHERE id = ?', ['approved', propertyId]);
      await db.query('DELETE FROM sales WHERE property_id = ?', [propertyId]);
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }

    return res.status(200).json({ message: 'Negocio cancelado com sucesso.', status: 'approved' });
  } catch (error) {
    console.error('Erro ao cancelar negocio:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export async function deleteProperty(req: AuthRequest, res: Response) {
  const propertyId = Number(req.params.id);
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Usuario nao autenticado.' });
  if (Number.isNaN(propertyId)) return res.status(400).json({ error: 'Identificador de imóvel inválido.' });

  try {
    const propertyRows = await runPropertyQuery<PropertyDeletionRow[]>('SELECT broker_id, owner_id, video_url FROM properties WHERE id = ?', [propertyId]);
    if (!propertyRows || propertyRows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado.' });
    const property = propertyRows[0];
    const isOwner = (property.broker_id != null && property.broker_id === userId) || (property.owner_id != null && property.owner_id === userId);
    if (!isOwner) return res.status(403).json({ error: 'Voce nao tem permissao para deletar este imovel.' });

    await runPropertyQuery(
      `UPDATE properties SET status = 'sold', visibility = 'HIDDEN', lifecycle_status = 'SOLD', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [propertyId]
    );
    try {
      await runPropertyQuery('DELETE FROM featured_properties WHERE property_id = ?', [propertyId]);
    } catch {
      /* tabela/caso legacy */
    }

    return res.status(200).json({ message: 'Imóvel marcado como vendido e removido da vitrine pública.', status: 'sold' });
  } catch (error) {
    console.error('Erro ao deletar imóvel:', error);
    return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
  }
}
