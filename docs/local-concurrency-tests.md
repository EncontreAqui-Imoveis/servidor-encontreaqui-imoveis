# Testes locais de concorrencia

Estes testes verificam o comportamento real de `SELECT ... FOR UPDATE` com duas
conexoes TiDB em modo pessimista. Eles ficam fora de `npm test` e nunca usam `DB_*`,
`DATABASE_*`, TiDB Cloud, Railway ou qualquer host remoto.

## Pre-requisitos

1. Docker Desktop ativo e o TiDB local acessivel na porta `4000`.
2. Um usuario local com permissao para criar apenas o banco de teste.
3. Variaveis explicitas no terminal, sem reutilizar o `.env` de desenvolvimento:

```powershell
$env:LOCAL_CONCURRENCY_TESTS='1'
$env:LOCAL_CONCURRENCY_DB_HOST='127.0.0.1'
$env:LOCAL_CONCURRENCY_DB_PORT='4000'
$env:LOCAL_CONCURRENCY_DB_USER='root'
$env:LOCAL_CONCURRENCY_DB_PASSWORD='sua-senha-local'
$env:LOCAL_CONCURRENCY_DB_DATABASE='imobiliaria_security_test'
npm run test:local-concurrency
```

O teste recusa hosts que nao sejam `localhost`/`127.0.0.1` e bancos cujo nome
nao termine em `_test`. Ele cria o banco de teste se ainda nao existir e cria
somente tabelas temporarias com prefixo
`security_concurrency_`, remove essas tabelas ao final e nao toca nas tabelas
da aplicacao.

## Cobertura

- Criacao concorrente: bloqueio pessimista da negociacao e um unico contrato por negociacao.
- Aprovacao concorrente: uma unica decisao/historico e contrato canonicamente criado.
- Substituicao concorrente: somente a primeira chamada troca o documento; a segunda encontra o original removido.
- Finalizacao concorrente: uma unica alocacao financeira; a segunda chamada e
  um replay idempotente.

Os testes de servico e rota continuam cobrindo as regras da aplicacao. Esta
suite adicional valida o comportamento do bloqueio do TiDB. As rotas e servicos
continuam cobertos separadamente por specs unitarias e contratuais.
