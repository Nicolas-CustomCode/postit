# ADR 0026 — A postagem em duas etapas: Composição e Revisão

**Data:** 2026-09-23 · **Status:** aceito · **Emenda:** [ADR 0015](0015-super-admin-e-permissoes.md) (quem comenta)

## Contexto

Na Fase 1, a página da postagem era um formulário só. O horário ficava na mesma tela da legenda, e o botão
"Marcar como pronta" **encadeava** duas transições — `RASCUNHO → EM_REVISAO → APROVADO` — numa chamada, porque a
Fase 1 não tinha revisão de verdade (RF-E02, nota de 20/09). Depois do agendamento, a mesma página trocava de
cara conforme o estado: formulário, leitura ou tela de falha.

Ao usar o motor de publicação pela primeira vez (23/09/2026), a página confundiu: uma postagem publicada ainda
mostrava "Marcar como pronta", e não havia como saber, olhando a tela, em que ponto do processo a postagem
estava. O usuário propôs uma página em forma de *checkout*, com as etapas no topo, e aprovou um protótipo
interativo que percorre os oito estados em três papéis
([artefato](https://claude.ai/artifact/Q2ahKuMUdcoNMb13WfMdRT)).

O desenho aprovado depende de enviar para revisão, reprovar com motivo e comentários internos — da Fase 4
([docs/12](../12-roadmap.md)). As tabelas já existiam desde a migration inicial (`Aprovacao`, com `motivo`, e
`ComentarioInterno`), e a máquina de estados já tinha as arestas; faltavam rotas e telas.

## Decisão

### 1. Duas etapas de ação; o resto é estado

| Etapa | Quando está ativa | O que se faz |
|---|---|---|
| **1 · Composição** | `RASCUNHO`, para quem tem `POSTAGEM_EDITAR` | Formato, mídias, legenda, texto alternativo (e, na Fase 2, marcações e colaboradores) |
| **2 · Revisão** | Todo o resto — e sempre, para quem não edita | Aprovar e agendar, reprovar, acompanhar, comentar |

`AGENDADO`, `PROCESSANDO`, `PUBLICADO`, `FALHOU` e `CANCELADO` **não são etapas**: são estados mostrados num
cartão, na Revisão. Etapa é página em que alguém age; estado é o que aconteceu depois.

- **Só se edita em rascunho.** Para editar uma postagem em revisão, aprovada ou agendada, a Revisão oferece
  "Voltar para a composição", com confirmação na própria tela: ela volta para `RASCUNHO` e perde o horário
  (I-2, que já valia para edição de conteúdo).
- **O horário sai da Composição** e vai para a Revisão. Agendar é decisão de quem revisa.

### 2. Enviar e aprovar deixam de ser uma coisa só

O encadeamento da Fase 1 acaba. As transições que a máquina de estados já tinha viram ações separadas:

| Ação | Transição | Permissão da rota |
|---|---|---|
| Enviar para revisão | `RASCUNHO → EM_REVISAO` (exige a postagem pronta) | `POSTAGEM_EDITAR` |
| Aprovar | `EM_REVISAO → APROVADO` | `POSTAGEM_APROVAR` |
| **Aprovar e agendar** | `EM_REVISAO → APROVADO → AGENDADO`, numa transação | `POSTAGEM_APROVAR` **e** `POSTAGEM_AGENDAR` |
| Reprovar com motivo | `EM_REVISAO → RASCUNHO`, motivo obrigatório | `POSTAGEM_APROVAR` |
| Voltar para a composição | `EM_REVISAO`, `APROVADO` ou `AGENDADO` → `RASCUNHO` | `POSTAGEM_EDITAR` |
| Cancelar agendamento | `AGENDADO → APROVADO` (**aresta nova**) | `POSTAGEM_AGENDAR` |

- **Aprovar e agendar é uma chamada só, com rota própria.** O guard exige *todas* as permissões listadas, que é
  exatamente o que essa ação pede. Quem aprova mas não agenda usa a rota de aprovar: a postagem fica
  `APROVADO` — "Aprovada, falta agendar" — até alguém com `POSTAGEM_AGENDAR` escolher o horário. O horário é
  resolvido e validado **antes** da transação: horário no passado recusa tudo, e a postagem continua em revisão.
- **Autoaprovação continua regra do serviço** ([ADR 0015](0015-super-admin-e-permissoes.md), §6), e vale também
  para reprovar: o ADR 0015 dá `POSTAGEM_APROVAR` para postagens *de outros*.
- **"Voltar para a composição" usa `POSTAGEM_EDITAR`**, e não `AGENDAR`, porque editar o conteúdo de uma
  postagem aprovada ou agendada já a derrubava para rascunho com essa permissão (I-2, RF-E05). A porta explícita
  não dá poder novo, e anda na direção segura. `FALHOU → RASCUNHO` continua na rota própria, com
  `POSTAGEM_AGENDAR`, porque decidir sobre falha é dessa permissão.
- **Cancelar agendamento volta para `APROVADO`**, não para `CANCELADO`: a aprovação continua valendo, só falta um
  horário novo. I-1 continua verdadeira — só `APROVADO` e `FALHOU` chegam a `AGENDADO`. Descartar
  (`→ CANCELADO`) continua existindo na API (RF-D05); a página da postagem só não o oferece para agendada.

### 3. `Aprovacao` registra toda decisão humana de estado

Até aqui, só enviar, aprovar e a invalidação por edição deixavam linha em `Aprovacao`; agendar, cancelar e voltar
para rascunho não deixavam rastro. A Revisão mostra o histórico da postagem, então **toda mudança de status feita
por uma pessoa grava uma linha em `Aprovacao`**, na mesma transação: enviou, aprovou, reprovou (com `motivo`),
voltou para rascunho, agendou (com `agendadaPara`), desagendou, cancelou, invalidou por edição. O que o worker faz
continua em `EventoPublicacao`.

### 4. Comentários internos são de qualquer usuário logado

**Emenda o ADR 0015**, que punha "comentar" em `POSTAGEM_EDITAR`. Quem só vê também comenta: aprovar e reprovar
são decisões de poucos, mas a conversa sobre a postagem é de todo o time, e um comentário não muda a postagem —
não sobe `versao`, não muda status, não publica nada.

A regra 5 do AGENTS.md ("toda ação exige `@RequirePermission`") ganha uma exceção **fechada**: as escritas
`@AnyAuthenticated` são as do próprio perfil (sessão, senha, códigos de recuperação) e comentar postagem. Um teste
de política de rotas confere a lista; escrita nova `@AnyAuthenticated` fora dela reprova.

### 5. Comentários e histórico na mesma linha do tempo

A Revisão mostra, em ordem, a criação, as decisões de `Aprovacao`, os comentários e os marcos da publicação
(publicada, falhou, tentando de novo). O comentário fica no seu momento — "a foto 2 está escura" aparece logo
antes de "Postagem reprovada". A linha do tempo mostra **nomes**, nunca e-mail nem a resposta da Meta
(AGENTS.md, regra 3); o detalhe técnico da falha continua no histórico de publicação, recolhido.

### 6. No celular, a página da postagem esconde a barra inferior

Como num *checkout*: as ações da etapa ficam fixas no rodapé, e duas barras empilhadas apertariam a tela. Quem
esconde é a própria barra, que já é componente de cliente e lê o endereço — nada é calculado no layout
(AGENTS.md, regra 25).

## Consequências

- **RF-E01 a RF-E05 e o bloqueio de agendamento sem aprovação (RF-D01) saem da Fase 4** e entram na parte 1e.
  Ficam na Fase 4 a fila de pendências (RF-E06) e a área de administração.
- **Some a rota `ready`** e, com ela, `READY_CHAIN` e `canMarkReady()`.
- **`AcaoAprovacao` ganha valores** (`VOLTOU_RASCUNHO`, `AGENDOU`, `DESAGENDOU`, `CANCELOU`) e `Aprovacao` ganha
  `agendadaPara`. Postagens antigas têm histórico incompleto antes de 23/09/2026 — aceitável: só havia a conta de
  testes.
- **As telas de leitura e de falha deixam de existir como telas próprias**: viram o cartão de estado da Revisão.
- **O rótulo dos status não muda**: `APROVADO` continua "Pronta" na pílula; o cartão diz "Aprovada — falta agendar".
- **O docs/13 previa a composição em cinco etapas no celular** ("Etapa N de 5", com as marcações). Isso não some:
  quando as marcações chegarem (Fase 2), a Composição pode ganhar subetapas; as duas etapas deste ADR continuam
  sendo as do processo.

## Alternativas descartadas

**Uma rota de aprovar com permissão condicional** ("agenda se tiver `POSTAGEM_AGENDAR`"). A política da rota
deixaria de ser estática, e o teste de política não conseguiria conferi-la.

**Histórico derivado do estado atual**, sem gravar as decisões. Não diz quem agendou, nem quando voltou para
rascunho, nem o que aconteceu entre duas aprovações.

**Comentários sob `POSTAGEM_EDITAR`**, como dizia o ADR 0015. Quem só acompanha — um cliente, um gestor — ficaria
sem voz no único lugar em que a conversa sobre a postagem acontece.

**Mostrar Agendada, Publicando, Publicada e Falhou como etapas 3 a 6.** Nelas ninguém age, a não ser na falha; um
indicador de seis passos em que quatro são espera diria que o processo é mais longo do que é.

## Reversibilidade

**Alta** para as telas. **Média** para o banco: valores de enum não se removem no Postgres sem migration à mão
(ver [ADR 0024](0024-carrossel-e-quantidade-nao-formato.md)), mas só acrescentamos.
