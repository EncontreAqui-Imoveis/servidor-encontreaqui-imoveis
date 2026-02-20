import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import connection from '../database/connection';
import type { AuthRequest } from '../middlewares/auth';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import { ExternalPdfService } from '../modules/negotiations/infra/ExternalPdfService';
import { NegotiationDocumentsRepository } from '../modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../modules/negotiations/infra/NegotiationRepository';
import { createAdminNotification } from '../services/notificationService';

interface NegotiationRow extends RowDataPacket {
  id: string;
  status: string;
}

interface NegotiationUploadRow extends RowDataPacket {
  id: string;
  property_id: number;
  status: string;
  capturing_broker_id: number;
  selling_broker_id: number | null;
  property_title: string | null;
  broker_name: string | null;
}

interface BrokerRow extends RowDataPacket {
  name: string;
}

interface PropertyRow extends RowDataPacket {
  id: number;
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
}

interface ProposalBody {
  clientName?: unknown;
  client_name?: unknown;
  clientCpf?: unknown;
  client_cpf?: unknown;
  propertyAddress?: unknown;
  property_address?: unknown;
  brokerName?: unknown;
  broker_name?: unknown;
  sellingBrokerName?: unknown;
  selling_broker_name?: unknown;
  value?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
  payment?: {
    cash?: unknown;
    tradeIn?: unknown;
    trade_in?: unknown;
    financing?: unknown;
    others?: unknown;
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
  validityDays?: unknown;
  validity_days?: unknown;
}

interface ProposalWizardBody {
  propertyId?: unknown;
  clientName?: unknown;
  clientCpf?: unknown;
  validadeDias?: unknown;
  sellerBrokerId?: unknown;
  pagamento?: {
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
}

interface ParsedProposalWizard {
  propertyId: number;
  clientName: string;
  clientCpf: string;
  validadeDias: number;
  sellerBrokerId: number | null;
  pagamento: {
    dinheiro: number;
    permuta: number;
    financiamento: number;
    outros: number;
  };
}

const executor: SqlExecutor = {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T | [T, unknown]> {
    return connection.execute(sql, params as unknown[]) as unknown as Promise<T | [T, unknown]>;
  },
};

const ACTIVE_NEGOTIATION_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
] as const;

const DEFAULT_WIZARD_STATUS = 'PROPOSAL_SENT';
const SIGNED_PROPOSAL_REVIEW_STATUS = 'DOCUMENTATION_PHASE';
const SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS = new Set([
  'PROPOSAL_SENT',
  'AWAITING_SIGNATURES',
]);
const pdfService = new ExternalPdfService();
const negotiationDocumentsRepository = new NegotiationDocumentsRepository(executor);

function toCents(value: number): number {
  return Math.round(value * 100);
}

function parsePositiveNumber(input: unknown, fieldName: string): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} deve ser um numero maior ou igual a zero.`);
  }
  return parsed;
}

function parseProposalData(body: ProposalBody): ProposalData {
  const clientName = String(body.clientName ?? body.client_name ?? '').trim();
  const clientCpf = String(body.clientCpf ?? body.client_cpf ?? '').trim();
  const propertyAddress = String(body.propertyAddress ?? body.property_address ?? '').trim();
  const brokerName = String(body.brokerName ?? body.broker_name ?? '').trim();
  const rawSellingBrokerName = body.sellingBrokerName ?? body.selling_broker_name;
  const sellingBrokerName = rawSellingBrokerName == null ? null : String(rawSellingBrokerName).trim();
  const numericValue = Number(body.value);
  const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
  const validityDays = Number(body.validityDays ?? body.validity_days ?? 10);
  const payment = body.payment ?? {};

  const parsePaymentField = (fieldName: string, ...values: unknown[]): number => {
    const firstDefined = values.find(
      (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (firstDefined === undefined) {
      return 0;
    }
    return parsePositiveNumber(firstDefined, fieldName);
  };

  let cash = parsePaymentField('payment.cash', payment.cash, payment.dinheiro);
  const tradeIn = parsePaymentField('payment.trade_in', payment.trade_in, payment.tradeIn, payment.permuta);
  const financing = parsePaymentField(
    'payment.financing',
    payment.financing,
    payment.financiamento
  );
  const others = parsePaymentField('payment.others', payment.others, payment.outros);

  if (!clientName || !clientCpf || !propertyAddress || !brokerName) {
    throw new Error(
      'Campos obrigatorios ausentes. Informe client_name, client_cpf, property_address e broker_name.'
    );
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error('Campo value deve ser um numero maior que zero.');
  }

  if (!Number.isInteger(validityDays) || validityDays <= 0) {
    throw new Error('Campo validity_days deve ser um inteiro maior que zero.');
  }

  let paymentTotal = cash + tradeIn + financing + others;
  if (paymentTotal <= 0) {
    // Compatibilidade retroativa: payload legado sem objeto payment.
    cash = numericValue;
    paymentTotal = numericValue;
  }

  if (toCents(paymentTotal) !== toCents(numericValue)) {
    throw new Error('payment breakdown must match total value');
  }

  return {
    clientName,
    clientCpf,
    propertyAddress,
    brokerName,
    sellingBrokerName: sellingBrokerName || null,
    value: numericValue,
    payment: {
      cash,
      tradeIn,
      financing,
      others,
    },
    paymentMethod: paymentMethod || undefined,
    validityDays,
  };
}

function parseProposalWizardBody(body: ProposalWizardBody): ParsedProposalWizard {
  const propertyId = Number(body.propertyId);
  const clientName = String(body.clientName ?? '').trim();
  const clientCpfDigits = String(body.clientCpf ?? '').replace(/\D/g, '');
  const validadeDiasRaw = body.validadeDias ?? 10;
  const validadeDias = Number(validadeDiasRaw);
  const sellerBrokerIdRaw = body.sellerBrokerId;
  const sellerBrokerId =
    sellerBrokerIdRaw === undefined || sellerBrokerIdRaw === null || sellerBrokerIdRaw === ''
      ? null
      : Number(sellerBrokerIdRaw);
  const pagamento = body.pagamento ?? {};
  const dinheiro = parsePositiveNumber(pagamento.dinheiro ?? 0, 'pagamento.dinheiro');
  const permuta = parsePositiveNumber(pagamento.permuta ?? 0, 'pagamento.permuta');
  const financiamento = parsePositiveNumber(
    pagamento.financiamento ?? 0,
    'pagamento.financiamento'
  );
  const outros = parsePositiveNumber(pagamento.outros ?? 0, 'pagamento.outros');

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new Error('propertyId invalido.');
  }

  if (!clientName) {
    throw new Error('clientName e obrigatorio.');
  }

  if (clientCpfDigits.length != 11) {
    throw new Error('clientCpf invalido. Informe 11 digitos.');
  }

  if (!Number.isInteger(validadeDias) || validadeDias <= 0) {
    throw new Error('validadeDias deve ser um inteiro maior que zero.');
  }

  if (sellerBrokerId !== null && (!Number.isInteger(sellerBrokerId) || sellerBrokerId <= 0)) {
    throw new Error('sellerBrokerId invalido.');
  }

  return {
    propertyId,
    clientName,
    clientCpf: clientCpfDigits,
    validadeDias,
    sellerBrokerId,
    pagamento: {
      dinheiro,
      permuta,
      financiamento,
      outros,
    },
  };
}

function resolvePropertyAddress(row: PropertyRow): string {
  const parts = [
    row.address,
    row.numero ? `Nº ${row.numero}` : null,
    row.bairro,
    row.city,
    row.state,
    row.quadra ? `Quadra ${row.quadra}` : null,
    row.lote ? `Lote ${row.lote}` : null,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  return parts.join(', ');
}

function resolvePropertyValue(row: PropertyRow): number {
  const sale = Number(row.price_sale ?? 0);
  const rent = Number(row.price_rent ?? 0);
  const fallback = Number(row.price ?? 0);
  const resolved = sale > 0 ? sale : rent > 0 ? rent : fallback;
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}

function buildProposalValidityDate(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function sanitizeDownloadFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return 'documento.pdf';
  }
  return sanitized;
}

function buildAttachmentDisposition(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

class NegotiationController {
  async generateProposal(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociacao invalido.' });
    }

    let proposalData: ProposalData;
    try {
      proposalData = parseProposalData((req.body ?? {}) as ProposalBody);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }

    try {
      const [negotiationRows] = await connection.query<NegotiationRow[]>(
        'SELECT id FROM negotiations WHERE id = ? LIMIT 1',
        [negotiationId]
      );

      if (!negotiationRows.length) {
        return res.status(404).json({ error: 'Negociacao nao encontrada.' });
      }

      await connection.execute(
        `
          UPDATE negotiations
          SET
            client_name = ?,
            client_cpf = ?
          WHERE id = ?
        `,
        [proposalData.clientName, proposalData.clientCpf, negotiationId]
      );

      const pdfBuffer = await pdfService.generateProposal(proposalData);
      const documentId = await negotiationDocumentsRepository.saveProposal(
        negotiationId,
        pdfBuffer,
        undefined,
        {
          originalFileName: 'proposta.pdf',
          generated: true,
        }
      );

      return res.status(201).json({
        id: documentId,
        message: 'Proposta gerada e armazenada com sucesso.',
        negotiationId,
        sizeBytes: pdfBuffer.length,
      });
    } catch (error) {
      console.error('Erro ao gerar/salvar proposta em BLOB:', error);
      return res.status(500).json({ error: 'Falha ao gerar e salvar proposta.' });
    }
  }

  async generateProposalFromProperty(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    let payload: ParsedProposalWizard;
    try {
      payload = parseProposalWizardBody((req.body ?? {}) as ProposalWizardBody);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }

    let tx: PoolConnection | null = null;
    try {
      tx = await connection.getConnection();
      await tx.beginTransaction();

      const [propertyRows] = await tx.query<PropertyRow[]>(
        `
          SELECT
            id,
            address,
            numero,
            quadra,
            lote,
            bairro,
            city,
            state,
            price,
            price_sale,
            price_rent
          FROM properties
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [payload.propertyId]
      );

      const property = propertyRows[0];
      if (!property) {
        await tx.rollback();
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const propertyValue = resolvePropertyValue(property);
      if (propertyValue <= 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'Imovel sem valor valido para gerar proposta.' });
      }

      const paymentTotal =
        payload.pagamento.dinheiro +
        payload.pagamento.permuta +
        payload.pagamento.financiamento +
        payload.pagamento.outros;

      if (toCents(paymentTotal) !== toCents(propertyValue)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'A soma dos pagamentos deve ser exatamente igual ao valor do imovel.',
          propertyValue,
          paymentTotal,
        });
      }

      const [brokerRows] = await tx.query<BrokerRow[]>(
        'SELECT name FROM users WHERE id = ? LIMIT 1',
        [req.userId]
      );
      const brokerName = String(brokerRows[0]?.name ?? '').trim();
      if (!brokerName) {
        await tx.rollback();
        return res.status(400).json({ error: 'Corretor nao encontrado para gerar proposta.' });
      }

      const sellerBrokerId = payload.sellerBrokerId ?? req.userId;
      let sellingBrokerName = brokerName;
      if (sellerBrokerId !== req.userId) {
        const [sellerRows] = await tx.query<BrokerRow[]>(
          `
            SELECT u.name
            FROM brokers b
            JOIN users u ON u.id = b.id
            WHERE b.id = ? AND b.status = 'approved'
            LIMIT 1
          `,
          [sellerBrokerId]
        );
        sellingBrokerName = String(sellerRows[0]?.name ?? '').trim();
        if (!sellingBrokerName) {
          await tx.rollback();
          return res.status(400).json({ error: 'Corretor vendedor invalido ou nao aprovado.' });
        }
      }

      const [existingRows] = await tx.query<NegotiationRow[]>(
        `
          SELECT id, status
          FROM negotiations
          WHERE property_id = ?
            AND status IN (${ACTIVE_NEGOTIATION_STATUSES.map(() => '?').join(', ')})
          LIMIT 1
          FOR UPDATE
        `,
        [payload.propertyId, ...ACTIVE_NEGOTIATION_STATUSES]
      );

      const paymentDetails = JSON.stringify({
        method: 'OTHER',
        amount: Number(propertyValue.toFixed(2)),
        details: {
          ...payload.pagamento,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
        },
      });
      const proposalValidityDate = buildProposalValidityDate(payload.validadeDias);

      let negotiationId = '';
      let fromStatus = 'PROPOSAL_DRAFT';

      if (existingRows.length > 0) {
        negotiationId = existingRows[0].id;
        fromStatus = existingRows[0].status;
        await tx.execute(
          `
            UPDATE negotiations
            SET
              capturing_broker_id = ?,
              selling_broker_id = ?,
              buyer_client_id = NULL,
              client_name = ?,
              client_cpf = ?,
              status = ?,
              final_value = ?,
              payment_details = CAST(? AS JSON),
              proposal_validity_date = ?,
              version = version + 1
            WHERE id = ?
          `,
          [
            req.userId,
            sellerBrokerId,
            payload.clientName,
            payload.clientCpf,
            DEFAULT_WIZARD_STATUS,
            propertyValue,
            paymentDetails,
            proposalValidityDate,
            negotiationId,
          ]
        );
      } else {
        negotiationId = randomUUID();
        await tx.execute(
          `
            INSERT INTO negotiations (
              id,
              property_id,
              capturing_broker_id,
              selling_broker_id,
              buyer_client_id,
              client_name,
              client_cpf,
              status,
              final_value,
              payment_details,
              proposal_validity_date,
              version
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, CAST(? AS JSON), ?, 0)
          `,
          [
            negotiationId,
            payload.propertyId,
            req.userId,
            sellerBrokerId,
            payload.clientName,
            payload.clientCpf,
            DEFAULT_WIZARD_STATUS,
            propertyValue,
            paymentDetails,
            proposalValidityDate,
          ]
        );
      }

      await tx.execute(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          fromStatus,
          DEFAULT_WIZARD_STATUS,
          req.userId,
          JSON.stringify({
            source: 'mobile_proposal_wizard',
            payment: payload.pagamento,
            sellerBrokerId,
            clientName: payload.clientName,
            clientCpf: payload.clientCpf,
          }),
        ]
      );

      const proposalData: ProposalData = {
        clientName: payload.clientName,
        clientCpf: payload.clientCpf,
        propertyAddress: resolvePropertyAddress(property),
        brokerName,
        sellingBrokerName,
        value: propertyValue,
        payment: {
          cash: payload.pagamento.dinheiro,
          tradeIn: payload.pagamento.permuta,
          financing: payload.pagamento.financiamento,
          others: payload.pagamento.outros,
        },
        validityDays: payload.validadeDias,
      };

      const pdfBuffer = await pdfService.generateProposal(proposalData);
      const documentId = await negotiationDocumentsRepository.saveProposal(
        negotiationId,
        pdfBuffer,
        tx as unknown as SqlExecutor,
        {
          originalFileName: 'proposta.pdf',
          generated: true,
        }
      );

      await tx.commit();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="proposal_${negotiationId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length.toString());
      res.setHeader('X-Negotiation-Id', negotiationId);
      res.setHeader('X-Document-Id', String(documentId));
      return res.status(201).send(pdfBuffer);
    } catch (error) {
      if (tx) {
        await tx.rollback();
      }
      console.error('Erro ao gerar proposta por imovel:', error);
      return res.status(500).json({ error: 'Falha ao gerar proposta.' });
    } finally {
      tx?.release();
    }
  }

  async uploadSignedProposal(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'PDF assinado não enviado.' });
    }

    const mime = String(uploadedFile.mimetype ?? '').toLowerCase();
    if (mime && mime !== 'application/pdf') {
      return res.status(400).json({ error: 'Arquivo inválido. Envie apenas PDF assinado.' });
    }

    let tx: PoolConnection | null = null;
    try {
      tx = await connection.getConnection();
      await tx.beginTransaction();

      const [negotiationRows] = await tx.query<NegotiationUploadRow[]>(
        `
          SELECT
            n.id,
            n.property_id,
            n.status,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title,
            u.name AS broker_name
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          LEFT JOIN users u ON u.id = n.capturing_broker_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      const negotiation = negotiationRows[0];
      if (!negotiation) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const isAuthorizedBroker =
        req.userId === Number(negotiation.capturing_broker_id) ||
        req.userId === Number(negotiation.selling_broker_id ?? 0);
      if (!isAuthorizedBroker) {
        await tx.rollback();
        return res.status(403).json({ error: 'Você não possui permissão para enviar esta proposta.' });
      }

      const currentStatus = String(negotiation.status ?? '').trim().toUpperCase();
      if (!SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS.has(currentStatus)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'A proposta assinada só pode ser enviada enquanto aguarda assinatura.',
        });
      }

      const documentId = await negotiationDocumentsRepository.saveSignedProposal(
        negotiationId,
        uploadedFile.buffer,
        tx as unknown as SqlExecutor,
        {
          originalFileName: uploadedFile.originalname ?? 'proposta_assinada.pdf',
          uploadedBy: Number(req.userId ?? 0) || null,
          uploadedAt: new Date().toISOString(),
        }
      );

      await tx.execute(
        `
          UPDATE negotiations
          SET status = ?, version = version + 1
          WHERE id = ?
        `,
        [SIGNED_PROPOSAL_REVIEW_STATUS, negotiationId]
      );

      await tx.execute(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          )
          VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          currentStatus,
          SIGNED_PROPOSAL_REVIEW_STATUS,
          req.userId,
          JSON.stringify({
            action: 'signed_proposal_uploaded',
            documentId,
            filename: uploadedFile.originalname ?? null,
          }),
        ]
      );

      await tx.commit();

      const propertyTitle = String(negotiation.property_title ?? '').trim() || 'Imóvel sem título';
      const brokerName = String(negotiation.broker_name ?? `#${req.userId}`);
      await createAdminNotification({
        type: 'negotiation',
        title: `Proposta Enviada: ${propertyTitle}`,
        message: `O corretor ${brokerName} enviou uma proposta assinada para o imóvel ${propertyTitle}.`,
        relatedEntityId: Number(negotiation.property_id),
        metadata: {
          negotiationId,
          propertyId: Number(negotiation.property_id),
          brokerId: req.userId,
          documentId,
        },
      });

      return res.status(201).json({
        message: 'Proposta assinada enviada com sucesso. Em análise.',
        status: 'UNDER_REVIEW',
        negotiationId,
        documentId,
      });
    } catch (error) {
      if (tx) {
        await tx.rollback();
      }
      console.error('Erro ao enviar proposta assinada:', error);
      return res.status(500).json({ error: 'Falha ao enviar proposta assinada.' });
    } finally {
      tx?.release();
    }
  }

  async downloadDocument(req: Request, res: Response): Promise<Response> {
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return res.status(400).json({ error: 'ID de documento invalido.' });
    }

    try {
      const document = await negotiationDocumentsRepository.findById(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Documento nao encontrado.' });
      }

      const contentType =
        document.type === 'proposal' || document.type === 'contract'
          ? 'application/pdf'
          : 'application/octet-stream';

      const metadata = parseJsonObjectSafe(document.metadataJson);
      const originalFileName = String(metadata.originalFileName ?? '').trim();
      const fallbackPrefix = String(document.documentType ?? document.type ?? 'documento')
        .trim()
        .toLowerCase();
      const extension = contentType === 'application/pdf' ? '.pdf' : '';
      const fallbackName = `${fallbackPrefix || 'documento'}_${documentId}${extension}`;
      const filename = originalFileName || fallbackName;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', buildAttachmentDisposition(filename));
      res.setHeader('Content-Length', document.fileContent.length.toString());

      return res.send(document.fileContent);
    } catch (error) {
      console.error('Erro ao baixar documento da negociacao:', error);
      return res.status(500).json({ error: 'Falha ao baixar documento.' });
    }
  }

  async downloadLatestProposal(req: Request, res: Response): Promise<Response> {
    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    try {
      const document = await negotiationDocumentsRepository.findLatestByNegotiationAndType(
        negotiationId,
        'proposal'
      );
      if (!document) {
        return res.status(404).json({ error: 'Nenhuma proposta encontrada para esta negociação.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="proposta.pdf"');
      res.setHeader('Content-Length', document.fileContent.length.toString());
      res.setHeader('X-Document-Id', String(document.id));

      return res.send(document.fileContent);
    } catch (error) {
      console.error('Erro ao baixar proposta da negociação:', error);
      return res.status(500).json({ error: 'Falha ao baixar proposta.' });
    }
  }
}

export const negotiationController = new NegotiationController();
