# Operação segura de documentos R2

## Privilégios mínimos

Crie uma credencial R2 dedicada exclusivamente ao bucket de documentos e limite
as permissões a leitura, gravação, listagem e exclusão desse bucket. O R2 permite
restringir a credencial ao bucket, não a um prefixo de objetos; o prefixo é
validado pelo backend. Não reutilize a credencial no Cloudinary, Firebase, banco
ou frontend. O bucket de documentos deve permanecer privado, sem URL pública.

Em produção, `R2_ENDPOINT` deve usar HTTPS. Mantenha `R2_PREFIX` exclusivo para
documentos de negociações, por exemplo `negotiation-docs`; o reconciliador só
enumera e pode excluir objetos abaixo de `R2_PREFIX/negotiations/`.

## Reconciliação banco/R2

O comando abaixo apenas compara as referências persistidas em
`negotiation_documents` com os objetos R2 e emite chaves somente como hashes.
Ele não exclui nada:

```powershell
npm run audit:r2-documents
```

Use a saída para corrigir referências sem objeto antes de qualquer exclusão. Para
remover objetos órfãos, execute fora do horário de pico e exija as duas travas:

```powershell
$env:R2_RECONCILIATION_CONFIRM='DELETE_ORPHANS'
npm run audit:r2-documents -- --delete-orphans
```

O processo nunca alcança objetos fora do bucket e prefixo configurados. Falhas
de exclusão permanecem visíveis no resultado e exigem nova execução; não são
silenciosamente ignoradas.

Como proteção adicional, ele recusa excluir objetos quando o banco não contém
nenhuma referência documental e o prefixo R2 contém arquivos. Isso normalmente
indica banco novo, variável de ambiente errada ou restauração incompleta. Não use
`R2_RECONCILIATION_ALLOW_EMPTY_DATABASE_DELETE`; essa trava existe apenas para
um descarte total planejado, documentado e aprovado.

## Limites atuais

PDFs e imagens passam por validação de magic bytes antes do R2. Reencodificação
de imagens, renderização isolada de PDF e antimalware exigem infraestrutura
dedicada e ainda não estão habilitados. Não trate um arquivo aceito como análise
antivírus.
