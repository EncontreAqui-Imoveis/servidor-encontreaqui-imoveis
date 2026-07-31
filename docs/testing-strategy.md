# Estratégia de testes

## Objetivo

A suíte deve detectar regressões de contrato, autorização e workflow sem falhar por tempo, ordem interna irrelevante ou dependência externa.

## Comandos

| Comando | Escopo | Quando usar |
|---|---|---|
| `npm test` | Suíte determinística completa, sem stress local | Pull request e release |
| `npm run test:unit` | Serviços, utilitários, middlewares, módulos e controladores | Durante desenvolvimento |
| `npm run test:integration` | Rotas, banco mockado e migrations | Antes de alterar API/schema |
| `npm run test:performance` | Microbenchmark isolado | Manual, sem bloquear release comum |
| `npm run test:local-stress:*` | Custo, storage ou provedor local | Manual, somente com ambiente local explícito |

Todos os comandos determinísticos usam `forks`, no máximo dois workers e sem paralelismo por arquivo. Isso reduz competição por mocks de ambiente e banco sem misturar testes de stress à verificação normal.

## Regras anti-flake

- Não usar `setTimeout`/`sleep` como sincronização de teste. Usar `vi.waitFor`, fake timers ou uma promessa controlada.
- Congelar o relógio quando a decisão testada depender de expiração, cooldown ou janela de promoção.
- Testar respostas HTTP, eventos persistidos e efeitos de negócio. Não testar ordem de chamadas internas por conveniência.
- Inspeção de SQL é aceita somente para migrations, segurança de filtros, placeholders e garantias de isolamento que não possam ser verificadas pelo contrato HTTP.
- Mocks de módulos compartilhados devem exportar todas as factories importadas pela rota; preferir `importOriginal` quando o mock for parcial.
- Testes de rede, Firebase, R2, Redis, e-mail e push devem usar doubles locais. Integração real fica em smoke manual autorizado.

## Classificação e governança

- `tests/local-stress/` nunca roda em `npm test` ou CI comum.
- `tests/performance/` é manual para evitar falha por variação de hardware.
- Fluxos de contrato, autenticação, autorização, PII e migrations são bloqueadores de release.
- Um teste intermitente deve ser corrigido, isolado ou removido da gate; não deve ser mascarado com repetição automática.
- Workflows de qualidade e SAST rodam por push, pull request ou disparo manual. Não há execução noturna automática.
