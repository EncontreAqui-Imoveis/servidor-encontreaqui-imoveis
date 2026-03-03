const fs = require('node:fs');
const path = require('node:path');

const summaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');

const CRITICAL_THRESHOLDS = [
  {
    file: 'src/middlewares/auth.ts',
    lines: 35,
    branches: 30,
  },
  {
    file: 'src/middlewares/requestSanitizer.ts',
    lines: 90,
    branches: 75,
  },
  {
    file: 'src/middlewares/security.ts',
    lines: 70,
    branches: 45,
  },
  {
    file: 'src/routes/auth.routes.ts',
    lines: 80,
    branches: 50,
  },
  {
    file: 'src/routes/public.routes.ts',
    lines: 100,
    branches: 100,
  },
  {
    file: 'src/modules/negotiations/infra/ExternalPdfService.ts',
    lines: 45,
    branches: 35,
  },
];

function normalizeFilePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function findCoverageEntry(summary, expectedFile) {
  const normalizedExpected = normalizeFilePath(expectedFile);
  for (const [key, metrics] of Object.entries(summary)) {
    if (key === 'total') continue;
    if (normalizeFilePath(key).endsWith(normalizedExpected)) {
      return metrics;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Coverage summary not found at ${summaryPath}`);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const failures = [];

  for (const threshold of CRITICAL_THRESHOLDS) {
    const metrics = findCoverageEntry(summary, threshold.file);
    if (!metrics) {
      failures.push(`${threshold.file}: missing from coverage summary`);
      continue;
    }

    const linePct = metrics.lines?.pct ?? 0;
    const branchPct = metrics.branches?.pct ?? 0;

    if (linePct < threshold.lines) {
      failures.push(
        `${threshold.file}: lines ${linePct}% below required ${threshold.lines}%`
      );
    }

    if (branchPct < threshold.branches) {
      failures.push(
        `${threshold.file}: branches ${branchPct}% below required ${threshold.branches}%`
      );
    }
  }

  if (failures.length > 0) {
    console.error('Critical coverage guard failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Critical coverage guard passed.');
}

main();
