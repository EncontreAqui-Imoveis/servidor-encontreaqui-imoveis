import { Worker, Job } from 'bullmq';
import { redisConfig } from '../../../config/redis';
import { isPdfWorkerEnabled, PDF_QUEUE_NAME, PdfJobData } from './PdfQueue';
import { generateNegotiationProposalPdf, saveNegotiationProposalDocument } from '../../../services/negotiationPersistenceService';
import { createUserNotification } from '../../../services/notificationService';

export function setupPdfWorker() {
  if (!isPdfWorkerEnabled()) {
    console.log('PDF worker não está habilitado. Defina PDF_WORKER_ENABLED=true para ativar.');
    return null;
  }

  try {
    const worker = new Worker<PdfJobData>(
      PDF_QUEUE_NAME,
      async (job: Job<PdfJobData>) => {
        const { negotiationId, proposalData, documentType, userId } = job.data;
        
        console.log(`Processing PDF generation for negotiation ${negotiationId}...`);

        try {
          // 1. Generate PDF
          const pdfBuffer = await generateNegotiationProposalPdf(proposalData);

          // 2. Save to database/storage
          const documentId = await saveNegotiationProposalDocument(
            negotiationId,
            pdfBuffer,
            null,
            {
              originalFileName: 'proposta.pdf',
              generated: true,
              jobId: job.id,
            }
          );

          console.log(`PDF generated and saved for negotiation ${negotiationId}. Document ID: ${documentId}`);

          // 3. Notify user
          await createUserNotification({
            type: 'negotiation',
            title: 'Proposta pronta!',
            message: `Sua proposta para o imóvel ${proposalData.propertyAddress} foi gerada com sucesso.`,
            recipientId: userId,
            relatedEntityId: Number(negotiationId.split('-')[0]) || 0, // Fallback if numeric ID is needed
            metadata: {
              negotiationId,
              documentId,
            },
          });

        } catch (error) {
          console.error(`Failed to generate PDF for negotiation ${negotiationId}:`, error);
          
          // Notify failure
          await createUserNotification({
            type: 'negotiation',
            title: 'Erro na geração da proposta',
            message: `Ocorreu um erro ao gerar sua proposta para o imóvel ${proposalData.propertyAddress}.`,
            recipientId: userId,
            relatedEntityId: 0,
            metadata: {
              negotiationId,
              error: error instanceof Error ? error.message : String(error),
            },
          });

          throw error; // Let BullMQ handle retries
        }
      },
      {
        connection: redisConfig,
        concurrency: 5,
      }
    );

    worker.on('completed', (job) => {
      console.log(`Job ${job.id} for negotiation ${job.data.negotiationId} completed.`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });

    return worker;
  } catch (error) {
    console.error('Falha ao inicializar PDF worker. Continuando sem processamento assíncrono:', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
