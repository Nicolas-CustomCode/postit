# ADR 0004 — Despachante periódico em vez de jobs com atraso

**Data:** 2026-09-09 · **Status:** substituído pelo [ADR 0008](0008-pg-boss-em-vez-de-bullmq.md) em 2026-09-14

> A ideia central deste ADR continua valendo: a postagem agendada é uma linha no Postgres e um
> despachante a entrega para execução quando chega a hora. O que mudou foi a ferramenta de fila —
> BullMQ com Redis deu lugar ao pg-boss. O texto abaixo é mantido como registro histórico.

## Contexto

Uma postagem agendada para daqui a três semanas precisa sair no horário. O BullMQ permite enfileirar
um job com atraso arbitrário — bastaria criar o job no momento do agendamento.

## Decisão

**Não usar jobs com atraso longo.** Uma postagem agendada é uma **linha no Postgres** com status
`AGENDADO` e um horário. Um job repetível — o despachante — varre a cada minuto as postagens
vencidas e as enfileira, usando o identificador da postagem como identificador do job.

## Consequências

### Positivas

- **O Redis vira transporte descartável.** Ele carrega no máximo os próximos minutos de trabalho.
  Um `FLUSHALL`, uma troca de servidor ou uma perda de volume não apagam a programação
- **Desduplicação de graça.** Enfileirar duas vezes a mesma postagem não cria dois jobs, porque o
  identificador é o mesmo
- **A cota é conferida antes de enfileirar**, evitando tentativa condenada a falhar
- **Reagendar é um `UPDATE`**, não um cancelamento de job seguido de recriação
- **A fila é inspecionável em SQL.** Perguntar "o que sai hoje" é uma consulta ao Postgres

### Negativas

- Uma varredura por minuto, sempre — custo desprezível num índice, mas é trabalho constante
- Atraso de até um minuto entre o horário marcado e o enfileiramento. Mitigado pela folga na
  comparação de horário, e coberto pelo RNF-01 de dois minutos
- Uma peça a mais para entender: o despachante

## Alternativa considerada

**Job com atraso no momento do agendamento.** Mais simples de escrever e com precisão melhor. Foi
rejeitada por um motivo só, e é decisivo: **torna o Redis a fonte da verdade**. A falha resultante é
silenciosa — nada dá erro, simplesmente nada acontece no dia marcado. Para um sistema cujo único
trabalho é publicar na hora certa, essa é a pior falha possível.

## Verificação

O RNF-03 é testável: apagar todo o conteúdo do Redis com postagens agendadas e confirmar que elas
continuam saindo. Faz parte do roteiro da Fase 1 em [12](../12-roadmap.md).

## Reversibilidade

**Alta.** O despachante é um arquivo. Trocar de estratégia não mexe no modelo de dados nem nos
consumidores.
