import connection from '../database/connection';
import { ensureBrazilianCityCatalogSeeded } from '../services/locationCatalogSeedService';

async function main(): Promise<void> {
  const seeded = await ensureBrazilianCityCatalogSeeded();
  console.log(
    seeded > 0
      ? `Catalogo nacional de municipios sincronizado: ${seeded} registros.`
      : 'Catalogo nacional de municipios ja esta sincronizado.'
  );
}

void main()
  .catch((error) => {
    console.error('Falha ao sincronizar catalogo nacional de municipios:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
