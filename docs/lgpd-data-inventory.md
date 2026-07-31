# Inventário de Dados Pessoais - Encontre Aqui

Status: base operacional; requer validação jurídica antes de ser tratada como
registro definitivo de conformidade.

## O que é este inventário

Este documento não contém dados de clientes. Ele mapeia categorias de dados,
finalidade, locais de armazenamento, acesso, destinatários e retenção. Serve
para responder onde um dado pode existir e como ele será eliminado ou
anonimizado quando aplicável.

## Papéis a formalizar

| Papel | Definição necessária |
|---|---|
| Controladora | Razão social, CNPJ e endereço da Encontre Aqui. |
| Encarregado | Nome ou empresa, e-mail/canal público e responsável substituto. |
| Operadores | Railway, TiDB, Redis, Cloudflare R2, Cloudinary, Firebase e Vercel, conforme o serviço efetivamente contratado. |
| Jurídico | Base legal, prazos de contrato finalizado e exceções à eliminação. |

## Mapa inicial de tratamento

| Categoria | Exemplos | Finalidade operacional | Sistemas | Acesso | Retenção proposta | Destino |
|---|---|---|---|---|---|---|
| Conta | nome, e-mail, telefone, hash de senha | cadastro, login e contato | TiDB, Firebase quando aplicável | titular, suporte autorizado | enquanto a conta existir, sujeito a decisão jurídica | anonimizar/excluir quando aplicável |
| Imóvel e anúncio | endereço, fotos, dados do anunciante | publicação e negociação | TiDB, Cloudinary/R2 | público apenas no DTO público; operador autorizado | enquanto anúncio/obrigação existir | excluir mídia e anonimizar referências quando aplicável |
| Proposta e contrato | qualificação, estado civil, valores e partes | execução da negociação/contrato | TiDB | partes autorizadas e painel por capability | definido pelo jurídico | arquivo legal restrito, anonimização ou exclusão |
| Documento aprovado | identidade, certidões, comprovantes e minuta | comprovação contratual | R2 privado e TiDB | lado contratual permitido, responsável e admin | definido pelo jurídico | exclusão segura ou arquivo legal restrito |
| Documento rejeitado | arquivo e referência | nenhum após a rejeição | R2 e TiDB | nenhum após decisão | imediato | exclusão lógica e física imediata; evento mínimo |
| Documento substituído | versão anterior | nenhum após novo upload confirmado | R2 e TiDB | nenhum após substituição | imediato após confirmação do novo arquivo | exclusão lógica e física imediata; evento mínimo |
| Notificação | texto operacional, IDs técnicos, token de dispositivo | informar ação e deep link | TiDB, Firebase | titular e serviços autorizados | 180 dias | exclusão |
| Segurança | hashes de limiter, sessão, OTP/PIN temporário | prevenção de abuso e autenticação | Redis/TiDB | backend restrito | TTL técnico | expiração automática |
| Auditoria mínima | ação, categoria, operador, data/hora e motivo | rastreabilidade operacional | TiDB | administradores autorizados | 2 anos, sujeito ao jurídico | exclusão ou anonimização |
| Logs | request ID, rota, erro sanitizado | diagnóstico e segurança | plataforma de logs | operação restrita | 30 dias; logs de segurança até 1 ano | rotação/exclusão |

## Regras inegociáveis

- Não registrar em logs, métricas, notificações ou webhooks: senha, JWT,
  PIN, OTP, CPF, telefone, e-mail, URL assinada, conteúdo ou nome original de
  documento.
- Documento rejeitado ou substituído perde acesso imediatamente; a remoção do
  R2 é disparada de imediato e retentada apenas se o provedor falhar.
- Um evento de auditoria não deve guardar arquivo, URL, CPF, conteúdo ou hash
  do documento, salvo justificativa jurídica formal.
- Não eliminar contrato finalizado ou documento aprovado sem prazo e exceção
  validados pelo jurídico.

## Revisão

Revisar este inventário a cada mudança de fornecedor, nova categoria de dado,
novo fluxo de documento ou a cada 12 meses.

## Interfaces de privacidade implementadas

As rotas autenticadas abaixo registram uma solicitacao sem executar exclusao ou
exportacao automaticamente:

| Rota | Uso |
|---|---|
| `POST /users/privacy/requests` | Registra `ACCESS`, `CORRECTION`, `DELETION`, `OPPOSITION` ou `PORTABILITY`. |
| `GET /users/privacy/requests/me` | Lista apenas as solicitacoes do usuario autenticado. |

O atendimento, a exportacao e qualquer eliminacao de contrato finalizado exigem
analise humana e fundamento documentado.
