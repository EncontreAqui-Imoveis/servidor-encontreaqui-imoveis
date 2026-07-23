import type { PoolConnection } from 'mysql2/promise';

import type { ContractRow } from '../controllers/ContractController';

export interface ContractCommissionData {
  valorBaseComissao: number;
  comissaoCaptador: number;
  comissaoVendedor: number;
  taxaPlataforma: number;
}

type AllocationRole = 'CAPTURING' | 'SELLING';

export function isRentalContract(contract: Pick<ContractRow, 'deal_type' | 'property_purpose'>): boolean {
  if (contract.deal_type === 'rent') {
    return true;
  }

  const purpose = String(contract.property_purpose ?? '').trim().toLowerCase();
  return purpose.includes('alug') && !purpose.includes('venda');
}

/**
 * Toda distribuição precisa fechar exatamente a base da comissão. A modalidade
 * define a base (venda ou primeiro aluguel), não percentuais obrigatórios.
 */
export function assertCommissionAllocationPolicy(
  _contract: Pick<ContractRow, 'deal_type' | 'property_purpose'>,
  commission: ContractCommissionData,
): void {
  const baseCents = Math.round(commission.valorBaseComissao * 100);
  const allocationCents =
    Math.round(commission.comissaoCaptador * 100) +
    Math.round(commission.comissaoVendedor * 100) +
    Math.round(commission.taxaPlataforma * 100);

  if (allocationCents !== baseCents) {
    throw new Error(
      'A soma da comissão do captador, vendedor e taxa Encontre Aqui deve fechar exatamente o valor base da comissão.',
    );
  }
}

function resolveDealType(contract: Pick<ContractRow, 'deal_type' | 'property_purpose'>): 'sale' | 'rent' {
  return isRentalContract(contract) ? 'rent' : 'sale';
}

function buildAllocations(
  contract: Pick<ContractRow, 'capturing_broker_id' | 'selling_broker_id' | 'deal_type' | 'property_purpose'>,
  commission: ContractCommissionData,
): Array<{ brokerId: number; role: AllocationRole; amount: number }> {
  const candidates: Array<{ brokerId: number; role: AllocationRole; amount: number }> = [
    {
      brokerId: Number(contract.capturing_broker_id ?? 0),
      role: 'CAPTURING',
      amount: commission.comissaoCaptador,
    },
    {
      brokerId: Number(contract.selling_broker_id ?? 0),
      role: 'SELLING',
      amount: commission.comissaoVendedor,
    },
  ];

  return candidates.filter(
    (allocation) => Number.isInteger(allocation.brokerId) && allocation.brokerId > 0 && allocation.amount > 0,
  );
}

/**
 * Sincroniza a projeção de repasses com o JSON canônico do contrato. Esta
 * função deve sempre ser chamada dentro da transação que finaliza ou corrige
 * um contrato finalizado.
 */
export async function syncContractCommissionAllocations(
  tx: PoolConnection,
  contract: Pick<
    ContractRow,
    'id' | 'negotiation_id' | 'capturing_broker_id' | 'selling_broker_id' | 'deal_type' | 'property_purpose'
  >,
  commission: ContractCommissionData,
): Promise<void> {
  assertCommissionAllocationPolicy(contract, commission);

  await tx.query(
    `
      UPDATE contract_commission_allocations
      SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE contract_id = ?
        AND status = 'RECORDED'
    `,
    [contract.id],
  );

  const dealType = resolveDealType(contract);
  for (const allocation of buildAllocations(contract, commission)) {
    await tx.query(
      `
        INSERT INTO contract_commission_allocations (
          id,
          contract_id,
          negotiation_id,
          broker_id,
          role,
          deal_type,
          base_amount,
          amount,
          status,
          finalized_at
        )
        SELECT
          UUID(),
          c.id,
          c.negotiation_id,
          ?,
          ?,
          ?,
          ?,
          ?,
          'RECORDED',
          COALESCE(c.finalized_at, CURRENT_TIMESTAMP)
        FROM contracts c
        WHERE c.id = ?
        ON DUPLICATE KEY UPDATE
          negotiation_id = VALUES(negotiation_id),
          deal_type = VALUES(deal_type),
          base_amount = VALUES(base_amount),
          amount = VALUES(amount),
          status = 'RECORDED',
          finalized_at = VALUES(finalized_at),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        allocation.brokerId,
        allocation.role,
        dealType,
        commission.valorBaseComissao,
        allocation.amount,
        contract.id,
      ],
    );
  }
}

export async function cancelContractCommissionAllocations(
  tx: PoolConnection,
  contractId: string,
): Promise<void> {
  await tx.query(
    `
      UPDATE contract_commission_allocations
      SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE contract_id = ?
        AND status = 'RECORDED'
    `,
    [contractId],
  );
}
