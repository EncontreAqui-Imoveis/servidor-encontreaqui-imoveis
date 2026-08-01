# Relatorio de seguranca local - Fase 7

Data: 2026-08-01
Escopo: backend Node.js/Express, Dockerfile e workflows GitHub. Os scans usaram
somente o workspace local e nao enviaram requests para Railway, TiDB, R2 ou
Firebase de producao.

## Resumo executivo

- Gitleaks: nenhum segredo encontrado em 570 commits.
- ZAP baseline em `http://127.0.0.1:3333/health`: nenhuma falha; um aviso de
  resposta publica cacheavel, sem dado sensivel.
- Semgrep: 16 achados, concentrados em fixacao de Actions, higiene de Docker e
  chaves JWT deliberadamente fixas em testes.
- Trivy/npm audit: dependencias produtivas com 2 achados criticos e 11 altos.
  As correcoes devem ser feitas de forma controlada e testada, sobretudo para
  `firebase-admin` e `nodemailer`, que podem exigir atualizacao major.

## Achados

### SEC-001 - Dependencias produtivas criticas

- Severidade: Critica
- Evidencia: `protobufjs@7.5.4` e `websocket-driver@0.7.4` no lockfile,
  introduzidos transitivamente por `firebase-admin@13.7.0`.
- Impacto: processadores de payload protobuf/WebSocket vulneraveis podem
  permitir negacao de servico quando a funcionalidade dependente processa
  entrada hostil.
- Correcao: atualizar `firebase-admin` de forma isolada, ou aplicar overrides
  compativeis para as versoes corrigidas, rodando build, testes e smoke de
  notificacoes Firebase antes do deploy.
- Nota: nao executar `npm audit fix --force`; ele pode atualizar dependencias
  major sem validar os fluxos de push.

### SEC-002 - Dependencias produtivas altas

- Severidade: Alta
- Evidencia: `axios@1.13.6`, `multer@2.1.1`, `node-forge@1.3.3`,
  `path-to-regexp@8.3.0` e dependencias transitivas de Firebase/AWS foram
  reportadas pelo Trivy e `npm audit --omit=dev`.
- Impacto: inclui riscos de DoS e comportamento inseguro no processamento de
  requests, uploads e integracoes externas.
- Correcao: atualizar primeiro dependencias diretas sem major (`axios`,
  `multer`), depois tratar a cadeia Firebase/AWS em uma alteracao separada.
  `nodemailer` requer versao major e deve ter smoke de envio em sandbox.

### SEC-003 - GitHub Actions usam tags mutaveis

- Severidade: Media
- Local: `.github/workflows/quality_gates.yml:18,21`,
  `.github/workflows/release_preflight.yml:17,20,26,71` e
  `.github/workflows/security_sast.yml:18,21,36,39`.
- Evidencia: Actions externas referenciadas por tag, como `@v4`, sem SHA.
- Impacto: uma alteracao indevida da tag por terceiro pode afetar a cadeia de
  CI.
- Correcao: fixar cada Action em SHA de commit e manter comentario com a tag
  legivel correspondente.

### SEC-004 - Imagem executa como root e nao declara healthcheck

- Severidade: Media (root) / Baixa (healthcheck)
- Local: `Dockerfile:16`.
- Evidencia: Trivy DS-0002 e DS-0026.
- Impacto: uma exploracao dentro do container teria privilegios maiores que o
  necessario; a ausencia de healthcheck reduz a deteccao de falha no runtime.
- Correcao: criar usuario sem privilegios, garantir permissao somente aos
  diretorios gravaveis e declarar `HEALTHCHECK` para `/health`.

### SEC-005 - Dependabot sem cooldown

- Severidade: Baixa
- Local: `.github/dependabot.yml:3,18`.
- Evidencia: duas regras sem cooldown.
- Impacto: pode abrir varias atualizacoes consecutivas e gerar ruido de CI.
- Correcao: definir cooldown e limites de PR; nao e vulnerabilidade de runtime.

### SEC-006 - JWT fixo em testes

- Severidade: Informativa (falso positivo de teste)
- Local: `tests/middlewares/auth.middleware.spec.ts:28`,
  `tests/routes/auth.draft-protected-route.spec.ts:57` e
  `tests/routes/auth.logout.spec.ts:51`.
- Evidencia: chaves estaticas usadas somente em specs.
- Impacto: nenhum se nunca forem usadas no runtime de producao.
- Correcao: manter confinadas em testes; opcionalmente centralizar em helper de
  ambiente de teste para reduzir ruido do SAST.

## Controles validados

- Nenhum segredo em historico Git, segundo Gitleaks com redacao ativa.
- Resposta de saude nao expôs erro de debug, X-Powered-By ou PII no ZAP
  baseline.
- A matriz de contratos, uploads, handshake, transicoes e BOLA/BFLA possui
  cobertura ja identificada em `tests/routes/contracts.access-matrix.integration.spec.ts`
  e specs correlatas.
- Teste focado HTTP: 27 cenarios aprovados para matriz bilateral, handshake,
  downloads e bloqueio de usuario sem vinculo.
- Simulacao local: rate limit e desafio de codigo por e-mail aprovaram sem
  chamar Redis, SMTP, Firebase ou qualquer ambiente externo.
- Concorrencia local: quatro cenarios aprovaram em banco exclusivo com sufixo
  `_test` (criacao idempotente, aprovacao serializada, substituicao documental
  e finalizacao idempotente).
- Regressao completa: `npm run build` e `npm run test` aprovaram em 2026-08-01
  (`204` arquivos e `902` testes).

Os artefatos brutos dos scanners ficam fora do repositorio, em
`D:\security-reports\phase7-20260801`, para nao versionar relatorios que podem
conter nomes internos de pacotes, rotas e versoes.

## Fechamento da Fase 7

### Dependencias

- Atualizadas de forma controlada: `firebase-admin` 14.2.0, `axios` 1.19.0,
  `multer` 2.2.0, `@aws-sdk/client-s3` 3.1101.0, `nodemailer` 9.0.3,
  `cloudinary` 2.10.0, Sentry 10.69.0, Vitest 4.1.10 e `tsx` 4.23.1.
- `ts-node-dev` foi removido; o comando de desenvolvimento agora usa `tsx watch`.
- `npm audit --omit=dev` e `npm audit` nao reportam vulnerabilidades altas ou
  criticas. Restam 2 baixas e 6 moderadas transitivas para acompanhamento,
  sem aplicar atualizacao forcada de major.

### Cadeia de build

- `.dockerignore` exclui segredos, artefatos e dependencias locais do contexto
  de build.
- O Dockerfile e multiestagio: compila com dependencias de desenvolvimento e
  entrega somente `dist`, scripts de bootstrap, catalogo de cidades e
  dependencias produtivas.
- A imagem final executa como usuario `app` sem privilegios, possui healthcheck
  e nao contem o CLI do npm. Isso removeu os pacotes vulneraveis que vinham
  embutidos no npm da imagem-base.
- GitHub Actions foram fixadas em SHAs completos; Dependabot recebeu cooldown
  para atualizacoes rotineiras sem atrasar alertas de seguranca.

### Validacao final

- `npm run build`: aprovado.
- `npm run test`: aprovado, 204 arquivos e 902 testes em 361.42 segundos.
- Gitleaks: nenhum segredo em 570 commits.
- Semgrep: nenhum achado de producao; tres avisos de chaves JWT fixas apenas
  em testes.
- Trivy na imagem final: 0 criticas, 0 altas, 4 moderadas e 2 baixas; nenhuma
  configuracao insegura reportada no Dockerfile final.
- A imagem `imobiliaria-backend:security-phase7` foi criada e verificada com
  usuario `app`, `dist`, migrations, schema baseline e catalogo nacional.

## Proximos passos operacionais

1. Revisar e versionar estas alteracoes em um commit separado de seguranca.
2. Validar o build no GitHub Actions e o deploy no Railway com as variaveis de
   ambiente de producao, sem promover dados de teste.
3. Agendar verificacao mensal de dependencias e Trivy; tratar as vulnerabilidades
   moderadas restantes quando houver atualizacao compativel.
4. Antes de um pentest externo, definir por escrito escopo, dominios, janelas,
   limites de taxa, contatos de incidente e proibicao de acesso a dados reais.
