# ADR 0017 — PWA instalável e notificações push

**Data:** 2026-09-15 · **Status:** aceito · **Complementa:** [ADR 0014](0014-csp-e-cabecalhos-de-seguranca.md)

## Contexto

O RF-F08 exige avisar falhas "por um canal que não exige o usuário estar com a tela aberta", e a
infraestrutura previa só um genérico `NOTIFICACAO_WEBHOOK_URL`, sem decidir canal nem destinatário.

Ao mesmo tempo, ficou decidido que o sistema precisa **funcionar por completo no celular** — compor, enviar
vídeo, marcar pessoas, calendário — o que torna natural que ele possa ser **instalado** como um aplicativo.

Referências nos repositórios do dono do projeto:

- `nossobuncker` já é **PWA** com Serwist, com páginas autenticadas em `NetworkOnly` e página offline; tem um
  sino de notificações e planejou push em detalhes, sem implementar
- `alivio-crm` tem o modelo mais maduro de notificação, com **entregas por usuário** e restrição que impede
  entrega duplicada
- `nossobuncker` guarda na notificação **só identificadores**, montando a frase na leitura — melhor para
  privacidade

Nenhum dos projetos tem push web em produção.

## Decisão

### 1. PWA instalável

- **Serwist**, como no `nossobuncker`: `manifest.ts` do Next, service worker, página offline
- **Nenhum dado pessoal em cache.** Páginas autenticadas e chamadas de dados usam `NetworkOnly`. Só
  arquivos estáticos do app são guardados. A auditoria de segurança do `nossobuncker` registrou o problema
  oposto — HTML com dado pessoal em cache sobrevivendo ao logout — e ele não se repete aqui
- Sem funcionamento offline além da página "sem conexão"

### 2. Duas camadas de notificação

| Camada | Para quê |
|---|---|
| **Sino dentro do sistema** | Sempre. Lista das notificações, marcar como lida. Não depende de nada externo |
| **Push** | Para quem ativou notificações naquele aparelho. Chega com o sistema fechado |

O sino é a garantia: se o push não chegar — aparelho sem permissão, inscrição vencida —, a notificação
continua lá.

### 3. Como o push funciona

O navegador de cada aparelho, ao autorizar notificações, gera uma **inscrição**: um endereço do serviço de
push do fabricante do navegador. O worker envia a mensagem para esse endereço, e o fabricante a entrega ao
aparelho.

- Biblioteca `web-push`, com um par de chaves **VAPID** que identifica o PostIt perante os serviços de push
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
- A mensagem é cifrada de ponta a ponta pelo protocolo de push: o fabricante do navegador transporta, mas
  não lê
- **Mesmo assim, o conteúdo do push não leva dado sensível.** Só um título genérico e um link — por exemplo,
  "Uma publicação falhou". Detalhes só dentro do sistema, com a pessoa logada. Push aparece na tela bloqueada
  do celular
- Envio pelo **worker**, na fila `notificar`
- Inscrição que o serviço de push devolve como inexistente ou expirada é **apagada**

**iPhone:** push web só chega com o PostIt **instalado na tela inicial**, a partir do iOS 16.4 — informação
a confirmar na documentação da Apple (item V-21).

### 4. Destinatários por responsabilidade

| Tipo | Recebe |
|---|---|
| `PUBLICACAO_FALHOU` | Quem agendou a postagem e quem tem `POSTAGEM_AGENDAR` |
| `AGUARDANDO_APROVACAO` | Quem tem `POSTAGEM_APROVAR` — o autor só se também tiver `POSTAGEM_APROVAR_PROPRIA` |
| `TOKEN_EXPIRANDO` | Quem tem `CONTA_GERENCIAR` e super admins |
| `CONTA_SEM_ACESSO` | Quem tem `CONTA_GERENCIAR` e super admins |
| `PROCESSAMENTO_TRAVADO` | Super admins |
| `CONTA_BLOQUEADA` | Super admins — o texto do push não inclui o e-mail bloqueado |

- Super admin tem todas as permissões, então recebe tudo por padrão
- **Cada pessoa escolhe, por tipo, se quer push.** O sino recebe sempre
- Os destinatários são calculados **no momento do envio**, com as permissões daquele instante

### 5. Modelo de dados

| Tabela | O que guarda |
|---|---|
| `Notificacao` | Tipo e alvo — **só identificadores**. A frase é montada na leitura |
| `NotificacaoEntrega` | Uma por destinatário: lida quando, push enviado quando. Única por notificação e usuário |
| `InscricaoPush` | Endereço e chaves da inscrição, aparelho, último sucesso, falhas seguidas |
| `PreferenciaNotificacao` | Usuário, tipo, push ligado ou desligado |

Detalhes em [07](../07-modelo-dados.md).

### 6. CSP

A política do [ADR 0014](0014-csp-e-cabecalhos-de-seguranca.md) ganha duas diretivas:

| Diretiva | Valor | Por quê |
|---|---|---|
| `worker-src` | `'self'` | Permite o service worker do próprio app |
| `manifest-src` | `'self'` | Permite o manifesto de instalação |

## Consequências

### Positivas

- Avisos chegam com o sistema fechado, sem serviço externo pago nem número de telefone
- O sistema vira um app instalável no celular
- Destinatários certos, sem ruído, com controle individual

### Negativas

- **Push depende de cada pessoa autorizar em cada aparelho.** Quem nunca autorizou só vê o sino
- **No iPhone, só com o app instalado na tela inicial**
- **Se o servidor inteiro cair, ninguém recebe push** — quem envia é o worker. Sem monitoramento externo, por
  decisão registrada no [ADR 0021](0021-dump-manual-e-sem-monitoramento-externo.md)
- Mais uma peça: service worker, que exige cuidado com cache

## Alternativas consideradas

**WhatsApp via Evolution API.** Chega onde as pessoas olham, mas depende de um número conectado — se cair,
os avisos param — e de mais um serviço para manter.

**Telegram.** Estável e gratuito, mas exige que todos usem Telegram.

**E-mail.** Exigiria serviço de envio, que o sistema não tem.

## Reversibilidade

**Alta.** A notificação é gerada independentemente do canal. Acrescentar outro canal — e-mail, WhatsApp — é
um novo tipo de entrega, sem mexer em quem decide os destinatários.
