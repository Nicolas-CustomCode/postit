# ADR 0009 — Preparação para múltiplas redes sociais

**Data:** 2026-09-14 · **Status:** aceito

## Contexto

O MVP publica só no Instagram. Existe a intenção de, no futuro, suportar outras redes sociais — e
também de responder comentários e mensagens diretas.

A tentação é construir desde já um "publicador genérico" que sirva para qualquer rede. O problema é
que as redes são muito diferentes entre si: formatos de conteúdo, forma de enviar a mídia, limites,
fluxo de autorização. Um molde desenhado hoje acertaria o Instagram e chutaria o resto — e quando a
segunda rede chegasse, o molde provavelmente não serviria.

## Decisão

Fazer agora **só o que custa quase nada e não depende de adivinhar como as outras redes funcionam**.

### O que se faz agora

| Onde | Escolha |
|---|---|
| Nomes no banco | Conceitos genéricos com nome genérico: `Conta` (não `ContaInstagram`), com campo `rede` |
| Identificadores externos | `Conta.idExterno` e `Publicacao.idExterno` (não `igUserId` e `igMediaId`), únicos por rede |
| Enumeração | `RedeSocial` com um único valor por enquanto: `INSTAGRAM` |
| Código específico | Um módulo Nest por rede: `apps/api/src/instagram/` e `apps/api/src/publishing/instagram/`. Especificações de mídia por rede em `packages/shared` |
| Filas | Com o nome da rede quando dependem da API dela: `publicar-instagram`, `coletar-metricas-instagram`, `renovar-tokens-instagram` |

### O que deliberadamente **não** se faz agora

- **Nenhuma interface genérica de publicador.** O worker chama direto o código do Instagram
- **Formatos continuam os do Instagram.** `FormatoPostagem` tem `REELS` e `STORIES`; formatos de
  outras redes serão desenhados quando a rede for escolhida
- **`ContainerPublicacao` continua específico do Instagram.** O conceito de container em duas etapas
  é da API da Meta
- **Nenhuma tabela ou campo para comentários e mensagens**

A abstração nasce quando a segunda rede existir, com informação real sobre ela.

## Consequências

### Positivas

- O banco não precisa ser renomeado quando a segunda rede chegar
- Nenhum código especulativo para manter e testar agora
- Cada rede com filas próprias: uma rede lenta ou com problema não atrasa as outras

### Negativas

- `Conta` e `Publicacao` com nomes genéricos convivem com campos que, hoje, só fazem sentido para o
  Instagram. A documentação de [07](../07-modelo-dados.md) marca quais são
- Quando a segunda rede chegar, ainda haverá trabalho real: extrair o que for comum, revisar formatos,
  talvez separar `ContainerPublicacao` numa estrutura por rede

## O que a chegada de comentários e mensagens vai exigir

Registrado para não ser surpresa. Fontes e detalhes em
[08 — Escopos futuros](../08-integracao-instagram.md#escopos-futuros-comentários-e-mensagens).

- **Novas permissões**, que o MVP deliberadamente não pede. As contas precisarão autorizar de novo
- **Webhooks** para receber aviso de comentário e mensagem novos — e a documentação da Meta indica
  que isso pode exigir aplicativo em modo publicado e revisão, o que o MVP não precisa
- **Modelagem de dados** para conversas, comentários e respostas

## Reversibilidade

**Não se aplica** no sentido usual: a decisão é justamente adiar. O custo evitado agora é o de
renomear tabelas depois; o custo aceito é refatorar o código quando a segunda rede chegar.
