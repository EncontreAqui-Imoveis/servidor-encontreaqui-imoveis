import { Queue } from 'bullmq';
import { getRedisConfigForPdfQueue } from '../../../config/redis';
import type { ProposalData } from '../domain/states/NegotiationState';

const PDF_QUEUE_DISABLED_ERROR_CODE = 'PDF_QUEUE_DISABLED';
const PDF_QUEUE_DISABLED_MESSAGE = 'PDF_WORKER_ENABLED=false ou configuração Redis ausente. Fila desativada.';
type PdfQueueError = Error & { code?: string };
export const PDF_QUEUE_NAME = 'pdf-generation';
let queueInstance: Queue<PdfJobData> | null = null;

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

function createPdfQueue(): Queue<PdfJobData> | null {
  const redisConnection = getRedisConfigForPdfQueue();
  if (!isPdfWorkerEnabled()) {
    const error = new Error(PDF_QUEUE_DISABLED_MESSAGE) as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    throw error;
  }
  if (!redisConnection.config) {
    console.error('PDF queue não pode ser inicializada:', {
      reason: redisConnection.reason,
      source: redisConnection.source,
    });
    const error = new Error(PDF_QUEUE_DISABLED_MESSAGE) as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    return null;
  }

  return new Queue<PdfJobData>(PDF_QUEUE_NAME, {
    connection: redisConnection.config,
  });
}

export function getPdfQueue(): Queue<PdfJobData> | null {
  if (queueInstance) {
    return queueInstance;
  }
  queueInstance = createPdfQueue();
  return queueInstance;
}

export async function addPdfJob(data: PdfJobData) {
  if (!isPdfWorkerEnabled()) {
    const error = new Error('PDF_QUEUE_DISABLED') as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    throw error;
  }

  const redisConnection = getRedisConfigForPdfQueue();
  if (!redisConnection.config) {
    const error = new Error(PDF_QUEUE_DISABLED_MESSAGE) as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    return Promise.reject(error);
  }

  const queue = getPdfQueue();
  if (!queue) {
    const error = new Error('PDF_QUEUE_DISABLED') as PdfQueueError;
    error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
    throw error;
  }

  return queue.add('generate-pdf', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
}

export const pdfQueue = {
  add: (...args: Parameters<Queue<PdfJobData>['add']>) => {
    const queue = getPdfQueue();
    if (!queue) {
      const error = new Error('PDF_QUEUE_DISABLED') as PdfQueueError;
      error.code = PDF_QUEUE_DISABLED_ERROR_CODE;
      return Promise.reject(error);
    }
    return queue.add(...args);
  },
  getUnderlyingQueue: () => getPdfQueue(),
};
