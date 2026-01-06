import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import {
  notifyUsers,
  filterRecipientsByCooldown,
  splitRecipientsByRole,
  type RecipientRole,
} from './userNotificationService';

const PRICE_DROP_THRESHOLD = 0.1;
const PRICE_DROP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PRICE_DROP_PREFIX = 'Preço reduzido';

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  } catch (_) {
    return `R$ ${value.toFixed(2)}`;
  }
}

function calculateDrop(oldValue: number, newValue: number): number {
  if (oldValue <= 0) return 0;
  return (oldValue - newValue) / oldValue;
}

export interface PriceDropInput {
  propertyId: number;
  propertyTitle: string;
  previousSalePrice?: number | null;
  newSalePrice?: number | null;
  previousRentPrice?: number | null;
  newRentPrice?: number | null;
}

export async function notifyPriceDropIfNeeded({
  propertyId,
  propertyTitle,
  previousSalePrice,
  newSalePrice,
  previousRentPrice,
  newRentPrice,
}: PriceDropInput): Promise<void> {
  const saleDrop =
    previousSalePrice != null &&
    newSalePrice != null &&
    newSalePrice > 0 &&
    newSalePrice < previousSalePrice
      ? calculateDrop(previousSalePrice, newSalePrice)
      : 0;

  const rentDrop =
    previousRentPrice != null &&
    newRentPrice != null &&
    newRentPrice > 0 &&
    newRentPrice < previousRentPrice
      ? calculateDrop(previousRentPrice, newRentPrice)
      : 0;

  if (saleDrop < PRICE_DROP_THRESHOLD && rentDrop < PRICE_DROP_THRESHOLD) {
    return;
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT usuario_id FROM favoritos WHERE imovel_id = ?',
    [propertyId]
  );

  const recipients = (rows ?? [])
    .map((row) => Number(row.usuario_id))
    .filter((id) => Number.isFinite(id));

  if (recipients.length === 0) {
    return;
  }

  const cutoff = new Date(Date.now() - PRICE_DROP_COOLDOWN_MS);
  const { clientIds, brokerIds } = await splitRecipientsByRole(recipients);

  const title = propertyTitle?.trim() ? propertyTitle.trim() : 'sem título';
  let message = `${PRICE_DROP_PREFIX}: o imóvel "${title}" ficou mais barato.`;

  if (saleDrop >= PRICE_DROP_THRESHOLD && rentDrop >= PRICE_DROP_THRESHOLD) {
    message += ` Venda: de ${formatCurrency(previousSalePrice!)} para ${formatCurrency(newSalePrice!)}.`;
    message += ` Aluguel: de ${formatCurrency(previousRentPrice!)} para ${formatCurrency(newRentPrice!)}.`;
  } else if (saleDrop >= PRICE_DROP_THRESHOLD) {
    message += ` Venda: de ${formatCurrency(previousSalePrice!)} para ${formatCurrency(newSalePrice!)}.`;
  } else if (rentDrop >= PRICE_DROP_THRESHOLD) {
    message += ` Aluguel: de ${formatCurrency(previousRentPrice!)} para ${formatCurrency(newRentPrice!)}.`;
  }

  const recipientGroups: Array<{ role: RecipientRole; ids: number[] }> = [
    { role: 'client', ids: clientIds },
    { role: 'broker', ids: brokerIds },
  ];

  for (const group of recipientGroups) {
    if (group.ids.length === 0) {
      continue;
    }

    const allowedRecipients = await filterRecipientsByCooldown(
      group.ids,
      'property',
      propertyId,
      PRICE_DROP_PREFIX,
      cutoff,
      group.role
    );

    if (allowedRecipients.length === 0) {
      continue;
    }

    await notifyUsers({
      message,
      recipientIds: allowedRecipients,
      recipientRole: group.role,
      relatedEntityType: 'property',
      relatedEntityId: propertyId,
    });
  }
}
