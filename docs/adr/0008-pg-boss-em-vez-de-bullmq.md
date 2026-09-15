# ADR 0008 — pg-boss em vez de BullMQ com Redis

**Data:** 2026-09-14 · **Status:** aceito · **Substitui:** [ADR 0004](0004-despachante-bullmq.md)

## Contexto

O [ADR 0004](0004-despachante-bullmq.md) definiu que a postagem agendada é uma linha no Postgres e
que um despachante a entrega para execução quando chega a hora. A fila de execução escolhida foi o
BullMQ, que guarda tarefas no Redis.

Ao revisar o desenho, ficou claro que o BullMQ fazia pouco trabalho:

- a agenda, as tentativas, os estados e a auditoria já estavam no Postgres
- o Redis existia **apenas** para servir o BullMQ
- havia duas fontes de informação que podiam discordar entre si

E havia uma contradição: a regra "nada de job com atraso longo" existia porque o Redis podia ser
apagado, mas a coleta de métricas em T+7d estava documentada justamente como job com atraso de sete
dias no Redis.

## Decisão

**Usar o [pg-boss](https://pgboss.io)**, uma biblioteca de filas que guarda as tarefas num esquema
próprio (`pgboss`) dentro do PostgreSQL. **Remover o Redis** do projeto.

Continua valendo do ADR 0004:

- a postagem agendada é linha na tabela `Postagem`, não tarefa com início atrasado — reagendar pelo
  calendário é um `UPDATE`
- um despachante, agora uma tarefa recorrente do pg-boss, entrega as postagens vencidas

O que muda:

- o despachante muda o status da postagem e cria a tarefa **na mesma transação**, usando o adaptador
  do pg-boss para Prisma (`db: fromPrisma(tx)`)
- a retentativa com espera crescente é configurada na fila, não escrita à mão
- tarefas que ninguém altera depois de criadas — coleta de métricas — usam início atrasado
- tentativas esgotadas vão para uma fila de falhas, cujo tratador marca `FALHOU` e notifica

Detalhamento em [09 — Motor de agendamento](../09-motor-agendamento.md).

**Onde roda:** com a arquitetura do [ADR 0010](0010-monorepo-next-nest-bff.md), o pg-boss vive só no
processo worker — o mesmo código Nest da API, iniciado sem HTTP. O processo HTTP da API não carrega o
módulo de filas.

## Consequências

### Positivas

- **Um serviço a menos** no servidor: sem Redis para instalar, configurar persistência, monitorar
  memória ou incluir no plano de backup
- **Transação única** para estado e tarefa: não existe mais "marcou mas não enfileirou"
- **Tarefas entram no backup** do banco junto com as postagens
- **Tudo consultável em SQL**, inclusive o estado das filas
- A contradição das métricas em T+7d desaparece
- **Painel oficial** (`@pg-boss/dashboard`) para ver e reprocessar falhas, atendendo o RF-H03 sem
  código próprio

### Negativas

- **Não é o seu padrão.** Seus outros projetos usam BullMQ; o pg-boss é uma biblioteca nova para
  aprender
- **Exige Node 22.12 ou mais novo** e PostgreSQL 13 ou mais novo (versão 12.x,
  [npm](https://registry.npmjs.org/pg-boss/latest))
- **Carga extra no banco:** o pg-boss consulta a fila a cada 2 segundos por padrão. Irrelevante no
  volume previsto
- **Esquema a mais no banco**, que as migrações do Prisma precisam ignorar. Não há guia oficial sobre
  convivência com ORM; há uma
  [discussão da comunidade](https://github.com/timgit/pg-boss/discussions/391) indicando que não há
  conflito por ser esquema separado. Regra prática: se o Prisma um dia usar vários esquemas, não
  incluir `pgboss` na lista

## Alternativas consideradas

**Manter BullMQ com Redis.** A melhor escolha para volume alto, muitas máquinas processando ao mesmo
tempo ou fluxos encadeados complexos. Nenhum desses cenários existe aqui, e o custo de um segundo
banco não se paga.

**Só Postgres, com código próprio.** Consulta periódica com `SELECT ... FOR UPDATE SKIP LOCKED` e um
limite de paralelismo escrito à mão. Também elimina o Redis. Rejeitada porque exigiria escrever e
testar retentativa, espera crescente, tarefas recorrentes e tarefas com início atrasado — cerca de
150 linhas que o pg-boss já entrega testadas, com painel incluído.

**Graphile Worker.** Outra fila sobre Postgres, com boa reputação. Não houve motivo para preferir
sobre o pg-boss, que tem adaptador direto para Prisma.

## Reversibilidade

**Alta.** O despachante e os tratadores recebem só o identificador da postagem; a fila é detalhe de
transporte. Voltar para BullMQ exigiria recolocar o Redis e perder a transação única, mas não mexe
no modelo de dados.
