import { RowDataPacket } from 'mysql2';

import { notifyAdmins } from './notificationService';
import { notifyPriceDropIfNeeded, notifyPromotionStarted } from './priceDropNotificationService';
import { propertyQueryExecutor, runPropertyQuery, type PropertyQueryExecutor } from './propertyPersistenceService';

type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';
type DealType = 'sale' | 'rent';
type RecurrenceInterval = 'none' | 'weekly' | 'monthly' | 'yearly';

type PropertyLike = {
  title: string;
  status: PropertyStatus;
  broker_id: number | null;
  price_sale: number | null;
  price_rent: number | null;
  price: number | null;
  commission_rate: number | null;
  valor_iptu: number | null;
  valor_condominio: number | null;
};

type UpdateBody = Record<string, unknown>;

const NOTIFY_ON_STATUS: Set<PropertyStatus> = new Set(['sold', 'rented']);

function resolveDealTypeFromStatus(status: PropertyStatus | null): DealType | null {
  if (status === 'sold') return 'sale';
  if (status === 'rented') return 'rent';
  return null;
}

function normalizeRecurrenceInterval(value: unknown): RecurrenceInterval | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['none', 'nunca', 'nao', 'não', 'sem'].includes(normalized)) return 'none';
  if (['weekly', 'semanal'].includes(normalized)) return 'weekly';
  if (['monthly', 'mensal'].includes(normalized)) return 'monthly';
  if (['yearly', 'anual'].includes(normalized)) return 'yearly';
  return null;
}

function resolveDealAmount(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Valor do negocio invalido.');
  }
  return Number(parsed.toFixed(2));
}

function calculateCommissionAmount(amount: number, rate: number): number {
  return Number(((amount * rate) / 100).toFixed(2));
}

async function upsertSaleRecord(
  executor: PropertyQueryExecutor,
  params: {
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
): Promise<void> {
  const rows = await runPropertyQuery<RowDataPacket[]>(
    'SELECT id FROM sales WHERE property_id = ? LIMIT 1',
    [params.propertyId]
  );

  if (rows.length > 0) {
    await executor.query(
      `
        UPDATE sales SET
          broker_id = ?,
          deal_type = ?,
          sale_price = ?,
          commission_rate = ?,
          commission_amount = ?,
          iptu_value = ?,
          condominio_value = ?,
          is_recurring = ?,
          commission_cycles = ?,
          recurrence_interval = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE property_id = ?
      `,
      [
        params.brokerId,
        params.dealType,
        params.salePrice,
        params.commissionRate,
        params.commissionAmount,
        params.iptuValue,
        params.condominioValue,
        params.isRecurring,
        params.commissionCycles,
        params.recurrenceInterval,
        params.propertyId,
      ]
    );
    return;
  }

  await executor.query(
    `
      INSERT INTO sales (
        property_id,
        broker_id,
        deal_type,
        sale_price,
        commission_rate,
        commission_amount,
        iptu_value,
        condominio_value,
        is_recurring,
        commission_cycles,
        recurrence_interval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.propertyId,
      params.brokerId,
      params.dealType,
      params.salePrice,
      params.commissionRate,
      params.commissionAmount,
      params.iptuValue,
      params.condominioValue,
      params.isRecurring,
      params.commissionCycles,
      params.recurrenceInterval,
    ]
  );
}

export type PropertyUpdateEffectsContext = {
  propertyId: number;
  property: PropertyLike;
  body: UpdateBody;
  brokerId: number | null;
  nextStatus: PropertyStatus | null;
  previousPromotionFlag: boolean;
  nextPromotionFlag: number;
  saleTouched: boolean;
  rentTouched: boolean;
  nextSalePrice: number;
  nextRentPrice: number;
  nextPromotionPercentage: number | null;
};

export type PropertyUpdateEffectsOutcome =
  | { kind: 'none' }
  | { kind: 'http_error'; statusCode: number; body: Record<string, unknown> }
  | { kind: 'terminal'; statusCode: number; body: Record<string, unknown> };

export async function applyPropertyUpdateEffects(
  ctx: PropertyUpdateEffectsContext
): Promise<PropertyUpdateEffectsOutcome> {
  const effectiveStatus = ctx.nextStatus ?? ctx.property.status;

  if (effectiveStatus === 'approved' && (ctx.saleTouched || ctx.rentTouched)) {
    try {
      await notifyPriceDropIfNeeded({
        propertyId: ctx.propertyId,
        propertyTitle: ctx.property.title,
        previousSalePrice: ctx.property.price_sale != null ? Number(ctx.property.price_sale) : Number(ctx.property.price),
        newSalePrice: ctx.saleTouched ? ctx.nextSalePrice : undefined,
        previousRentPrice: ctx.property.price_rent != null ? Number(ctx.property.price_rent) : Number(ctx.property.price),
        newRentPrice: ctx.rentTouched ? ctx.nextRentPrice : undefined,
      });
    } catch (notifyError) {
      console.error('Erro ao notificar queda de preco:', notifyError);
    }
  }

  if (!ctx.previousPromotionFlag && ctx.nextPromotionFlag === 1) {
    try {
      await notifyPromotionStarted({
        propertyId: ctx.propertyId,
        propertyTitle: ctx.property.title,
        promotionPercentage: ctx.nextPromotionPercentage,
      });
    } catch (notifyError) {
      console.error('Erro ao notificar promoção de imóvel:', notifyError);
    }
  }

  const isTerminalStatusTransition =
    ctx.nextStatus !== null &&
    NOTIFY_ON_STATUS.has(ctx.nextStatus) &&
    ctx.nextStatus !== ctx.property.status;

  if (!isTerminalStatusTransition) {
    return { kind: 'none' };
  }

  if (ctx.brokerId == null) {
    return {
      kind: 'http_error',
      statusCode: 403,
      body: { error: 'Apenas corretores podem fechar negocio.' },
    };
  }

  try {
    const action = ctx.nextStatus === 'sold' ? 'vendido' : 'alugado';
    await notifyAdmins(
      `O imóvel '${ctx.property.title}' foi marcado como ${action}.`,
      'property',
      ctx.propertyId
    );
  } catch (notifyError) {
    console.error('Erro ao registrar notificacao:', notifyError);
  }

  const dealType = resolveDealTypeFromStatus(ctx.nextStatus);
  if (!dealType) {
    return {
      kind: 'terminal',
      statusCode: 200,
      body: { message: 'Imóvel atualizado com sucesso.' },
    };
  }

  let dealAmount: number;
  try {
    const fallbackPrice =
      dealType === 'sale'
        ? Number(ctx.property.price_sale ?? ctx.property.price)
        : Number(ctx.property.price_rent ?? ctx.property.price);
    dealAmount = resolveDealAmount(
      ctx.body.amount ?? ctx.body.sale_price ?? ctx.body.price,
      fallbackPrice
    );
  } catch (parseError) {
    return {
      kind: 'http_error',
      statusCode: 400,
      body: { error: (parseError as Error).message },
    };
  }

  let commissionRate: number;
  try {
    const parsed = Number(ctx.body.commission_rate);
    commissionRate =
      Number.isFinite(parsed) && ctx.body.commission_rate !== undefined
        ? Number(parsed.toFixed(2))
        : (ctx.property.commission_rate != null ? Number(ctx.property.commission_rate) : 5.0);
  } catch (parseError) {
    return {
      kind: 'http_error',
      statusCode: 400,
      body: { error: (parseError as Error).message },
    };
  }

  let commissionCycles = 0;
  const cyclesRaw = ctx.body.commission_cycles;
  if (cyclesRaw !== undefined && cyclesRaw !== null && cyclesRaw !== '') {
    const parsedCycles = Number(cyclesRaw);
    if (!Number.isFinite(parsedCycles)) {
      return { kind: 'http_error', statusCode: 400, body: { error: 'Comissões já realizadas inválidas.' } };
    }
    if (parsedCycles < 0) {
      return { kind: 'http_error', statusCode: 400, body: { error: 'Comissões já realizadas inválidas.' } };
    }
    commissionCycles = Math.trunc(parsedCycles);
  }

  const normalizedInterval = normalizeRecurrenceInterval(ctx.body.recurrence_interval);
  if (
    ctx.body.recurrence_interval !== undefined &&
    ctx.body.recurrence_interval !== null &&
    normalizedInterval == null
  ) {
    return { kind: 'http_error', statusCode: 400, body: { error: 'Intervalo de recorrencia invalido.' } };
  }
  const recurrenceInterval = normalizedInterval ?? 'none';

  const commissionAmount = calculateCommissionAmount(dealAmount, commissionRate);
  const iptuValue = ctx.property.valor_iptu != null ? Number(ctx.property.valor_iptu) : null;
  const condominioValue = ctx.property.valor_condominio != null ? Number(ctx.property.valor_condominio) : null;
  const isRecurring = recurrenceInterval !== 'none' ? 1 : 0;

  await upsertSaleRecord(propertyQueryExecutor, {
    propertyId: ctx.propertyId,
    brokerId: ctx.brokerId,
    dealType,
    salePrice: dealAmount,
    commissionRate,
    commissionAmount,
    iptuValue,
    condominioValue,
    isRecurring,
    commissionCycles,
    recurrenceInterval,
  });

  await runPropertyQuery(
    'UPDATE properties SET sale_value = ?, commission_rate = ?, commission_value = ? WHERE id = ?',
    [dealAmount, commissionRate, commissionAmount, ctx.propertyId]
  );

  return {
    kind: 'terminal',
    statusCode: 200,
    body: {
      message: 'Negócio fechado com sucesso.',
      status: ctx.nextStatus,
      sale: {
        property_id: ctx.propertyId,
        deal_type: dealType,
        sale_price: dealAmount,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        iptu_value: iptuValue,
        condominio_value: condominioValue,
        is_recurring: isRecurring,
        commission_cycles: commissionCycles,
        recurrence_interval: recurrenceInterval,
      },
    },
  };
}
