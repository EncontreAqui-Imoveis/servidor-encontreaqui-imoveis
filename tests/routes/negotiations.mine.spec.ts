import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
  isBroker: (_req: any, _res: any, next: any) => next(),
  isClient: (_req: any, _res: any, next: any) => next(),
  isAdmin: (_req: any, _res: any, next: any) => next(),
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('GET /negotiations/mine', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the authenticated user negotiations in the site shape', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'buyer_client_id' },
          { column_name: 'selling_broker_id' },
          { column_name: 'client_name' },
          { column_name: 'client_cpf' },
          { column_name: 'updated_at' },
          { column_name: 'payment_details' },
        ],
      ])
      .mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 60102,
          property_title: 'Casa Central',
          property_city: 'Rio Verde',
          property_state: 'GO',
          property_image: 'https://res.cloudinary.com/demo/image/upload/casa.jpg',
          status: 'DOCUMENTATION_PHASE',
          client_name: 'Cliente 1',
          client_cpf: '11122233344',
          proposal_validity_date: '2026-03-20 10:00:00',
          created_at: '2026-03-10 10:00:00',
          updated_at: '2026-03-11 12:00:00',
        },
      ],
    ]);

    const response = await request(app).get('/negotiations/mine');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'neg-1',
        propertyId: 60102,
        propertyTitle: 'Casa Central',
        propertyCity: 'Rio Verde',
        propertyState: 'GO',
        propertyImage: 'https://res.cloudinary.com/demo/image/upload/casa.jpg',
        status: 'DOCUMENTATION_PHASE',
        clientName: 'Cliente 1',
        clientCpf: '11122233344',
      }),
    ]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const schemaSql = String(queryMock.mock.calls[0]?.[0] ?? '');
    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(schemaSql).toContain('information_schema.columns');
    expect(params).toEqual([]);
    const listParams = queryMock.mock.calls[1]?.[1] as unknown[];
    expect(listParams?.slice(0, 2)).toEqual([30003, 30003]);
  });

  it('uses schema-aware query for /negotiations/mine when optional columns are inspected', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'client_name' },
          { column_name: 'client_cpf' },
          { column_name: 'updated_at' },
          { column_name: 'payment_details' },
          { column_name: 'last_draft_edit_at' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-schema',
            property_id: 101,
            property_title: 'Apartamento Centro',
            property_city: 'Goiânia',
            property_state: 'GO',
            property_image: null,
            status: 'IN_NEGOTIATION',
            client_name: null,
            client_cpf: null,
            proposal_validity_date: null,
            created_at: '2026-03-01 10:00:00',
            updated_at: '2026-03-02 10:00:00',
            payment_details: JSON.stringify({
              details: {
                clientName: 'Cliente Legacy',
                clientCpf: '99988877766',
              },
            }),
          },
        ],
      ]);

    const response = await request(app).get('/negotiations/mine');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'neg-schema',
        propertyId: 101,
        propertyTitle: 'Apartamento Centro',
        status: 'IN_NEGOTIATION',
        clientName: 'Cliente Legacy',
        clientCpf: '99988877766',
      }),
    ]);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('is compatible with GET /negotiations/me as alias of /negotiations/mine', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'buyer_client_id' },
          { column_name: 'selling_broker_id' },
          { column_name: 'client_name' },
          { column_name: 'client_cpf' },
          { column_name: 'updated_at' },
          { column_name: 'payment_details' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-me',
            property_id: 70110,
            property_title: 'Casa Alias',
            property_city: 'Goiânia',
            property_state: 'GO',
            property_image: 'https://res.cloudinary.com/demo/image/upload/casa-alias.jpg',
            status: 'IN_NEGOTIATION',
            client_name: 'Cliente Alias',
            client_cpf: '22233344455',
            proposal_validity_date: '2026-06-01 10:00:00',
            created_at: '2026-05-01 10:00:00',
            updated_at: '2026-05-02 12:00:00',
          },
        ],
      ]);

    const response = await request(app).get('/negotiations/me');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'neg-me',
        propertyId: 70110,
        propertyTitle: 'Casa Alias',
        status: 'IN_NEGOTIATION',
      }),
    ]);
  });
});
