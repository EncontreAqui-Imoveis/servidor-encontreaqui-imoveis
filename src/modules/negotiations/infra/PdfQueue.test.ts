import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queueAddMock, queueCtorMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue({ id: 'job-123' }),
  queueCtorMock: vi.fn(function () {
    return { add: queueAddMock };
  }),
}));

vi.mock('../../../config/redis', () => ({
  getRedisConfigForPdfQueue: () => ({
    config: {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    },
    reason: 'test',
    source: 'legacy_host',
  }),
}));

vi.mock('bullmq', () => ({
  Queue: queueCtorMock,
}));

async function loadPdfQueueModule() {
  vi.resetModules();
  return import('./PdfQueue');
}

describe('PdfQueue', () => {
  beforeEach(() => {
    process.env.PDF_WORKER_ENABLED = 'true';
    queueCtorMock.mockClear();
    queueAddMock.mockClear();
  });

  afterEach(() => {
    delete process.env.PDF_WORKER_ENABLED;
  });

  it('should add a job to the queue with correct data', async () => {
    const { addPdfJob } = await loadPdfQueueModule();

    const jobData = {
      negotiationId: 'neg-123',
      documentType: 'proposal' as const,
      userId: 1,
    };

    const result = await addPdfJob(jobData);

    expect(queueAddMock).toHaveBeenCalledWith(
      'generate-pdf',
      jobData,
      expect.objectContaining({
        jobId: 'proposal:neg-123',
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
    expect(queueCtorMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('throws when queue is disabled', async () => {
    const { addPdfJob } = await loadPdfQueueModule();
    process.env.PDF_WORKER_ENABLED = 'false';

    const jobData = {
      negotiationId: 'neg-456',
      documentType: 'proposal' as const,
      userId: 2,
    };

    await expect(addPdfJob(jobData)).rejects.toThrow('PDF_QUEUE_DISABLED');
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(queueCtorMock).toHaveBeenCalledTimes(0);
  });

  it('não instancia Queue quando PDF_WORKER_ENABLED=false', async () => {
    const { addPdfJob } = await loadPdfQueueModule();
    process.env.PDF_WORKER_ENABLED = 'false';

    const jobData = {
      negotiationId: 'neg-789',
      documentType: 'proposal' as const,
      userId: 3,
    };

    await expect(addPdfJob(jobData)).rejects.toMatchObject({
      code: 'PDF_QUEUE_DISABLED',
    });

    expect(queueCtorMock).toHaveBeenCalledTimes(0);
  });
});
