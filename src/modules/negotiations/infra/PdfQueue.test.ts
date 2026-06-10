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
      })
    );
    expect(queueCtorMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('throws when queue is disabled', async () => {
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
