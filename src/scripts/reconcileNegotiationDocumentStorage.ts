import connection from '../database/connection';
import { reconcileNegotiationDocumentStorage } from '../services/negotiationDocumentStorageReconciliationService';

function shouldDeleteOrphans(): boolean {
  if (!process.argv.includes('--delete-orphans')) return false;
  if (process.env.R2_RECONCILIATION_CONFIRM !== 'DELETE_ORPHANS') {
    throw new Error(
      'Recusado: defina R2_RECONCILIATION_CONFIRM=DELETE_ORPHANS para excluir objetos órfãos.'
    );
  }
  return true;
}

function allowEmptyDatabaseDelete(): boolean {
  return process.env.R2_RECONCILIATION_ALLOW_EMPTY_DATABASE_DELETE === 'DELETE_ALL_MANAGED_DOCUMENTS';
}

function summarize(result: Awaited<ReturnType<typeof reconcileNegotiationDocumentStorage>>) {
  return {
    mode: result.deletedOrphanObjects > 0 || result.failedOrphanDeletions > 0
      ? 'delete-orphans'
      : 'dry-run',
    databaseReferences: result.databaseReferences,
    storageObjects: result.storageObjects,
    missingStorageObjectsCount: result.missingStorageObjects.length,
    orphanStorageObjectsCount: result.orphanStorageObjects.length,
    missingStorageObjectsSample: result.missingStorageObjects.slice(0, 10),
    orphanStorageObjectsSample: result.orphanStorageObjects.slice(0, 10),
    deletedOrphanObjects: result.deletedOrphanObjects,
    failedOrphanDeletions: result.failedOrphanDeletions,
  };
}

async function main(): Promise<void> {
  const deleteOrphans = shouldDeleteOrphans();
  const result = await reconcileNegotiationDocumentStorage({
    deleteOrphans,
    allowEmptyDatabaseDelete: allowEmptyDatabaseDelete(),
  });
  console.log(JSON.stringify({ ...summarize(result), mode: deleteOrphans ? 'delete-orphans' : 'dry-run' }, null, 2));

  if (result.missingStorageObjects.length > 0 || result.failedOrphanDeletions > 0) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha na reconciliação de documentos R2:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
