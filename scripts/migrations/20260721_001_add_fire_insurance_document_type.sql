-- +migrate Up
-- Keep the historical comprovante_garantia value even though it is no longer
-- part of the active requirement matrix. Existing records must remain readable.
ALTER TABLE negotiation_documents
  MODIFY COLUMN document_type ENUM(
    'doc_identidade',
    'doc_identidade_conjuge',
    'comprovante_endereco',
    'certidao_casamento_nascimento',
    'certidao_inteiro_teor',
    'certidao_onus_acoes',
    'comprovante_renda',
    'comprovante_garantia',
    'seguro_incendio',
    'dados_bancarios',
    'contrato_minuta',
    'contrato_assinado',
    'comprovante_pagamento',
    'boleto_vistoria',
    'outro',
    'cliente_cnh',
    'cliente_identidade',
    'cliente_cpf',
    'cliente_outro_01',
    'cliente_outro_02',
    'cliente_outro_03',
    'cliente_outro_04',
    'cliente_outro_05',
    'cliente_outro_06',
    'cliente_outro_07',
    'cliente_outro_08',
    'cliente_outro_09',
    'cliente_outro_10',
    'cliente_outro_11',
    'cliente_outro_12',
    'cliente_outro_13',
    'cliente_outro_14',
    'cliente_outro_15',
    'cliente_outro_16',
    'cliente_outro_17',
    'cliente_outro_18',
    'cliente_outro_19',
    'cliente_outro_20'
  ) NULL;

-- +migrate Down
-- No-op intentionally: removing an ENUM member can corrupt historical
-- insurance records. Rollback of application code remains safe because the
-- stored document_type is still preserved as an opaque legacy value.
SELECT 1;
