const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.join(__dirname, '..', 'src');

function normalize(filePath) {
  return filePath.replace(/\\/g, '/');
}

function relativeToRoot(filePath) {
  return normalize(path.relative(path.join(__dirname, '..'), filePath));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getImports(content) {
  const regex = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;
  const imports = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function getLayer(relativePath) {
  const normalizedPath = normalize(relativePath);
  if (/^src\/modules\/.+\/domain\//.test(normalizedPath)) return 'domain';
  if (/^src\/routes\//.test(normalizedPath)) return 'route';
  if (/^src\/controllers\//.test(normalizedPath)) return 'controller';
  if (/^src\/middlewares\//.test(normalizedPath)) return 'middleware';
  if (/^src\/services\//.test(normalizedPath)) return 'service';
  if (/^src\/database\//.test(normalizedPath)) return 'database';
  return 'other';
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function main() {
  if (!fs.existsSync(SRC_ROOT)) {
    throw new Error(`Source root not found: ${SRC_ROOT}`);
  }

  const files = walk(SRC_ROOT);
  const hardViolations = [];
  const advisories = [];
  const fanOut = [];

  for (const file of files) {
    const relativePath = relativeToRoot(file);
    const layer = getLayer(relativePath);
    const content = fs.readFileSync(file, 'utf8');
    const imports = getImports(content);

    const moduleContexts = Array.from(
      new Set(
        imports
          .map((value) => value.match(/modules\/([^/]+)\//)?.[1])
          .filter(Boolean)
      )
    );

    fanOut.push({
      path: relativePath,
      layer,
      moduleContexts: moduleContexts.length,
      imports: imports.length,
    });

    if (layer === 'domain') {
      for (const value of imports) {
        if (
          matchesAny(value, [
            /\/infra\//,
            /\/controllers\//,
            /\/routes\//,
            /\/database\//,
            /\/services\//,
          ])
        ) {
          hardViolations.push({
            path: relativePath,
            rule: 'Domain nao deve depender de infra, controllers, routes, database ou services',
            import: value,
          });
        }
      }
    }

    if (layer === 'route') {
      for (const value of imports) {
        if (
          matchesAny(value, [
            /database\/connection/,
            /\/database\//,
            /modules\/.+\/infra\//,
          ])
        ) {
          hardViolations.push({
            path: relativePath,
            rule: 'Routes nao devem depender diretamente de database ou infra',
            import: value,
          });
        }
      }
    }

    if (layer === 'controller') {
      for (const value of imports) {
        if (/\/routes\//.test(value)) {
          hardViolations.push({
            path: relativePath,
            rule: 'Controllers nao devem depender de routes',
            import: value,
          });
        }
        if (matchesAny(value, [/database\/connection/, /modules\/.+\/infra\//])) {
          hardViolations.push({
            path: relativePath,
            rule: 'Controllers nao devem importar database/infra diretamente',
            import: value,
          });
        }
      }
    }

    if (layer === 'middleware') {
      for (const value of imports) {
        if (matchesAny(value, [/\/routes\//, /\/controllers\//])) {
          hardViolations.push({
            path: relativePath,
            rule: 'Middlewares nao devem depender de routes ou controllers',
            import: value,
          });
        }
      }
    }
  }

  const highFanOut = fanOut
    .filter((entry) => entry.moduleContexts >= 2 || entry.imports >= 10)
    .sort((a, b) => b.moduleContexts - a.moduleContexts || b.imports - a.imports)
    .slice(0, 10);

  console.log('Disciplina arquitetural (backend) - fronteiras duras');
  if (hardViolations.length === 0) {
    console.log('- Nenhuma violacao dura encontrada.');
  } else {
    console.table(hardViolations);
  }

  console.log('\nDisciplina arquitetural (backend) - alertas consultivos');
  if (advisories.length === 0) {
    console.log('- Nenhum alerta consultivo encontrado.');
  } else {
    console.table(advisories);
  }

  console.log('\nArquivos com fan-out alto (consultivo)');
  if (highFanOut.length === 0) {
    console.log('- Nenhum arquivo acima do limite consultivo.');
  } else {
    console.table(highFanOut);
  }

  if (hardViolations.length > 0) {
    console.error(`Violacoes duras de fronteira arquitetural detectadas: ${hardViolations.length}`);
    process.exit(1);
  }

  console.log('Guard de disciplina arquitetural (backend) concluido.');
}

main();
