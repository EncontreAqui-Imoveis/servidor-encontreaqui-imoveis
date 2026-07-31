# Inventario de Autorizacao da API

Data da revisao: 2026-07-31

## Objetivo

Este inventario e a fonte de trabalho da Fase 2 do threat model. Cada rota
sensivel precisa ter uma decisao de acesso feita no servidor, uma fonte de
verdade persistida e cobertura HTTP negativa para BOLA e BFLA. O cliente nunca
concede permissao por `side`, CPF, nome ou papel enviado no payload.

## Papeis de referencia

| Papel | Definicao de acesso |
| --- | --- |
| Publico | Sem sessao; recebe somente DTO publico sem PII. |
| Proponente | `negotiations.proposer_id`; lado comprador quando a proposta foi iniciada por comprador. |
| Anunciante/proprietario | `negotiations.advertiser_id` ou `properties.owner_id`; lado vendedor. |
| Comprador legal | `negotiations.legal_buyer_user_id`; lado comprador somente apos handshake verificado. |
| Responsavel | Usuario presente em `negotiation_responsibles`; ambos os lados durante `AWAITING_DOCS`, apenas status nas fases seguintes. |
| Corretor sem vinculo | Nao recebe acesso contratual por ser captador, criador ou corretor em outro campo legado. |
| Auxiliar administrativo | Conta administrativa restrita pelas capabilities. |
| Admin | Conta administrativa com capability especifica da operacao. |

## Contratos e documentos

| Superficie | Rotas | Fonte de autorizacao | Regra | Cobertura atual | Acao da Fase 2 |
| --- | --- | --- | --- | --- | --- |
| Listagem pessoal | `GET /contracts/me`, `GET /contracts/counters` | `contractListingService` + `resolveContractAccessContext` | Somente contratos vinculados; cancelados ocultos para participantes. | Parcial | Comparar listagem com detalhe para todos os papeis. |
| Detalhe | `GET /contracts/:id`, `GET /contracts/negotiation/:negotiationId` | `contractAuthMiddleware` + `contractAccessResolver` | `seller`, `buyer`, responsavel ou admin; PII e documentos filtrados por lado. | Boa | Manter matriz por papel e por estado. |
| Imovel do contrato | `GET /contracts/negotiation/:negotiationId/property` | `ContractController.canAccessContract` | Mesmo vinculo do contrato; resposta de propriedade nao pode ampliar o acesso. | Sem teste HTTP dedicado | Adicionar BOLA para estranho, comprador, vendedor e responsavel. |
| Dados cadastrais | `PUT /contracts/:id/data` | `contractAuthMiddleware` + `contractDataUpdateService` | Somente o proprio lado; escrita congelada fora de `AWAITING_DOCS`, salvo admin. | Boa | Cobrir payload cruzado, campos fora de allowlist e concorrencia. |
| Documentos de qualificacao | `POST/DELETE /contracts/:id/documents/:documentId` | Contexto contratual + workflow guard + dono do documento | Participante envia somente o proprio lado; documento aprovado e somente leitura. | Boa | Lock de substituicao validado no TiDB local; falta equivalente HTTP de preview/download. |
| Revisao documental | `PATCH /contracts/:id/documents/:documentId/status` e rotas `/admin/contracts/*/review` | `isAdmin` + `review_documents` | Apenas operador com capability; rejeicao/substituicao mantem auditoria. | Parcial | BFLA para auxiliar restrito e admin sem capability. |
| Metodos e transicoes | `POST /contracts/:id/signature-method`, `PUT /admin/contracts/:id/transition`, `POST /admin/contracts/:id/finalize` | `isAdmin` + `manage_contract_workflow` | Fluxos administrativos; transicao deve validar estado atual. Finalizacao repetida com a mesma comissao e idempotente; valores divergentes retornam conflito. | Boa | Suite opt-in executada contra TiDB local para aprovacao, criacao e finalizacao; manter em regressao. |
| Responsavel operacional | `PATCH /contracts/negotiation/:negotiationId/selling-broker`, `PUT /admin/negotiations/:id/responsibles` | Servico administrativo transacional + pivot | Nao concede acesso por campo legado; a pivot e a fonte de verdade. | Parcial | BFLA de cliente/corretor e teste de 1 a 5 responsaveis. |

## Propostas e negociacoes

| Superficie | Rotas | Regra obrigatoria | Cobertura atual | Acao da Fase 2 |
| --- | --- | --- | --- | --- |
| Listagem e detalhe pessoal | `GET /negotiations/mine`, `GET /negotiations/me` | Filtrar por `proposer_id` ou `advertiser_id`, nunca por CPF/nome. | Parcial | BOLA para `propertyId` de terceiro e proposta cancelada. |
| Criacao | `POST /negotiations/proposal` | Proponente autenticado; propriedade publica/elegivel; rate limit e idempotencia de negocio. | Parcial | Testar duplicidade concorrente e tentativa com propriedade de terceiro. |
| Edicao e exclusao | `PUT/DELETE /negotiations/:id/draft` | Somente iniciador durante estado de rascunho permitido. | Parcial | BOLA e estado congelado. |
| Minuta e proposta assinada | `POST/GET /negotiations/:id/proposals*`, `POST /:id/proposals/signed` | Somente ator autorizado; downloads exigem a mesma verificacao do detalhe. | Download BOLA coberto no servico | Cobrir upload, replay/idempotencia e equivalente HTTP. |
| Documentos de proposta | `GET /negotiations/:id/documents/:documentId/download` | Mesmo vinculo da negociacao; objeto de storage nunca e autorizado so pelo ID. | BOLA e troca de ID entre negociacoes cobertas no servico | Adicionar equivalente HTTP e cobrir substituicao concorrente. |

## Imoveis, usuarios e notificacoes

| Superficie | Rotas | Regra obrigatoria | Cobertura atual | Acao da Fase 2 |
| --- | --- | --- | --- | --- |
| Catalogo publico | `GET /properties*` e `GET /public/properties/:id` | DTO publico, paginado e sem PII/IDs operacionais. | Boa | Fuzz de filtros e regressao de DTO. |
| Imovel autenticado | `GET /properties/:id`, `PUT/PATCH/DELETE /properties/:id` | Dono ou corretor autorizado no servico; estado em negociacao bloqueia edicao. | Parcial | BOLA de leitura, edicao, fechamento e exclusao. |
| Perfil e favoritos | `/users/me`, `/users/favorites/*`, `/users/notifications/*` | Sempre por `req.userId`; ignorar qualquer ID de usuario do corpo. | Parcial | BOLA de notificacao/favorito e mass assignment de perfil. |
| Busca de usuarios | `GET /users/search` | DTO minimo e acesso autenticado; nao expor dados de contato sem finalidade. | Parcial | Confirmar limites, paginacao e ausencia de PII nao necessaria. |

## Administrativo

| Superficie | Regra obrigatoria | Acao da Fase 2 |
| --- | --- | --- |
| `/admin/*` | `authMiddleware` + `isAdmin`; toda mutacao sensivel tambem exige capability. | Inventariar as mutacoes que ainda dependem somente de `isAdmin`. |
| Exclusoes | `delete` + reautenticacao quando aplicavel; auxiliar nao pode excluir entidades. | BFLA para auxiliar e admin sem capability. |
| Propriedades, corretores e usuarios | Capabilities por acao e dono definido no servico. | BOLA/BFLA de alterar/excluir recurso de terceiro. |
| Comissoes e finalizacao | Apenas fluxo administrativo; valores derivados e persistidos transacionalmente. | Testar duplicidade, corrida e leitura por corretor nao participante. |

## Matriz minima de testes HTTP

Para cada recurso privado, cada teste deve usar IDs reais de objetos de teste e
confirmar que a resposta negada nao contem PII, URL de storage nem metadados
operacionais.

| Ator | Leitura propria | Leitura de terceiro | Mutacao propria | Mutacao de terceiro | Funcao administrativa |
| --- | --- | --- | --- | --- | --- |
| Cliente/proponente | 200 quando vinculado | 403/404 | Permitida no estado aberto | 403 | 403 |
| Anunciante/proprietario | 200 no lado vendedor | 403/404 | Permitida no proprio lado/estado | 403 | 403 |
| Comprador legal pendente | Apenas metadados minimos | 403/404 | 403 ate handshake | 403 | 403 |
| Comprador legal verificado | 200 no lado comprador | 403/404 | Permitida no proprio lado/estado | 403 | 403 |
| Responsavel | Conforme pivot e workflow | 403/404 | Bilateral somente em `AWAITING_DOCS` | 403 | 403 sem capability |
| Corretor sem pivot | 403/404 | 403/404 | 403 | 403 | 403 |
| Auxiliar administrativo | Conforme capability | 403 quando capability ausente | Conforme capability | 403 quando capability ausente | 403 sem capability |
| Admin | 200 | 200 administrativo | Conforme capability/workflow | Conforme capability | Conforme capability |

## Ordem de execucao

1. Cobrir as rotas de download/preview e as duas rotas por `negotiationId` que
   ainda usam guard no controller ou servico.
2. Inventariar e testar mutacoes administrativas sem `requireAdminCapability`.
3. Executar a suite opt-in de concorrencia contra banco local para aprovacao, criacao
   de contrato, upload/substituicao e finalizacao/comissao. Os testes unitarios
   e contratuais ja cobrem reexecucao segura de aprovacao, criacao e finalizacao.
4. So entao iniciar a Fase 3 de upload/storage, usando esses testes como
   regressao de autorizacao.
