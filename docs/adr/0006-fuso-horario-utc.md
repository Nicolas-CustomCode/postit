# ADR 0006 — Horário em UTC, fuso IANA por conta

**Data:** 2026-09-09 · **Status:** aceito

## Contexto

Agendar é o coração do sistema, e fuso horário é onde o agendamento quebra. Contas diferentes podem
operar em fusos diferentes, e o horário de verão muda o deslocamento ao longo do ano.

## Decisão

- `Postagem.publicarEm` é `timestamptz` e guarda **sempre o instante em UTC**
- `Conta.fusoHorario` guarda o **identificador IANA** — `America/Sao_Paulo` — nunca o
  deslocamento
- A conversão acontece **só na borda da interface**. Nada no domínio, no worker ou no banco raciocina
  em horário local
- O container do Postgres roda com `TZ=UTC`

## Consequências

### Positivas

- Comparação de horário é trivial e correta: o despachante compara instantes, não representações
- Duas contas em fusos diferentes convivem sem gambiarra
- Transição de horário de verão não desloca agendamento já feito
- A auditoria registra instantes absolutos, sem ambiguidade

### Negativas

- Toda exibição precisa converter. Esquecer numa tela produz horário errado na cara do usuário
- A biblioteca de datas precisa carregar a base IANA
- Dois casos-limite exigem decisão explícita, e estão nos testes obrigatórios de
  [09](../09-motor-agendamento.md)

## Por que o identificador IANA e não o deslocamento

O deslocamento muda com o horário de verão. Se o Brasil voltar a adotá-lo, um agendamento gravado
como `-03:00` para uma data de dezembro estaria uma hora errado.

**O identificador carrega as regras; o deslocamento carrega só uma foto delas.**

A consequência prática: a conversão precisa usar as regras vigentes **na data alvo**, não as de
hoje. Converter um agendamento de outubro usando o deslocamento de setembro é o erro clássico, e é
silencioso — ninguém percebe até a postagem sair na hora errada.

## Casos-limite

| Caso | Decisão |
|---|---|
| Horário que **não existe** na transição — o relógio pula | Recusar no agendamento, com explicação |
| Horário que **acontece duas vezes** — o relógio volta | Escolher a primeira ocorrência, de forma determinística |

Ambos com teste no domínio.

## Reversibilidade

**Alta em teoria, alta dor na prática.** Mudar depois exigiria reinterpretar todo horário já
gravado, sem saber com certeza qual foi a intenção original. É o tipo de decisão que se toma uma
vez.
