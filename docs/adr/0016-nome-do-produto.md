# ADR 0016 — Nome do produto: PostIt, como nome de trabalho

**Data:** 2026-09-15 · **Status:** aceito

## Contexto

O projeto nasceu com o nome **InstaPlan**. Dois problemas:

**1. O nome viola as diretrizes de marca da Meta.** O
[guia de marca do Instagram](https://www.meta.com/brand/resources/instagram/instagram-brand/) diz:

> *"Don't combine 'Insta' or 'gram' with your own brand"*

> *"Don't combine any part of the Instagram brand with a company name, other trademarks, or generic terms"*

E a [página de marcas registradas da Meta](https://www.meta.com/brand/resources/meta/our-trademarks/)
lista **Instagram, Insta, Gram e IG** como marcas, e proíbe usá-las *"as or as part of any trademark,
service mark, company name, trade name, username or domain registration"*.

A forma permitida é descritiva: um produto que usa a API do Instagram pode dizer que é *"for Instagram"*.

**2. O nome não serve para o futuro.** Outras redes sociais estão planejadas
([ADR 0009](0009-preparacao-multi-rede.md)).

Verificado em 15/09/2026.

## Decisão

**O produto passa a se chamar PostIt**, como nome de trabalho enquanto for uma ferramenta interna.

- Toda a documentação e os nomes técnicos foram renomeados: processos `postit-web`, `postit-api`,
  `postit-worker`, containers `postit-*`, pasta de instalação `/opt/postit`
- Os pacotes do monorepo continuam com escopo neutro `@repo/*`, justamente para o nome poder mudar sem
  mexer no código
- A pasta do repositório local ainda se chama `instaplan`; renomear fica a critério do dono do projeto

### Regras que valem para qualquer nome

- **Nunca** "Insta", "gram" ou "IG" no nome do produto, em domínios, no nome do aplicativo no painel da Meta
  ou em telas
- Para dizer que o produto é compatível com o Instagram, a forma permitida é **"PostIt for Instagram"**
- Nomes dos aplicativos na Meta: **PostIt** (produção) e **PostIt Dev** (desenvolvimento),
  conforme [ADR 0018](0018-ambientes-e-apps-meta-separados.md)

## Consequências

### Positivas

- Deixa de violar as diretrizes da Meta
- O nome serve para qualquer rede social

### Negativas — risco registrado

**"Post-it" é marca registrada da 3M**, e muito conhecida. Marcas famosas costumam ter proteção ampliada,
inclusive fora do ramo original. Um software com esse nome corre risco de notificação, e é difícil de
encontrar em buscas.

O risco foi **aceito conscientemente** porque, por ora, o sistema é interno: não há venda, divulgação,
registro de marca nem domínio público com o nome.

**Antes de qualquer uso externo** — vender, divulgar, registrar domínio com o nome, abrir para clientes — o
nome precisa ser revisto, com pesquisa no INPI ou consulta a especialista. Trocar é substituir texto na
documentação e nos nomes de processo; o código usa `@repo/*`.

## Alternativas consideradas

**Manter InstaPlan como nome interno.** Rejeitada: o nome vaza com facilidade para o painel da Meta, para
domínios e para telas.

**Codinome neutro até escolher o nome definitivo.** Mais seguro juridicamente, mas o dono do projeto
preferiu um nome de trabalho já utilizável.

**Cadência, Pauta** — sugestões avaliadas e não escolhidas, com disponibilidade de marca não verificada.

## Reversibilidade

**Alta.** Renomear é substituir texto na documentação, nos nomes de processo e na pasta de instalação.
