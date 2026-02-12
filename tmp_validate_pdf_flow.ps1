$ErrorActionPreference = 'Stop'

 $pdfPort = 19080
 $apiPort = 3399

$jwtLine = Select-String -Path 'D:\backend\.env' -Pattern '^JWT_SECRET=' | Select-Object -First 1
if (-not $jwtLine) {
  throw 'JWT_SECRET not found in D:\backend\.env'
}

$sharedSecret = ($jwtLine.Line -replace '^JWT_SECRET=', '').Trim()
if ([string]::IsNullOrWhiteSpace($sharedSecret)) {
  throw 'JWT_SECRET is empty in D:\backend\.env'
}

$pdfOut = "D:\backend\tmp_pdf${pdfPort}_out.log"
$pdfErr = "D:\backend\tmp_pdf${pdfPort}_err.log"
$apiOut = "D:\backend\tmp_api${apiPort}_out.log"
$apiErr = "D:\backend\tmp_api${apiPort}_err.log"
Remove-Item $pdfOut, $pdfErr, $apiOut, $apiErr -ErrorAction SilentlyContinue

$existingPdfConn = Get-NetTCPConnection -LocalPort $pdfPort -State Listen -ErrorAction SilentlyContinue
if ($existingPdfConn) {
  foreach ($conn in $existingPdfConn) {
    try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
  }
}

$existingApiConn = Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue
if ($existingApiConn) {
  foreach ($conn in $existingApiConn) {
    try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
  }
}

$pdfProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d D:\pdf-service && set JWT_SECRET=$sharedSecret&& set PORT=$pdfPort&& go run ./cmd/server/main.go" -PassThru -RedirectStandardOutput $pdfOut -RedirectStandardError $pdfErr
$apiProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d D:\backend && set JWT_SECRET=$sharedSecret&& set API_PORT=$apiPort&& set PDF_SERVICE_URL=http://localhost:$pdfPort&& set ENFORCE_HTTPS=false&& npm run dev" -PassThru -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr

try {
  Start-Sleep -Seconds 12
  $health = Invoke-WebRequest -Uri "http://localhost:$apiPort/health" -Method Get
  if ($health.StatusCode -ne 200) {
    throw "Temporary backend on :$apiPort not healthy. Status=$($health.StatusCode)"
  }

  $authToken = node -e "const jwt=require('jsonwebtoken'); const secret=process.argv[1]; process.stdout.write(jwt.sign({id:1, role:'admin'}, secret, {algorithm:'HS256', expiresIn:'10m'}));" "$sharedSecret"

  $negotiationId = @'
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');
dotenv.config();
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || process.env.DB_HOST,
    port: Number(process.env.DATABASE_PORT || process.env.DB_PORT || 4000),
    user: process.env.DATABASE_USER || process.env.DB_USER,
    password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DATABASE_NAME || process.env.DB_DATABASE,
    ssl: (process.env.DATABASE_SSL ?? process.env.DB_SSL ?? 'true') !== 'false' ? { rejectUnauthorized: true } : undefined,
  });
  const id = randomUUID();
  await conn.query(`INSERT INTO negotiations (id, property_id, capturing_broker_id, status, version) VALUES (?, 101, 1, 'PROPOSAL_DRAFT', 0)`, [id]);
  process.stdout.write(id);
  await conn.end();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
'@ | node -

  $body = @{
    clientName      = 'Joao da Silva (Comprador)'
    clientCpf       = '111.222.333-44'
    propertyAddress = 'Av. Paulista, 1000 - Apto 55'
    brokerName      = 'Seu Nome (Corretor)'
    value           = 450000.00
    paymentMethod   = 'Entrada de 20% + Financiamento'
    validityDays    = 5
  } | ConvertTo-Json

  try {
    $postResponse = Invoke-WebRequest -Uri "http://localhost:$apiPort/negotiations/$negotiationId/proposals" -Method Post -ContentType 'application/json' -Body $body -Headers @{ Authorization = "Bearer $authToken" }
  } catch {
    $errorBody = ''
    if ($_.Exception.Response) {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $errorBody = $reader.ReadToEnd()
      $reader.Close()
    }
    throw "POST /negotiations/:id/proposals failed: $($_.Exception.Message) BODY=$errorBody"
  }

  $docRowJson = @'
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const negId = process.argv[2];
dotenv.config();
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || process.env.DB_HOST,
    port: Number(process.env.DATABASE_PORT || process.env.DB_PORT || 4000),
    user: process.env.DATABASE_USER || process.env.DB_USER,
    password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DATABASE_NAME || process.env.DB_DATABASE,
    ssl: (process.env.DATABASE_SSL ?? process.env.DB_SSL ?? 'true') !== 'false' ? { rejectUnauthorized: true } : undefined,
  });
  const [rows] = await conn.query(
    'SELECT id, negotiation_id, type, OCTET_LENGTH(file_content) AS size_bytes FROM negotiation_documents WHERE negotiation_id = ? ORDER BY id DESC LIMIT 1',
    [negId]
  );
  process.stdout.write(JSON.stringify(rows));
  await conn.end();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
'@ | node - $negotiationId

  @'
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const negId = process.argv[2];
dotenv.config();
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || process.env.DB_HOST,
    port: Number(process.env.DATABASE_PORT || process.env.DB_PORT || 4000),
    user: process.env.DATABASE_USER || process.env.DB_USER,
    password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DATABASE_NAME || process.env.DB_DATABASE,
    ssl: (process.env.DATABASE_SSL ?? process.env.DB_SSL ?? 'true') !== 'false' ? { rejectUnauthorized: true } : undefined,
  });
  await conn.query('DELETE FROM negotiations WHERE id = ?', [negId]);
  await conn.end();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
'@ | node - $negotiationId

  Write-Output "NEGOTIATION_ID=$negotiationId"
  Write-Output "API_PORT=$apiPort API_STATUS=$($postResponse.StatusCode)"
  Write-Output "API_BODY=$($postResponse.Content)"
  Write-Output "DB_DOC_ROW=$docRowJson"
} finally {
  try { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  try { Stop-Process -Id $pdfProc.Id -Force -ErrorAction SilentlyContinue } catch {}

  $killApiConns = Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue
  if ($killApiConns) {
    foreach ($conn in $killApiConns) {
      try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  $killPdfConns = Get-NetTCPConnection -LocalPort $pdfPort -State Listen -ErrorAction SilentlyContinue
  if ($killPdfConns) {
    foreach ($conn in $killPdfConns) {
      try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}
