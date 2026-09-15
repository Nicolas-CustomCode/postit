# ADR 0002 — Ferramenta single-tenant

**Data:** 2026-09-09 · **Status:** aceito · **Complementado por:** [ADR 0015](0015-super-admin-e-permissoes.md)

> A decisão central continua valendo: ferramenta single-tenant, sem organizações nem cobrança, e todos os
> usuários enxergam todas as contas. O que mudou: agora existem **super admin e permissões por usuário**, e
> "sessão válida dá acesso a tudo" deixou de ser verdade. Ver o ADR 0015.

## Contexto

O sistema pode ser construído como produto multi-inquilino, com organizações isoladas, papéis e
cobrança, ou como ferramenta interna de dono único gerenciando várias contas do Instagram.

A escolha atravessa tudo: modelo de dados, autenticação, autorização e complexidade da interface.

## Decisão

**Ferramenta interna, single-tenant.** Sem organizações, sem isolamento entre usuários, sem
cobrança. Vários usuários podem existir, e todos enxergam todas as contas conectadas.

O modelo de dados **já suporta várias contas do Instagram** — isso custa quase nada agora e é caro
de refatorar depois. O que não existe é a camada de isolamento acima delas.

## Consequências

### Positivas

- Nenhuma coluna de organização, nenhuma verificação de pertencimento em consulta
- Autenticação simples: sessão válida dá acesso a tudo
- Sem cobrança, sem planos, sem limites por assinatura
- Menos telas, menos casos de teste, menos superfície de erro

### Negativas

- **Cada usuário criado é uma cópia do risco.** Quem entra na ferramenta pode publicar em qualquer
  conta conectada. Semear usuários com parcimônia
- Não há trilha de "quem podia fazer o quê" — só de "quem fez o quê", pela auditoria
- Virar produto depois exige refatoração real: coluna de organização em quase toda tabela,
  verificação de pertencimento em toda consulta, convites, papéis

### O que fica preparado, mesmo assim

- Várias contas do Instagram, desde o início
- Auditoria com autor identificado em cada ação
- Aprovação com papéis implícitos: quem cria e quem aprova podem ser pessoas diferentes

## Alternativa considerada

**Multi-inquilino desde o começo.** Rejeitada por ser complexidade cobrada adiantado para um
cenário que não existe. Se o produto for vendido um dia, a refatoração é conhecida e delimitada.

## Reversibilidade

**Média.** A migração é mecânica mas extensa: adicionar organização, retrofit das consultas,
convites e papéis. Manter as regras de negócio em `apps/api/src/domain/`, sem dependência de framework,
facilita — mas não elimina o trabalho.
