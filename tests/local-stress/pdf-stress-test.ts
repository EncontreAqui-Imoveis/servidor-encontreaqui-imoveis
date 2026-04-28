import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3333';
const AUTH_TOKEN = process.env.STRESS_AUTH_TOKEN; // Needs a valid token
const CONCURRENCY = 20;

async function runStressTest() {
  if (!AUTH_TOKEN) {
    console.error('STRESS_AUTH_TOKEN is required. Run with STRESS_AUTH_TOKEN=... ts-node tests/local-stress/pdf-stress-test.ts');
    process.exit(1);
  }

  console.log(`Starting stress test with ${CONCURRENCY} concurrent PDF requests...`);

  const startTime = Date.now();
  const requests = Array.from({ length: CONCURRENCY }).map((_, i) => {
    return axios.post(`${API_URL}/negotiations/proposal-wizard`, {
      propertyId: 1, // Assuming property 1 exists
      clientName: `Stress Test ${i}`,
      clientCpf: '12345678901',
      validadeDias: 10,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 0,
        outros: 0
      },
      idempotency_key: `stress-test-${Date.now()}-${i}`
    }, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`
      }
    }).catch(err => {
      return { status: err.response?.status || 'ERROR', error: err.message };
    });
  });

  const results = await Promise.all(requests);
  const duration = (Date.now() - startTime) / 1000;

  const successCount = results.filter(r => (r as any).status === 202 || (r as any).status === 201).length;
  const failureCount = results.length - successCount;

  console.log('\n--- Stress Test Results ---');
  console.log(`Total Requests: ${CONCURRENCY}`);
  console.log(`Successes: ${successCount}`);
  console.log(`Failures: ${failureCount}`);
  console.log(`Total Duration: ${duration.toFixed(2)}s`);
  console.log(`Average latency per response: ${(duration / CONCURRENCY).toFixed(2)}s`);
  console.log('---------------------------');
}

runStressTest();
