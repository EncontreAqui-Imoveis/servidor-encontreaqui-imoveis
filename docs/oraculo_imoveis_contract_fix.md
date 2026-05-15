# Oráculo Backend - Contrato Canônico de Imóveis (Create/Edit/Show)

## Causa raiz

- O fluxo de área ainda aceitava entradas legadas (`area_construida`, `area`, `area_terreno`) sem prioridade explícita para o contrato canônico `*_valor + *_unidade`.
- Em `PATCH/PUT`, a detecção de atualização de área não considerava `area_construida_valor`/`area_terreno_valor`, gerando validação/estado final inconsistentes em alguns cenários.
- `amenities[]` coexistia com flags legadas sem sincronização no update; isso permitia divergência entre JSON canônico e booleans históricos.
- Erros estruturados já existiam, mas sem `details` opcional para diagnóstico contextual em casos aplicáveis.

## Arquivos alterados

- `D:/backend/src/controllers/PropertyController.ts`
- `D:/backend/tests/routes/properties.create.validation.spec.ts`
- `D:/backend/tests/routes/properties.public-response-shape.contract.spec.ts`

## Contrato final de área

- Entrada canônica priorizada:
  - `area_construida_valor`, `area_construida_unidade`
  - `area_terreno_valor`, `area_terreno_unidade`
- Campos legados (`area_construida`, `area`, `area_terreno`) seguem aceitos como compatibilidade, mas apenas fallback quando o campo canônico não foi enviado.
- `area_construida_valor`:
  - aceita ausente, `null` e vazio (`""`) como “sem área construída”.
  - não exige `area_construida_m2` no request.
- `area_terreno_valor`:
  - obrigatório apenas para tipos que exigem terreno (`Terreno`, `Área rural`, `Rancho`, `Chácara`, `Fazenda`, `Área comercial`).
  - demais tipos podem omitir.
- Conversão para `*_m2` permanece derivada interna técnica (persistência/filtro/ordenação/relação de coerência), nunca requisito de entrada.
- Valores grandes em `ha`/`alqueire` (ex.: `2332 ha`) continuam aceitos sem teto de UX em m² para essas unidades.

## Contrato final de amenities

- `amenities[]` é a fonte canônica para create/update.
- Aliases legados continuam normalizados para nomes canônicos (incluindo variações de câmera para `SISTEMA DE SEGURANÇA/CÂMERA`).
- `Planejados` permanece inválido como amenity canônico.
- Em update com `amenities`, as flags legadas (`has_wifi`, `tem_piscina`, `tem_energia_solar`, `tem_automacao`, `tem_ar_condicionado`, `eh_mobiliada`) são sincronizadas automaticamente a partir do array canônico para evitar divergência.

## Política final de duplicidade

- Não há bloqueio por título/nome.
- Bloqueio de duplicidade continua apenas por identificador forte (`code`), com erro estruturado.
- Teste explícito adicionado para permitir título duplicado em `/properties`.

## Comandos rodados

1. `npm run build`
2. `npm run test -- tests/routes/properties.create.validation.spec.ts`
3. `npm run test -- tests/routes/properties.create.validation.spec.ts` (reexecução após ajuste de teste)
4. `npm run test -- tests/routes/properties.public-detail.spec.ts`
5. `npm run test -- tests/routes/properties.public-response-shape.contract.spec.ts`

## Resultado exato de cada comando

### 1) `npm run build`

```text
> imobiliaria-backend@1.0.0 build
> tsc
```

### 2) `npm run test -- tests/routes/properties.create.validation.spec.ts` (1ª execução)

```text
❯ tests/routes/properties.create.validation.spec.ts (52 tests | 1 failed)
FAIL ... updates property amenities via PATCH /properties/:id
AssertionError: expected 1 to be 555
```

### 3) `npm run test -- tests/routes/properties.create.validation.spec.ts` (2ª execução)

```text
✓ tests/routes/properties.create.validation.spec.ts (52 tests) 763ms
Test Files  1 passed (1)
Tests       52 passed (52)
```

### 4) `npm run test -- tests/routes/properties.public-detail.spec.ts`

```text
✓ tests/routes/properties.public-detail.spec.ts (4 tests) 523ms
Test Files  1 passed (1)
Tests       4 passed (4)
```

### 5) `npm run test -- tests/routes/properties.public-response-shape.contract.spec.ts`

```text
✓ tests/routes/properties.public-response-shape.contract.spec.ts (5 tests) 466ms
Test Files  1 passed (1)
Tests       5 passed (5)
```

## Testes adicionados/alterados

- `tests/routes/properties.create.validation.spec.ts`
  - create broker com `area_construida_valor = null` e `area_terreno_valor = 2332 ha`.
  - create client com `area_construida_valor` ausente e `area_terreno_valor = 2332 ha`.
  - duplicidade por título permitida em `/properties`.
  - patch alterando `area_construida_valor + area_construida_unidade` (sem `*_m2` no request).
  - ajuste de assert em teste de update de amenities por mudança intencional do shape de `UPDATE` params.
- `tests/routes/properties.public-response-shape.contract.spec.ts`
  - validação de ordenação por `area_construida` usando expressão técnica interna em m² (`COALESCE(p.area_construida_m2, p.area_construida)`).

## Pendências

- Gravar relatório em `D:/projeto-imobiliario/frontend/agent_reports/oraculo_imoveis_contract_fix.md` não foi executado para respeitar a restrição declarada de não alterar arquivos fora de `D:/backend`.

## Blockers

- Sem bloqueio técnico de código/testes no backend.
- Bloqueio apenas de path de saída do relatório por conflito de restrição de escopo de workspace.

## Mudanças fora do escopo

- Nenhuma mudança fora do escopo funcional solicitado no backend.
