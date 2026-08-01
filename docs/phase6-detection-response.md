FASE 6 - DETECCAO E RESPOSTA

ESCOPO IMPLEMENTADO
- `security_audit_events` registra somente: tipo do evento, severidade, papel,
  método, rota normalizada, status HTTP e `request_id`.
- Não registrar corpo da requisição, query string, e-mail, CPF, token, URL de
  documento, nome de arquivo, ID de usuário ou ID de contrato nessa tabela.
- Eventos cobertos: sucesso/falha de login, 401, 403, 429, 5xx, transições,
  revisões, uploads, downloads e exclusões bem-sucedidas.
- Retenção padrão: 180 dias, controlada por `SECURITY_AUDIT_RETENTION_DAYS` e
  pelo worker de retenção já existente.
- Alertas por log são opcionais. Com `SECURITY_ALERTS_ENABLED=true`, o processo
  registra `SECURITY_ALERT_THRESHOLD_EXCEEDED` uma vez por janela de cinco
  minutos para: 20 falhas de login, 50 recusas de autorização, 20 rate limits
  ou 5 respostas 5xx.

OPERACAO NO RAILWAY
1. Manter `DATA_RETENTION_WORKER_ENABLED=true` para aplicar o descarte.
2. Se os alertas forem desejados, definir `SECURITY_ALERTS_ENABLED=true`.
3. Criar alerta de log no Railway para `SECURITY_ALERT_THRESHOLD_EXCEEDED` e
   `SECURITY_AUDIT_PERSISTENCE_FAILED`; não enviar PII ao canal de alerta.
4. Não ativar push, SMS ou e-mail automáticos para esses eventos sem aprovar
   destinatário, orçamento e procedimento de escalonamento.

SIMULADO MINIMO
1. Em ambiente local, provocar cinco respostas 5xx controladas ou os limites
   configurados, usando apenas contas e dados sintéticos.
2. Confirmar o `request_id` no log, a rota normalizada e a ausência de PII.
3. Registrar no runbook: horário, responsável, contenção adotada, resultado e
   correção. Para incidente real envolvendo dados pessoais, preservar o
   registro mínimo por cinco anos conforme decisão jurídica.
4. Executar o runbook LGPD em `docs/lgpd-incident-runbook.txt`.
