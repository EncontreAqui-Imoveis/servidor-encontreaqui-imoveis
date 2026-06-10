import type { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import { addPdfJob } from '../modules/negotiations/infra/PdfQueue';
import { parseProposalData } from './negotiationProposalSupportService';
import {
  executeNegotiationStatement,
  generateNegotiationProposalPdf,
  queryNegotiationRows,
  saveNegotiationProposalDocument,
} from './negotiationPersistenceService';

interface NegotiationRow extends RowDataPacket {
  id: string;
  status: string;
}

interface ProposalBody {
  clientName?: unknown;
  client_name?: unknown;
  clientCpf?: unknown;
  client_cpf?: unknown;
  propertyAddress?: unknown;
  property_address?: unknown;
  brokerName?: unknown;
  broker_name?: unknown;
  sellingBrokerName?: unknown;
  selling_broker_name?: unknown;
  value?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
  payment?: {
    cash?: unknown;
    tradeIn?: unknown;
    trade_in?: unknown;
    financing?: unknown;
    financing_amount?: unknown;
    others?: unknown;
    others_amount?: unknown;
  };
  validityDays?: unknown;
  validity_days?: unknown;
  proposal_validity_date?: unknown;
  validityDate?: unknown;
}

function isDependencyUnavailableError(error: unknown): boolean {
  const anyError = error as {
    isAxiosError?: boolean;
    code?: string | null;
    message?: string | null;
  };

  const code = String(anyError?.code ?? '').toUpperCase();
  const message = String(anyError?.message ?? '').toUpperCase();

  if (message.includes('PDF_INTERNAL_API_KEY')) {
    return true;
  }

  if (anyError?.isAxiosError) {
    return true;
  }

  return ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);
}

function isPdfQueueDispatchFallbackError(error: unknown): boolean {
  const anyError = error as { code?: unknown; message?: unknown };
  const code = String(anyError?.code ?? '').toUpperCase();
  const message = String(anyError?.message ?? '').toLowerCase();

  return (
    code === 'PDF_QUEUE_DISABLED' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    message.includes('pdf queue disabled') ||
    message.includes('redis connection') ||
    message.includes('redis') ||
    message.includes('connection refused')
  );
}

async function fallbackGenerateProposalSynchronously(
  negotiationId: string,
  proposalData: ProposalData
): Promise<number> {
  const pdfBuffer = await generateNegotiationProposalPdf(proposalData);
  return saveNegotiationProposalDocument(negotiationId, pdfBuffer, null, {
    originalFileName: 'proposta.pdf',
    generated: true,
    metadata: {
      source: 'sync-fallback',
    },
  });
}

function respondWithCode(
  req: AuthRequest,
  res: Response,
  statusCode: number,
  code: string,
  error: string,
  retryable: boolean,
  extras?: Record<string, unknown>
): Response {
  return res.status(statusCode).json({
    status: 'error',
    code,
    error,
    retryable,
    correlation_id: getRequestId(req),
    ...(extras ?? {}),
  });
}

export async function generateProposal(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuario nao autenticado.' });
  }

  const negotiationId = String(req.params.id ?? '').trim();
  if (!negotiationId) {
    return res.status(400).json({ error: 'ID de negociacao invalido.' });
  }

  let proposalData: ProposalData;
  try {
    proposalData = parseProposalData((req.body ?? {}) as ProposalBody);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  try {
    const negotiationRows = await queryNegotiationRows<NegotiationRow>(
      'SELECT id FROM negotiations WHERE id = ? LIMIT 1',
      [negotiationId]
    );

    if (!negotiationRows.length) {
      return res.status(404).json({ error: 'Negociacao nao encontrada.' });
    }

    await executeNegotiationStatement(
      `
        UPDATE negotiations
        SET
          client_name = ?,
          client_cpf = ?
        WHERE id = ?
      `,
      [proposalData.clientName, proposalData.clientCpf, negotiationId]
    );

    try {
      await addPdfJob({
        negotiationId,
        documentType: 'proposal',
        userId: Number(req.userId),
      });

      return res.status(202).json({
        message:
          'A proposta está sendo gerada em segundo plano. Você receberá uma notificação quando estiver pronta.',
        negotiationId,
      });
    } catch (queueError) {
      if (!isPdfQueueDispatchFallbackError(queueError)) {
        throw queueError;
      }

      console.warn('Fila de PDF indisponível. Usando fallback síncrono para proposta.', {
        negotiationId,
        queueError: queueError instanceof Error ? queueError.message : String(queueError),
      });

      try {
        await fallbackGenerateProposalSynchronously(negotiationId, proposalData);
        return res.status(201).json({
          message: 'Fila de processamento desativada. Proposta gerada de forma síncrona.',
          negotiationId,
        });
      } catch (fallbackError) {
        console.error('Falha no fallback síncrono de geração de proposta:', fallbackError);
        if (isDependencyUnavailableError(fallbackError)) {
          return respondWithCode(
            req,
            res,
            503,
            'DEPENDENCY_UNAVAILABLE',
            'Servico temporariamente indisponivel. Tente novamente em instantes.',
            true
          );
        }
        if (fallbackError instanceof Error) {
          return respondWithCode(
            req,
            res,
            500,
            'INTERNAL_SERVER_ERROR',
            fallbackError.message,
            false
          );
        }
        throw fallbackError;
      }
    }
  } catch (error) {
    console.error('Erro ao gerar/salvar proposta em BLOB:', error);
    if (isDependencyUnavailableError(error)) {
      return respondWithCode(
        req,
        res,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Servico temporariamente indisponivel. Tente novamente em instantes.',
        true
      );
    }
    return respondWithCode(
      req,
      res,
      500,
      'INTERNAL_SERVER_ERROR',
      'Falha ao gerar e salvar proposta.',
      false
    );
  }
}
