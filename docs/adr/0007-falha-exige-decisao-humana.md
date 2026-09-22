# ADR 0007 — Falha definitiva exige decisão humana

**Data:** 2026-09-09 · **Status:** aceito

## Contexto

Quando uma publicação esgota as tentativas, o sistema precisa decidir o que fazer. Três posturas
possíveis:

1. Publicar assim que der, mesmo atrasado
2. Aceitar atraso até um limite definido por postagem
3. Parar e esperar decisão humana

## Decisão

**Parar e esperar.** A postagem vai para `FALHOU`, aparece destacada, notifica, e fica assim até
alguém escolher entre reagendar, corrigir ou cancelar. O sistema **nunca** publica atrasado por
conta própria.

## Justificativa

Uma postagem que falhou às 9h e foi publicada sozinha às 15h pode ser pior do que uma postagem que
não saiu:

- A promoção do dia acabou
- A data comemorativa passou
- O contexto mudou — houve notícia, houve crise, o assunto virou outro
- O conteúdo era "bom dia"

**Publicar fora de hora é um estrago visível para o público. Não publicar é um contratempo
interno.** Entre os dois, o contratempo é sempre a escolha menos ruim.

Quem sabe se aquele conteúdo específico ainda faz sentido é quem o criou. O sistema não tem como
saber, e fingir que sabe é assumir um risco que não é dele.

Isso ecoa a regra que orienta o produto inteiro, em [01](../01-visao-produto.md): **é melhor não
publicar do que publicar errado.**

## Consequências

### Positivas

- Nenhuma surpresa. Nada vai ao ar fora do horário aprovado
- O comportamento é previsível e fácil de explicar
- Obriga o sistema a ser bom em notificar e em explicar o erro — o que é bom por si só

### Negativas

- Exige que alguém esteja atento. Falha às 3h da manhã só é resolvida de manhã
- Postagem atemporal, que poderia sair atrasada sem prejuízo, também espera
- A notificação precisa funcionar de verdade, senão a postagem morre no painel

## Alternativas consideradas

**Publicar assim que der.** Rejeitada: transfere para o sistema uma decisão editorial que ele não
tem informação para tomar.

**Janela de tolerância por postagem.** O usuário definiria quanto atraso aceita em cada postagem.
Mais flexível e tecnicamente viável. Rejeitada **para o MVP** por dois motivos: adiciona um campo e
um ramo de lógica no caminho mais crítico do sistema, e presume que o usuário consegue prever, no
momento da composição, quanto atraso será aceitável numa situação que ainda não aconteceu.

Continua sendo a evolução natural desta decisão, se o comportamento atual incomodar na prática.

## Contrapartida obrigatória

Como o sistema não age sozinho, ele precisa ser **excelente** em avisar:

- Notificação por canal que não exige a tela aberta (RF-F08)
- Mensagem em português dizendo o que houve **e** qual a próxima ação (RNF-07)
- As três ações a um clique: reagendar, corrigir, cancelar
- Destaque no painel enquanto a decisão não for tomada

Sem isso, a decisão vira omissão.

## O teto de 45 minutos — acrescentado em 22/09/2026

A regra dos 15 minutos vale para o **início**. Uma postagem que começou no horário e caiu em retentativa
podia, pela espera real do pg-boss (1–2, 2–4, 4–8 e 8–15 minutos entre as tentativas, mais o preparo do
container), sair bem depois de 45 minutos — e o docs/09 prometia "uns 20".

Decidido: **passados 45 minutos do horário marcado, nenhuma tentativa cria container nem publica.** A
postagem vai para `FALHOU` com a causa `LATE_CEILING` e espera decisão humana, como qualquer outra falha
definitiva. É o mesmo raciocínio desta decisão, levado ao fim da linha: uma postagem das 10h não sai
quase às 11h sem ninguém decidir.

## Reversibilidade

**Alta.** Passar a aceitar atraso automático, ou adicionar janela de tolerância por postagem, é
mudança localizada no consumidor da fila `publicar`.
