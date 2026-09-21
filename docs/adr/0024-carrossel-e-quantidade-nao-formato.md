# ADR 0024 — Carrossel é quantidade, não formato

**Data:** 2026-09-21 · **Status:** aceito

## Contexto

`FormatoPostagem` nasceu com cinco valores, copiando a lista de formatos que o Instagram apresenta ao
usuário: `FEED_IMAGEM`, `FEED_VIDEO`, `CARROSSEL`, `REELS`, `STORIES`. Três coisas mostraram que a
cópia estava errada.

**Carrossel não é uma escolha na API.** A Meta monta o carrossel a partir da **quantidade**: o
container pai recebe `children` com 2 a 10 itens, e são esses itens que fazem dele um carrossel
([docs/08](../08-integracao-instagram.md), "Matriz de parâmetros por formato"). A documentação também
registra que *"Carousels are limited to 10 images, videos, or a mix of the two"* — imagem e vídeo na
mesma publicação, sem formato que os distinga.

**As especificações de carrossel e de feed já eram as mesmas.** A faixa 4:5 a 1.91:1 vale *"só para
imagem de feed **e itens de carrossel**"* ([docs/08](../08-integracao-instagram.md), "Especificações
de mídia"), e `IMAGE_SPECS.CAROUSEL` era byte a byte igual a `IMAGE_SPECS.FEED_IMAGE`, com um teste
comparando as duas para provar isso.

**Vídeo de feed não existe na prática.** A Meta não publica mais tabela separada para ele, e trata
vídeo único de feed como Reels — o item V-7 de [docs/08](../08-integracao-instagram.md), ainda a
confirmar empiricamente.

Ou seja: o enum guardava, em dois valores, informação que a tabela `PostagemMidia` já guarda melhor,
contando linhas. E `PostagemMidia` sempre teve `ordem` e `@@unique([postagemId, ordem])` — a estrutura
do carrossel existia desde a migration inicial.

## Decisão

**`FormatoPostagem` tem três valores: `FEED`, `REELS`, `STORIES`.**

Carrossel deixa de ser formato. O que o define é a contagem de `PostagemMidia`:

| Formato | Mídias | Na API da Meta |
|---|---|---|
| `FEED` | 1 | `media_type` omitido (imagem simples) |
| `FEED` | 2 a 10 | `media_type=CAROUSEL` no pai, `is_carousel_item=true` nos filhos |
| `REELS` | exatamente 1 | `media_type=REELS` |
| `STORIES` | exatamente 1 | `media_type=STORIES` |

Reels não pode entrar em carrossel e Stories não tem `children`: os dois são sempre uma mídia
([docs/08](../08-integracao-instagram.md)). A regra mora em `packages/shared/src/post-formats.ts`,
porque roda nas duas pontas (AGENTS.md, regra 6): a tela apaga o botão de adicionar no décimo, e a
API decide de verdade em `postReadinessProblem()`.

**A quantidade é conferida antes da proporção.** Em Stories, duas imagens 9:16 são as duas válidas, e
reclamar da segunda por proporção mandaria trocar a foto — que não é o que resolve.

**Nenhum dos três valores leva `@map`.** Isso obedece o [ADR 0023](0023-codigo-em-ingles.md) em vez de
contrariá-lo: o `@map` existia só onde havia tradução (`FEED_IMAGE @map("FEED_IMAGEM")`,
`CAROUSEL @map("CARROSSEL")`), e são exatamente esses dois que saem — `FEED_VIDEO`, `REELS` e
`STORIES` nunca tiveram. `FEED`, `REELS` e `STORIES` são as palavras que a própria Meta usa em
`media_product_type`, e a exceção de nomes da Meta já está no ADR 0023.

**Feed aceita só imagem nesta fase.** Vídeo — em Feed, Reels ou Stories — depende do validador de
vídeo (codec, duração, átomo `moov`), que é Fase 2. Quando chegar, um vídeo solto no Feed será
recusado com "vídeo único no feed vira Reels": não vale apostar num comportamento que o próprio
docs/08 marca como não confirmado (V-7), e Reels tem campos que só ele tem — capa, `share_to_feed`,
`audio_name`.

### A migration

Postgres não remove valor de enum. A migration
`20260921115019_formatos_feed_reels_stories` foi escrita à mão — é a primeira do projeto que remove
valor, as outras só acrescentam com `ALTER TYPE ... ADD VALUE`. O `USING` que o Prisma gera é um cast
cego (`"formato"::text::"FormatoPostagem_new"`) que estoura na primeira linha `FEED_IMAGEM` e faz o
`migrate dev` oferecer **resetar o banco**; no lugar dele vai um `CASE` explícito:

| De | Para | Por quê |
|---|---|---|
| `FEED_IMAGEM` | `FEED` | Uma imagem no feed é um Feed de uma mídia |
| `CARROSSEL` | `FEED` | Carrossel virou Feed com 2 a 10 mídias |
| `FEED_VIDEO` | `REELS` | A Meta o converte em Reels (V-7), e o formato deixou de existir |

O `CASE` precisa ser total: a coluna é `NOT NULL`, e um ramo faltando devolveria `NULL`.

⚠️ **A CI não exercita isso.** Ela roda `db:deploy` num Postgres vazio, onde o `CASE` nunca vê uma
linha — a migration pode estar errada e a CI passar verde. Migration de enum se testa **local, num
banco com dados**.

## Consequências

- **Trocar o formato de uma postagem com várias mídias é recusado sem código novo.** `setFormat` já
  revalidava a mídia anexada pelo portão de prontidão; com a quantidade lá dentro, Feed com cinco
  imagens → Stories passa a ser recusado por consequência. É o teste de que a regra nasceu no lugar
  certo: posta em `setMedia`, precisaria de uma cópia em `setFormat`, e a cópia envelheceria.
- **A ordem virou conteúdo.** Reordenar passa por `applyContentChange` e derruba a postagem para
  rascunho, como legenda e mídia: alguém aprova uma sequência, e publicar outra seria publicar coisa
  que ninguém aprovou. O [07](../07-modelo-dados.md) já dizia que *"a ordem é a essência do
  carrossel"*.
- **A prévia passa a mostrar o recorte pela primeira imagem**, que a Meta aplica a todas e que o
  docs/08 já cobrava da interface.
- **Não contraria o [ADR 0009](0009-preparacao-multi-rede.md).** A frase dele — *"`FormatoPostagem`
  tem `REELS` e `STORIES`"* — continua verdadeira, e os formatos continuam sendo os do Instagram.
- **A Fase 2 fica menor.** A ordenação do carrossel saiu dela; o que resta é a montagem dos
  containers pai e filho na publicação, e o validador de vídeo.
- **Uma dívida anotada em comentário:** `Marcacao` aponta para `PostagemMidia` com `ON DELETE
  RESTRICT`. O `deleteMany` que apaga e recria a lista vai falhar no dia em que houver marcação
  (RF-C05, Fase 2), e então será preciso preservar as linhas cuja `(midiaId, ordem)` não mudou. Hoje
  nada grava `Marcacao`.

## Alternativas descartadas

**Manter `CARROSSEL` como formato e deduzir o resto.** Duas fontes de verdade para a mesma pergunta —
a coluna e a contagem — e nada impediria que discordassem: uma postagem `CARROSSEL` com uma mídia só,
ou `FEED_IMAGEM` com três.

**Manter `FEED_VIDEO` esperando a confirmação do V-7.** Um valor de enum que nunca seria escrito,
porque a composição não o oferece e a Meta o converte sozinha. Se o V-7 se confirmar ao contrário, um
`ALTER TYPE ... ADD VALUE` o traz de volta — que é a operação barata, ao contrário da remoção.
