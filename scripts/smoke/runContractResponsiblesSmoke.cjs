/*
 * Exercises the HTTP contract surface against the local isolated smoke API.
 * It proves all five responsible brokers authenticate, list/read the contract,
 * mutate both sides and upload a document while AWAITING_DOCS; after the
 * workflow freezes they retain only metadata/document status visibility.
 */
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const apiBase = process.env.SMOKE_API_BASE || 'http://127.0.0.1:3334';
const smokeDatabase = process.env.SMOKE_DATABASE || 'imobiliaria_smoke_v2';
const contractId = '00000000-0000-4000-8000-000000000101';
const password = 'SmokePass!123';

function assertSmokeDatabase() {
  if (smokeDatabase !== 'imobiliaria_smoke_v2') {
    throw new Error(`Recusando alterar status fora do schema isolado. Recebido: ${smokeDatabase}`);
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(email) {
  const { response, body } = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.token, 'string', `token ausente para ${email}`);
  return body.token;
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function setContractStatus(status) {
  assertSmokeDatabase();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: smokeDatabase,
    ssl: false,
  });
  try {
    await connection.query('UPDATE contracts SET status = ? WHERE id = ?', [status, contractId]);
  } finally {
    await connection.end();
  }
}

async function assertOpenWorkflowForResponsible(number, token) {
  const headers = auth(token);
  const list = await request('/contracts/me', { headers });
  assert.equal(list.response.status, 200, `lista responsável ${number}: ${JSON.stringify(list.body)}`);
  assert.ok(Array.isArray(list.body.data), `lista inválida responsável ${number}`);
  assert.ok(list.body.data.some((item) => item.id === contractId), `contrato ausente para responsável ${number}`);

  const details = await request(`/contracts/${contractId}`, { headers });
  assert.equal(details.response.status, 200, `detalhe responsável ${number}: ${JSON.stringify(details.body)}`);
  const contract = details.body.contract ?? details.body;
  assert.equal(contract.capabilities?.canEditSeller, true, `seller bloqueado para responsável ${number}`);
  assert.equal(contract.capabilities?.canEditBuyer, true, `buyer bloqueado para responsável ${number}`);

  for (const side of ['seller', 'buyer']) {
    const payload = side === 'seller'
      ? { side, sellerInfo: { profissao: `Responsável ${number} - vendedor` } }
      : { side, buyerInfo: { profissao: `Responsável ${number} - comprador` } };
    const update = await request(`/contracts/${contractId}/data`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(update.response.status, 200, `PUT ${side} responsável ${number}: ${JSON.stringify(update.body)}`);
  }

  const form = new FormData();
  form.set('side', number % 2 === 0 ? 'buyer' : 'seller');
  form.set('documentType', 'outro');
  form.set('documentCategory', 'outro');
  form.set('file', new Blob([Buffer.from('%PDF-1.4\n% smoke document\n'.padEnd(2048, 'x'))], { type: 'application/pdf' }), `responsavel-${number}.pdf`);
  const upload = await request(`/contracts/${contractId}/documents`, {
    method: 'POST',
    headers,
    body: form,
  });
  assert.equal(upload.response.status, 201, `upload responsável ${number}: ${JSON.stringify(upload.body)}`);
}

async function assertFrozenStatusOnlyForResponsible(number, token) {
  const headers = auth(token);
  const list = await request('/contracts/me', { headers });
  assert.equal(list.response.status, 200, `lista congelada responsável ${number}: ${JSON.stringify(list.body)}`);
  assert.ok(list.body.data?.some((item) => item.id === contractId), `contrato congelado ausente para responsável ${number}`);
  const details = await request(`/contracts/${contractId}`, { headers });
  assert.equal(details.response.status, 200, `detalhe congelado responsável ${number}: ${JSON.stringify(details.body)}`);
  const contract = details.body.contract ?? details.body;
  assert.equal(contract.capabilities?.canEditSeller, false, `seller editável congelado responsável ${number}`);
  assert.equal(contract.capabilities?.canEditBuyer, false, `buyer editável congelado responsável ${number}`);
  assert.equal(contract.capabilities?.canReadDocumentFiles, false, `arquivos expostos ao responsável ${number}`);
  assert.deepEqual(contract.sellerInfo, {}, `dados do vendedor expostos ao responsável ${number}`);
  assert.deepEqual(contract.buyerInfo, {}, `dados do comprador expostos ao responsável ${number}`);

  const update = await request(`/contracts/${contractId}/data`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ side: 'seller', sellerInfo: { profissao: 'não deve salvar' } }),
  });
  assert.equal(update.response.status, 403, `PUT congelado responsável ${number}: ${JSON.stringify(update.body)}`);
  assert.equal(update.body.code, 'CONTRACT_READ_ONLY', `código de bloqueio ausente responsável ${number}`);

  const form = new FormData();
  form.set('side', 'seller');
  form.set('documentType', 'outro');
  form.set('documentCategory', 'outro');
  form.set('file', new Blob(['%PDF-1.4\nblocked'], { type: 'application/pdf' }), 'blocked.pdf');
  const upload = await request(`/contracts/${contractId}/documents`, {
    method: 'POST',
    headers,
    body: form,
  });
  assert.equal(upload.response.status, 403, `upload congelado responsável ${number}: ${JSON.stringify(upload.body)}`);
  assert.equal(upload.body.code, 'CONTRACT_READ_ONLY', `upload sem código de bloqueio responsável ${number}`);
}

async function assertParticipantSideIsolation() {
  const cases = [
    {
      label: 'comprador',
      email: 'smoke-buyer@example.test',
      allowedSide: 'buyer',
      forbiddenSide: 'seller',
    },
    {
      label: 'anunciante',
      email: 'smoke-advertiser@example.test',
      allowedSide: 'seller',
      forbiddenSide: 'buyer',
    },
    {
      label: 'proprietário',
      email: 'smoke-owner@example.test',
      allowedSide: 'seller',
      forbiddenSide: 'buyer',
    },
  ];

  for (const participant of cases) {
    const token = await login(participant.email);
    const headers = auth(token);
    const details = await request(`/contracts/${contractId}`, { headers });
    assert.equal(details.response.status, 200, `GET ${participant.label}: ${JSON.stringify(details.body)}`);
    const contract = details.body.contract ?? details.body;
    const allowedCapability = participant.allowedSide === 'seller' ? 'canEditSeller' : 'canEditBuyer';
    const forbiddenCapability = participant.forbiddenSide === 'seller' ? 'canEditSeller' : 'canEditBuyer';
    assert.equal(contract.capabilities?.[allowedCapability], true, `${participant.label} sem lado permitido`);
    assert.equal(contract.capabilities?.[forbiddenCapability], false, `${participant.label} recebeu lado indevido`);

    const allowedPayload = participant.allowedSide === 'seller'
      ? { side: 'seller', sellerInfo: { profissao: `Smoke ${participant.label}` } }
      : { side: 'buyer', buyerInfo: { profissao: `Smoke ${participant.label}` } };
    const allowedUpdate = await request(`/contracts/${contractId}/data`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(allowedPayload),
    });
    assert.equal(allowedUpdate.response.status, 200, `PUT permitido ${participant.label}: ${JSON.stringify(allowedUpdate.body)}`);

    const forbiddenPayload = participant.forbiddenSide === 'seller'
      ? { side: 'seller', sellerInfo: { profissao: 'não permitido' } }
      : { side: 'buyer', buyerInfo: { profissao: 'não permitido' } };
    const forbiddenUpdate = await request(`/contracts/${contractId}/data`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(forbiddenPayload),
    });
    assert.equal(forbiddenUpdate.response.status, 403, `PUT indevido ${participant.label}: ${JSON.stringify(forbiddenUpdate.body)}`);
  }
}

async function assertUnauthorizedActors() {
  for (const email of ['smoke-captor@example.test', 'smoke-outsider@example.test']) {
    const token = await login(email);
    const result = await request(`/contracts/${contractId}`, { headers: auth(token) });
    assert.equal(result.response.status, 403, `${email} não recebeu 403: ${JSON.stringify(result.body)}`);
  }
}

async function main() {
  await setContractStatus('AWAITING_DOCS');
  await assertParticipantSideIsolation();
  const tokens = [];
  for (let number = 1; number <= 5; number += 1) {
    const token = await login(`smoke-responsible-${number}@example.test`);
    await assertOpenWorkflowForResponsible(number, token);
    tokens.push(token);
  }
  await assertUnauthorizedActors();

  await setContractStatus('AWAITING_SIGNATURES');
  for (let number = 1; number <= 5; number += 1) {
    await assertFrozenStatusOnlyForResponsible(number, tokens[number - 1]);
  }

  console.log(JSON.stringify({
    ok: true,
    apiBase,
    contractId,
    validated: {
      responsibles: 5,
      participants: ['comprador somente buyer', 'anunciante somente seller', 'proprietário somente seller'],
      openWorkflow: ['GET /contracts/me', 'GET /contracts/:id', 'PUT seller', 'PUT buyer', 'POST document'],
      frozenWorkflow: ['GET metadata/status only', 'no PII/files', 'PUT returns 403 CONTRACT_READ_ONLY'],
      unauthorized: ['captor', 'outsider'],
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('CONTRACT_SMOKE_FAILED', error);
  process.exit(1);
});
