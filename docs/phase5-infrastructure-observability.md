FASE 5 - INFRAESTRUTURA E OBSERVABILIDADE

OBJETIVO
Operar a API sem expor segredos, dados pessoais, metricas ou servicos de
infraestrutura. Este documento nao contem credenciais nem comandos destrutivos.

COLETOR SRE MODERNIZADO
- O coletor permanece desligado por padrão (`SRE_STATS_ENABLED=false`).
- Quando habilitado, registra somente métricas reais do processo: P99 estimado,
  taxa de respostas, taxa de erro, CPU e memória.
- Não gera histórico aleatório, não consulta URLs externas e não cria custos de
  tráfego para Railway, Vercel, Cloudflare, Firebase ou TiDB.
- A tabela `sre_metrics_history` recebe `source=backend`; registros são
  removidos após 30 dias por padrão. O intervalo mínimo é um minuto e a
  retenção é limitada a 90 dias.
- A disponibilidade externa deve ser monitorada pelos provedores ou por uma
  ferramenta dedicada; o dashboard não declara serviços saudáveis sem uma
  fonte verificável.
- A Central SRE está desativada no painel administrativo para não misturar
  telemetria técnica com a operação imobiliária. O perfil auxiliar também não
  recebe nem consulta telemetria, custos ou eventos de deploy.

CONTROLES NO CODIGO
- /health permanece publico para healthchecks e nao expoe estado interno.
- /metrics exige o header x-metrics-secret com METRICS_SECRET_KEY.
- Metricas usam rotas normalizadas; UUIDs, IDs numericos e tokens longos nao
  viram labels nem aparecem nos logs operacionais.
- security_events_total registra apenas tipo de evento, rota normalizada e
  codigo HTTP para 401, 403, 429 e 5xx.
- SRE_STATS_ENABLED=false por padrao. O coletor modernizado depende da migration
  20260731_002 e possui retenção técnica própria.

RAILWAY - CHECKLIST MANUAL
- Definir NODE_ENV=production e somente variaveis do ambiente de producao.
- Manter RUN_MIGRATIONS_ON_START conforme o fluxo de deploy aprovado.
- Configurar healthcheck HTTP em /health.
- Configurar alerta de restart, indisponibilidade, 5xx e uso de memoria/CPU.
- Configurar teto mensal de gasto e alerta em 50%, 80% e 100%.
- Definir retencao de logs de plataforma em 30 dias, quando o plano permitir.
- Nunca configurar valores de .env.local no Railway.

TIDB - CHECKLIST MANUAL
- Usar TLS e credencial exclusiva da aplicacao, sem reutilizar a conta pessoal.
- Conceder apenas privilegios necessarios ao schema da aplicacao.
- Verificar backup automatico e executar restauracao em banco descartavel antes
  de depender do backup em incidente real.
- Registrar responsavel, data da revisao e proxima rotacao de senha.

REDIS - CHECKLIST MANUAL
- Nao publicar porta Redis na internet.
- Usar senha e TLS/rede privada quando o provedor oferecer.
- Armazenar somente dados tecnicos com TTL: rate limits, locks e filas.
- Nunca usar Redis para CPF, dados bancarios, documentos ou payloads de contrato.

R2/FIREBASE/GITHUB/VERCEL - CHECKLIST MANUAL
- R2: bucket privado, prefixo restrito, chave exclusiva do backend e alerta de
  consumo/storage.
- Firebase: revisar chaves, App Check quando viavel e destinatarios de teste em
  homologacao.
- GitHub: MFA, branch protection, Dependabot, secret scanning e permissao minima
  para Actions.
- Vercel: permitir apenas dominios corporativos, revisar variaveis NEXT_PUBLIC_*
  e impedir preview conectado ao backend de producao quando possivel.

ALERTAS RECOMENDADOS
- 401: 20 em 5 minutos por servico.
- 403: 50 em 5 minutos por servico; investigar picos, sem alertar cada evento.
- 429: 20 em 5 minutos; revisar abuso e configuracao de limiter.
- 5xx: 5 em 5 minutos; prioridade alta se /health falhar.
- Fila de exclusao de documentos, falha de storage e replay de webhook: alerta
  imediato por log/metricas dedicadas quando esses workers estiverem ativos.

EVIDENCIA DE REVISAO
Para cada provedor, registrar fora do repositorio: responsavel, data, ambiente,
configuracao verificada, resultado e proxima data de revisao. Nao anexar token,
senha, URL assinada ou exportacao de dados pessoais.
