import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { addPdfJob, pdfQueue } from './PdfQueue';

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-123' }));
const queueCtorMock = vi.hoisted(() =>
  vi.fn(function () {
    return { add: queueAddMock };
  }),
);
const originalPdfWorkerEnabled = process.env.PDF_WORKER_ENABLED;

vi.mock('bullmq', () => ({
  Queue: queueCtorMock,
}));

describe('PdfQueue', () => {
  beforeAll(() => {
    process.env.PDF_WORKER_ENABLED = 'true';
  });

  beforeEach(() => {
    process.env.PDF_WORKER_ENABLED = 'true';
    queueCtorMock.mockClear();
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (originalPdfWorkerEnabled === undefined) {
      delete process.env.PDF_WORKER_ENABLED;
    } else {
      process.env.PDF_WORKER_ENABLED = originalPdfWorkerEnabled;
    }
  });

  it('should add a job to the queue with correct data', async () => {
    const jobData = {
      negotiationId: 'neg-123',
      proposalData: {
        clientName: 'John Doe',
        clientCpf: '12345678901',
        propertyAddress: '123 Main St',
        brokerName: 'Jane Smith',
        sellingBrokerName: 'Jane Smith',
        value: 500000,
        payment: {
          cash: 500000,
          tradeIn: 0,
          financing: 0,
          others: 0,
        },
        validityDays: 10,
      },
      documentType: 'proposal' as const,
      userId: 1,
    };

    const result = await addPdfJob(jobData);

    expect(queueAddMock).toHaveBeenCalledWith('generate-pdf', jobData, expect.any(Object));
    expect(queueCtorMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('throws when queue is disabled', async () => {
    process.env.PDF_WORKER_ENABLED = 'false';

    const jobData = {
      negotiationId: 'neg-456',
      proposalData: {
        clientName: 'Ana Costa',
        clientCpf: '98765432100',
        propertyAddress: 'Rua Teste, 20',
        brokerName: 'Carlos Lima',
        sellingBrokerName: 'Carlos Lima',
        value: 300000,
        payment: {
          cash: 300000,
          tradeIn: 0,
          financing: 0,
          others: 0,
        },
        validityDays: 10,
      },
      documentType: 'proposal' as const,
      userId: 2,
    };

    await expect(addPdfJob(jobData)).rejects.toThrow('PDF_QUEUE_DISABLED');
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(queueCtorMock).toHaveBeenCalledTimes(0);
  });

  it('não instancia Queue quando PDF_WORKER_ENABLED=false', async () => {
    process.env.PDF_WORKER_ENABLED = 'false';

    const jobData = {
      negotiationId: 'neg-789',
      proposalData: {
        clientName: 'Bruno',
        clientCpf: '12312312312',
        propertyAddress: 'Rua Zero, 1',
        brokerName: 'Maria',
        sellingBrokerName: 'Maria',
        value: 100000,
        payment: {
          cash: 100000,
          tradeIn: 0,
          financing: 0,
          others: 0,
        },
        validityDays: 10,
      },
      documentType: 'proposal' as const,
      userId: 3,
    };

    await expect(addPdfJob(jobData)).rejects.toMatchObject({
      code: 'PDF_QUEUE_DISABLED',
    });

    expect(queueCtorMock).toHaveBeenCalledTimes(0);
  });
});
