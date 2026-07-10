import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import connection from '../src/database/connection';
import {
  auditLegacyContracts,
  type LegacyContractAuditDb,
} from '../src/services/contractLegacyAuditService';

interface CliOptions {
  apply: boolean;
  reportPath: string | null;
}

function parseArgs(args: string[]): CliOptions {
  let apply = false;
  let reportPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--report') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Informe o caminho apos --report.');
      }
      reportPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length) || null;
      continue;
    }
    throw new Error(`Argumento nao reconhecido: ${arg}`);
  }

  return { apply, reportPath };
}

function assertApplyGuard(options: CliOptions): void {
  if (!options.apply) return;

  if (process.env.CONTRACT_LEGACY_SANITATION_ENABLED !== 'true') {
    throw new Error(
      'Modo de escrita bloqueado. Defina CONTRACT_LEGACY_SANITATION_ENABLED=true e execute novamente.',
    );
  }
}

async function writeReport(reportPath: string, report: unknown): Promise<void> {
  const absolutePath = path.resolve(process.cwd(), reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stderr.write(`Relatorio de auditoria salvo em ${absolutePath}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertApplyGuard(options);

  const report = await auditLegacyContracts(connection as unknown as LegacyContractAuditDb, {
    apply: options.apply,
  });

  if (options.reportPath) await writeReport(options.reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Falha na auditoria de contratos legados: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
