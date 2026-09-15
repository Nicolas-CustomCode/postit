# ADR 0001 — Instagram Login em vez de Facebook Login

**Data:** 2026-09-09 · **Status:** aceito

## Contexto

A Meta oferece dois caminhos excludentes para publicar no Instagram por API. Um aplicativo escolhe
um dos dois e não pode usar os dois.

**Instagram API with Instagram Login** — host `graph.instagram.com`, token de usuário do Instagram,
sem Página do Facebook. **Instagram API with Facebook Login** — host `graph.facebook.com`, token de
Página do Facebook, com Página vinculada obrigatória.

Até pouco tempo atrás, publicar exigia o segundo caminho. Isso mudou: a documentação atual confirma
que o Instagram Login suporta publicação de conteúdo para todos os formatos que o projeto precisa.

## Decisão

**Usar Instagram API with Instagram Login**, com os escopos `instagram_business_basic`,
`instagram_business_content_publish` e `instagram_business_manage_insights`.

## Consequências

### Positivas

- **Sem Página do Facebook vinculada.** Elimina uma classe inteira de falhas: Página desvinculada,
  autorização de publicação pendente, papel insuficiente no Business Manager
- **Conexão de conta muito mais simples.** O usuário autoriza direto pelo Instagram
- **Menos permissões.** Não é preciso pedir acesso a Páginas do Facebook
- **Alinhado com o que já existe.** É a mesma via de `sorteio-comentarios-instagram` e `openreply`

### Negativas — e uma delas é definitiva

- **Marcação de localização é impossível.** O parâmetro `location_id` não existe nesta via, e o
  Pages Search API — único jeito de descobrir o identificador de um local — não aceita token de
  Instagram. **Os dois lados estão fechados: não há contorno.**
- **Sem marcação de produto.** Recurso de loja fica indisponível
- **Sem busca de hashtag.** Não dá para pesquisar ou sugerir hashtags pela API
- **Sem anúncios de parceria.** Fora do escopo de qualquer forma

### Como o produto lida com isso

As limitações entram no não-escopo de [01](../01-visao-produto.md) e precisam aparecer **na
interface**, no momento da composição — não só na documentação.

## Alternativa considerada

**Facebook Login.** Traria marcação de localização e de produto de volta. Rejeitada porque o custo
recai sobre o fluxo mais frequente do sistema — conectar e manter contas funcionando — para
resolver recursos que não fazem parte do MVP.

## Reversibilidade

**Cara.** Trocar de via significa novo fluxo OAuth, novos escopos, novo formato de token, novo host,
e reconectar todas as contas. Não é uma troca de variável de ambiente.

Concentrar tudo no módulo `apps/api/src/instagram/` reduz o estrago, mas não o elimina. Se marcação de
localização virar requisito real, a decisão precisa ser reavaliada como projeto, não como ajuste.

## Fonte

Verificado na documentação oficial em 09/09/2026. Detalhes e links em
[08 — Qual API, e por quê](../08-integracao-instagram.md#qual-api-e-por-quê).
