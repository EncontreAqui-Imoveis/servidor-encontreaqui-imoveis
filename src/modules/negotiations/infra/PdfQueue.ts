import { Queue } from 'bullmq';
import { redisConfig } from '../../../config/redis';
import type { ProposalData } from '../domain/states/NegotiationState';

export const PDF_QUEUE_NAME = 'pdf-generation';
const PDF_QUEUE_DISABLED_ERROR_CODE = 'PDF_QUEUE_DISABLED';
type PdfQueueError = Error & { code?: string };

function resolveWorkerEnabledFlag(): boolean {
  const value = String(process.env.PDF_WORKER_ENABLED ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export interface PdfJobData {
  negotiationId: string;
  proposalData: ProposalData;
  documentType: 'proposal' | 'contract';
  userId: number;
}

export function isPdfWorkerEnabled(): boolean {
  return resolveWorkerEnabledFlag();
}

export const pdfQueue = new Queue<PdfJobData>(PDF_QUEUE_NAME, {
  connection: redisConfig,
});

export async function addPdfJob(data: PdfJobData) {
  if (!isPdfWorkerEnabled()) {
    const error = new Error('PDF_QUEUE_DISABLED') as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    throw error;
  }

  return pdfQueue.add('generate-pdf', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
}
