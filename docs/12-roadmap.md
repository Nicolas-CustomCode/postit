# 12 — Roadmap

Seis fases, cada uma com marco verificável. A regra que ordena tudo: **a Fase 1 entrega uma
publicação real, de ponta a ponta, no menor escopo possível.** Tudo depois disso é ampliação de um
caminho que já funciona.

Publicar uma única imagem de feed automaticamente, no horário certo, sem duplicar, é o problema
difícil. Carrossel, Reels, calendário e aprovação são variações dele.

---

## Pré-requisitos

Confirmar antes de começar. Nenhum deles depende de aprovação da Meta — pelo enquadramento de
Standard Access explicado em [08](08-integracao-instagram.md#níveis-de-acesso-e-app-review), este
projeto **não precisa de App Review**.

**Uma vez só:**

- [ ] **Dois** aplicativos no painel da Meta, com o produto Instagram configurado: **PostIt Dev**
      (desenvolvimento local) e **PostIt** (produção) — nada de "Insta" no nome
      ([ADR 0016](adr/0016-nome-do-produto.md), [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md),
      [ADR 0019](adr/0019-sem-homologacao.md))
- [ ] Escopos `instagram_business_basic`, `instagram_business_content_publish` e
      `instagram_business_manage_insights` habilitados nos dois — e nenhum outro
- [ ] URIs de retorno registradas: a do túnel no PostIt Dev (trocar se o túnel mudar); a de produção no PostIt
- [ ] Uma **conta de Instagram profissional de testes**, adicionada como Instagram Tester no PostIt Dev — e, se
      possível, uma segunda, para testar várias contas no computador
- [ ] `cloudflared` instalado para o **túnel rápido** do desenvolvimento — sem conta nem domínio
      ([ADR 0022](adr/0022-tunel-rapido-no-desenvolvimento.md))
- [ ] Repositório no GitHub, com GitHub Actions habilitado
- [ ] VPS com **Easypanel** ([ADR 0020](adr/0020-easypanel-na-validacao.md)), com senha forte no painel e acesso por https
- [ ] Dois nomes DNS apontando para a VPS: app e mídia de produção, (se o DNS estiver na Cloudflare, como "somente DNS")

**Para cada conta do Instagram** — repetir a cada conta nova, conforme
[08](08-integracao-instagram.md#cada-conta-precisa-ser-cadastrada-no-aplicativo):

- [ ] A conta é **Business ou Creator**
- [ ] A conta foi adicionada no painel do aplicativo com o papel **Instagram Tester**
- [ ] O convite de testador foi **aceito** dentro da conta do Instagram

---

## Fase 0 — Fundação

**Objetivo:** o monorepo de pé com os três processos, login funcionando, uma conta do Instagram
conectada e o token se renovando sozinho.

A Fase 0 é maior do que seria num app Next sozinho: é o preço de começar com a fundação organizada
([ADR 0010](adr/0010-monorepo-next-nest-bff.md)). Por isso ela está dividida em três blocos.

**Bloco A — esqueleto do monorepo**

| Entrega | Requisitos |
|---|---|
| npm workspaces + Turborepo, `tsconfig.base.json` sem `paths`, escopo `@repo/*` | — |
| `apps/web`: Next.js 16, TypeScript strict, Tailwind v4, shadcn/ui | — |
| `apps/api`: NestJS 11 com Fastify, escutando em `127.0.0.1`, com `main.ts` e `worker.ts` | RNF-13 |
| `packages/shared` com os primeiros schemas zod | — |
| `packages/database` com schema Prisma completo e primeira migração | Todo o [07](07-modelo-dados.md) |
| Variáveis de ambiente validadas com zod no boot dos três processos | — |
| `docker-compose.yml` com Postgres e MinIO; script de preparação do bucket | — |
| `Dockerfile` único com os comandos `web`, `api` e `worker`; projeto no Easypanel com os cinco serviços | — |
| Túnel rápido `npm run tunnel`: dois túneis, app e mídia | RNF-16 |
| `scripts/version.mjs` e hook de pre-commit; versão em `/health` | — |
| CI no GitHub Actions: typecheck, lint, Jest com Postgres, `npm audit`, varredura de segredos, build; CodeQL e Dependabot | — |
| Playwright configurado, com Meta falsa e viewports de desktop e celular | RNF-15 |
| PWA com Serwist: manifesto, service worker sem dado pessoal, página offline | RF-J05 |

**Bloco B — autenticação, fronteiras e proteção do navegador**

É o bloco mais trabalhoso da fundação, e o motivo está em [ADR 0013](adr/0013-autenticacao-com-duas-etapas.md):
uma ferramenta que publica em contas reais não pode ter login frágil. Nada do Bloco C começa antes de
este bloco passar nos marcos 2 a 12.

| Entrega | Requisitos |
|---|---|
| Senha com argon2id, hash isca, política de 12 a 128 caracteres | RF-H01 |
| Sessão opaca com inatividade de 7 dias e teto de 30; cookie `__Host-sessao` ou `sessao` conforme `APP_URL` | RF-H01 |
| Desafio de login e verificação em duas etapas com anti-reuso e códigos de recuperação | RF-H04 |
| Proteção contra tentativas repetidas por conta e por IP | RF-H05 |
| Comandos `admin:create` (com `--super-admin`), `admin:promote`, `admin:reset-password`, `admin:reset-2fa` e telas de cadastro e redefinição | RF-H06, RF-I01 |
| Tela de perfil: trocar senha, gerar códigos, sessões ativas | RF-H07 |
| Guardas globais na API: chave interna, sessão, autorização negar por padrão | RNF-13 |
| Catálogo de permissões, `PermissaoUsuario`, `superAdmin` e decorators `@RequirePermission`, `@SuperAdmin`, `@RecentConfirmation` — sem tela ainda; o primeiro usuário é super admin | RF-I01, RF-I04 |
| Teste de matriz de permissões e da invariante do último super admin | RF-I04, RF-I09 |
| `lib/api/client.ts` lendo só `X-Real-IP`, `requireSession()` com `cache()`, `safeRedirect()` | RF-H01 |
| CSP com nonce no `proxy.ts` e cabeçalhos de segurança no `next.config` | RNF-14 |
| Teste de política de rotas com descoberta automática e teste de arquitetura (só o worker publica) | RNF-13 |

**Bloco C — contas do Instagram**

A coleta diária das métricas da conta começa já aqui, mesmo sem tela, porque **a Meta só guarda 90 dias**: cada
dia sem coletar é um dia de histórico que pode ser perdido. A tela vem na Fase 5.

| Entrega | Requisitos |
|---|---|
| Módulo de cifra AES-256-GCM | RNF-06 |
| Módulo `instagram` com cliente único e remoção de token dos erros | RNF-06 |
| Fluxo OAuth: retorno no Next, lógica na API, `state` vinculado ao usuário | RF-A01, RF-A02 |
| Orientação de cadastro da conta como testadora | RF-A08 |
| pg-boss no worker e a tarefa recorrente `renovar-tokens-instagram` | RF-A03 |
| Tarefa recorrente `coletar-metricas-conta-instagram`, **sem tela ainda** | RF-G06 |
| Listagem de contas com prazo do token | RF-A04, RF-A06 |
| Seletor de conta ativa na barra lateral e no topo do celular; rotas `/c/<conta>/…`; última conta em cookie | RF-A09 |

**Marco verificável:**
1. `turbo build` compila os três pacotes; a primeira tag sobe no Easypanel, com `api`, `worker` e `web` de pé — ainda **sem nenhuma conta real conectada**; um push na `main`
   dispara a CI completa, e ela passa
1a. Pelo túnel, o PostIt local abre no endereço `….trycloudflare.com` no celular, instala como aplicativo, e abrir
   sem conexão mostra só a página "sem conexão"
2. De fora do servidor, **nada responde como a API**; de dentro, chamada sem chave interna é recusada
3. Uma rota nova da API criada sem declaração de acesso **faz o teste de política de rotas falhar**
4. Criar o primeiro usuário por `admin:create --super-admin`, definir a senha pelo link e cadastrar a verificação em
   duas etapas
5. Senha certa sem código **não** entra; o mesmo código usado duas vezes é recusado; um código de
   recuperação entra uma vez e não entra na segunda
6. 11 senhas erradas seguidas bloqueiam a conta, e a tela mostra até que horas
7. E-mail inexistente e senha errada dão a mesma mensagem
8. Entrar, sair e tentar reusar o cookie antigo — a sessão não vale mais
9. `/entrar?voltar=//site-externo.com` e `/entrar?voltar=/\site-externo.com` levam para a tela inicial
10. Enviar um `X-Forwarded-For` falso não muda o IP registrado na tentativa de acesso
11. Toda página tem CSP com nonce diferente a cada carregamento, e o app não abre dentro de `<iframe>`
12. Uma Server Action disparada de outro domínio é recusada, pelo túnel — item V-16, confirmado de novo no
    proxy de verdade na estreia em produção
13. Conectar a **conta de testes** pelo fluxo OAuth, no computador local, do início ao fim
14. Conectar uma **segunda conta de testes** e confirmar que as duas convivem, cada uma com seu token. Sem
    segunda conta de testes, isso é confirmado na estreia em produção, ao conectar as contas reais
15. O token do Instagram e o segredo das duas etapas aparecem cifrados no banco — inspecionar as colunas
    e confirmar que são ilegíveis
16. Forçar a execução da renovação de tokens no worker e ver `tokenExpiraEm` avançar
17. Buscar por fragmentos de senha, código, token do Instagram ou de sessão nos logs dos três processos e
    **não encontrar nada**
18. Tentar conectar uma conta pessoal e receber a recusa explicada
19. Tentar conectar uma conta **não cadastrada** como testadora e receber a orientação de cadastro
20. Rodar `prisma migrate dev` com o pg-boss já iniciado e confirmar que o esquema `pgboss` não é
    tocado — item V-14
21. Rodar `admin:collect-metrics` e ver linhas em `MetricaConta` com dias **consecutivos**, o dia batendo
    com o calendário do fuso da conta, e ao menos uma métrica **ausente** do JSON — não zerada

**Validações a resolver nesta fase:** V-16 (origem das Server Actions atrás do proxy). **V-17 (API do
`otplib`) foi resolvido em 16/09/2026.** **V-18 (URI de retorno pelo túnel https), V-10 (cadastro da conta
testadora) e V-14 (pg-boss com Prisma) foram resolvidos em 17/09/2026** — do V-10 falta só anotar os nomes
dos menus na próxima conta.

**Confirmados em 17/09/2026, com a conta de testes:** marcos **13** (conexão pelo fluxo OAuth completo, pelo
túnel), **15** (token do Instagram cifrado no banco — coluna começando em `v1:` e ilegível), **18** e **19**
(as duas recusas explicadas, cobertas por teste contra a Meta falsa), **17** (nenhum fragmento de segredo nos
logs dos três processos) e **20** (migração do Prisma com o pg-boss já iniciado, esquema `pgboss` intocado —
item V-14). O marco **14** está coberto por teste automático; no mundo real depende de haver uma segunda
conta de testes.

**Confirmado em 18/09/2026:** marco **21** — a primeira coleta gravou **30 linhas** (20/08 a 18/09), dias
consecutivos, com o dia batendo com o calendário de Brasília. Cinco métricas vieram com valor `0` e
`follows_and_unfollows` ficou **ausente** do JSON, que é a distinção que a RF-G07 exige. Duas descobertas
registradas no [08](08-integracao-instagram.md): o retroativo alcança dias **anteriores à conexão** da
conta, e pedir as seis métricas juntas **é aceito** — o caminho de uma-métrica-por-vez não precisou entrar.

**Confirmado em 18/09/2026:** marco **6** — onze senhas erradas bloquearam a conta, e a tela mostrou
"Muitas tentativas. Tente de novo a partir das 09:19", com o horário no fuso do aparelho. O bloqueio
correspondente ficou em `BloqueioAcesso` com nível 1 e 15 minutos. A regra já tinha teste de integração;
o que faltava era a **frase na tela**, que nenhum teste de tela exercita.

⚠️ **Não existe caminho para liberar um bloqueio antes da hora.** `BLOCK_RELEASED` está no enum de
auditoria, mas nenhum código o usa — a liberação é da área de administração, que só chega na Fase 4.
Até lá, quem se bloquear testando espera o prazo ou apaga a linha de `BloqueioAcesso` à mão.

**O marco 16 fica para 18/09/2026 ou depois.** A renovação está pronta e coberta por teste de integração
contra a Meta falsa, mas a Meta só renova token com **pelo menos 24 horas de idade**, e a conta de testes foi
conectada em 17/09. Para forçar, use `npm run admin:refresh-tokens` — só age em conta cujo token já passou de
30 dias, então antes disso é preciso envelhecer `tokenRenovadoEm` ou `criadoEm` daquela linha à mão.

**Risco da fase:** a URI de retorno precisa bater exatamente com a registrada no painel da Meta,
inclusive barra final. É o erro mais comum e o mais chato de diagnosticar.

---

## Fase 1 — Publicar uma imagem de feed

**Objetivo:** o caminho crítico inteiro. Uma imagem sai automaticamente, no horário, sem duplicar.

**Esta é a fase que prova o projeto.** Se ela funcionar, o resto é ampliação.

| Entrega | Requisitos |
|---|---|
| Envio direto ao MinIO com política assinada, prefixos `recebidos/` e `publicas/` | RF-B01 |
| Especificações de imagem em `packages/shared` e validador na API: JPEG, 8 MB, proporção, largura | RF-B02, RF-B03 |
| Nome público da mídia servido pelo proxy, só em `publicas/` | RNF-09 |
| Composição mínima: conta, mídia, legenda, texto alternativo | RF-C01, RF-C03, RF-B05 |
| Contadores de caracteres, hashtags e menções | RF-C03 |
| Validação da mídia contra o formato de destino | RF-B03 |
| Agendamento com fuso da conta e conversão para UTC | RF-D01, RF-D03, RNF-08 |
| Máquina de estados com as nove invariantes, em `apps/api/src/domain/` | [05](05-arquitetura.md) |
| Controle de versão da postagem contra edição simultânea | RF-C12 |
| Notificações: sino, push, destinatários, preferências — começando por `PUBLICACAO_FALHOU` | RF-F08, RF-J01 a RF-J04 |
| Despachante recorrente no worker, com mudança de status e criação da tarefa na mesma transação | RNF-01, RNF-03 |
| Publicador com as duas etapas e o polling | RF-F01 a RF-F03 |
| As quatro camadas de idempotência | RF-F04, RNF-02 |
| Classificação de erro e retentativa pela fila do pg-boss | RF-F05, RF-F06 |
| `FALHOU` com decisão humana, fila de falhas e notificação | RF-F07, RF-F08 |
| Tolerância de 15 minutos de atraso | RF-F11 |
| Auditoria em `EventoPublicacao` | RF-F09, RNF-10 |
| Guarda de cota | RF-D09, RNF-04 |
| Lista de postagens com status | — |

**Marco verificável — o roteiro de fogo.** Roda **no computador local, pelo túnel, com a conta de Instagram de
testes** e o app PostIt Dev — nunca numa conta real. Não há homologação ([ADR 0019](adr/0019-sem-homologacao.md)). Os testes que não dependem da Meta real também existem no Playwright
([15](15-qualidade-e-fluxo-de-trabalho.md)).

| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Agendar uma imagem para dali a 5 minutos | Publica sozinha, em até 2 minutos do horário |
| 2 | Conferir o perfil no Instagram | A postagem está lá, com legenda e texto alternativo corretos |
| 3 | Enviar um PNG | Recusado no envio, com a mensagem certa |
| 4 | Enviar JPEG de 12 MB | Recusado no envio, informando o limite de 8 MB |
| 5 | Enviar imagem 9:16 e usá-la numa postagem de feed | **Entra no acervo** (serve para Stories); a composição recusa para o feed, informando a faixa de 4:5 a 1.91:1, e oferece o recorte |
| 6 | Executar o publicador da mesma postagem duas vezes em paralelo | **Uma única publicação** |
| 7 | Parar o worker, deixar passar 20 minutos do horário de uma postagem agendada e religar | **Nada é publicado**; a postagem vai para `FALHOU` com a causa "sistema indisponível" |
| 8 | Invalidar o token e agendar | Vai para `FALHOU`, mensagem pede reconexão, conta sinalizada |
| 9 | Apontar a mídia para URL inexistente | Falha com a mensagem de download, não com erro cru |
| 10 | Matar o worker no meio de uma publicação e reiniciar | Retoma sem duplicar |
| 11 | Buscar token nos logs de tudo acima | Nada encontrado |
| 12 | Tentar ler pelo nome de mídia um arquivo recém-enviado, antes da validação | **Acesso negado** — só `publicas/` é legível |
| 13 | Enviar ao MinIO sem política assinada, ou maior que o tamanho autorizado | Recusado pelo armazenamento |
| 14 | Fazer uma publicação falhar com o push ativado num celular | Push "Uma publicação falhou", **sem nome da conta nem motivo**; tocar abre a postagem com a causa |
| 15 | Abrir a mesma postagem em dois aparelhos e salvar nos dois | O segundo recebe o aviso de conflito e não perde o que digitou |
| 16 | Compor, marcar pessoas e agendar pelo celular | Tudo funciona sem computador |

O teste 6 é o mais importante do projeto inteiro. Se ele falhar, nada mais importa.

**Confirmados em 18/09/2026, com o envio de mídia (parte 1a):** testes **3** (PNG recusado com a mensagem
certa), **4** (acima de 8 MB recusado — e **pelo próprio armazenamento**, antes de a API ver o arquivo, que é
o que o RF-B02 pede), **12** (`recebidos/` devolve 403 e `publicas/` devolve 200) e **13** (envio sem
política assinada é recusado). Os quatro cobertos por teste automático contra o MinIO de verdade, e o V-15
resolvido junto.

⚠️ **O teste 5 mudou de sinal** na mesma data. Ele dizia "imagem 2:1 é recusada no envio", o que só
valeria se o acervo fosse de feed — e ele é compartilhado entre formatos (RF-B03, RF-B04). A metade do
envio está confirmada (a imagem entra, e a tela oferece o recorte para o feed); **a metade da
composição foi fechada em 20/09/2026**, com a parte 1b: anexar uma imagem 9:16 a uma postagem de feed
é recusado com a faixa na mensagem, e o envio feito de dentro da composição já conhece o formato de
destino — lá não existe "enviar como está", porque o arquivo entraria no acervo e a API recusaria
anexá-lo em seguida.

**Entregue em 20/09/2026 — parte 1b, "a postagem existe":** máquina de estados com as invariantes I-1
a I-4 em `apps/api/src/domain/post/`, módulo `posts/` com as oito rotas sob `accounts/:accountId`,
controle de versão contra edição simultânea (RF-C12), contadores da legenda, e as telas de Postagens e
Compor — esta última no desenho do artboard, com a prévia do feed.

**Entregue em 20/09/2026 — parte 1c, "agendar":** conversão de relógio para instante em
`apps/api/src/domain/time/zone.ts`, com os quatro casos obrigatórios do
[09](09-motor-agendamento.md#fuso-horário) testados; agendar, reagendar e cancelar (RF-D01, RF-D03 a
RF-D05); e a seção "Quando publicar" com o fuso da conta. A mesma mudança **corrigiu um defeito
silencioso nas métricas**: em fusos que mudam o relógio à meia-noite, a janela do dia saía uma hora
deslocada.

**Entregue em 21/09/2026 — o Acervo passa a servir para alguma coisa.** Até então ele recebia imagens
que nunca eram usadas: não havia rota de leitura de mídia, a tela não listava, e a composição mandava
uma imagem nova a cada postagem. Agora `GET /media` existe, o Acervo lista, e a composição escolhe
dali — o RF-B04, que estava previsto para a Fase 2.

**Antecipado da Fase 2 na mesma passagem:** o formato virou escolha entre **imagem de feed e
Stories** (RF-C02 parcial) e o aviso de recursos indisponíveis do RF-C11. O motivo de antecipar: o
validador por formato já existia desde a parte 1a-bis e não tinha quem o exercitasse na tela — e sem
escolher formato, "o acervo serve a qualquer formato" era promessa sem uso. Carrossel, Reels e vídeo
continuam na Fase 2, porque dependem do validador de vídeo.

**Falta desta fase:** o motor de publicação — despachante, publicador, as quatro camadas de
idempotência, notificações (1d). Sem ele, uma postagem agendada fica esperando para sempre.

Sobraram para o roteiro de fogo, quando houver publicação: os testes **1**, **2**, a segunda metade do
**5**, **6** a **11**, **14**, **15** e **16**.

**Depois do roteiro de fogo: a estreia em produção.** Marcar a versão, fazer o deploy dela no Easypanel e
seguir a [estreia em produção](10-infra-deploy.md#estreia-em-produção) — cabeçalhos, `X-Real-IP`, V-15, V-16,
login, push, a primeira publicação acompanhada e o teste de dump e restauração — **antes** de conectar as demais contas reais.

**Validações da lista V do [08](08-integracao-instagram.md)** a resolver nesta fase: V-1 e V-3 (a
cota), V-5 e V-6 (a URL da mídia), V-13 (`singletonKey` do pg-boss), V-22 e V-23 (Traefik do Easypanel, na
estreia) e V-24 (limite de 100 MB da Cloudflare). Registrar o resultado no próprio documento 08.

**V-15 foi resolvido em 18/09/2026**, pelo túnel: a assinatura da política não cobre o endereço, então ela
sobrevive ao proxy. Falta só repetir no proxy de verdade, na estreia.

---

## Fase 2 — Os demais formatos

**Objetivo:** carrossel, vídeo de feed, Reels e Stories, mais marcações e colaboradores.

| Entrega | Requisitos |
|---|---|
| Validador de vídeo: container, codec, duração, taxa de quadros, átomo `moov` | RF-B02, RF-B03 |
| Upload resumível para vídeos grandes | RF-F10 |
| Carrossel com ordenação e containers pai e filho | RF-C04, RF-C02 |
| Reaproveitamento de containers filhos na retomada | RNF-02 |
| Reels com capa, aparição no feed e nome do áudio | RF-C07, RF-C08 |
| Stories com o aviso de recursos indisponíveis | RF-C11 |
| Marcação de pessoas com coordenadas | RF-C05 |
| Colaboradores, limitados a 3 | RF-C06 |
| Sinalização de conteúdo gerado por IA | RF-C09 |
| Prévia por formato, com o recorte correto | RF-C10 |
| Reaproveitamento de mídia | RF-B04 |

**Marco verificável:**
1. Publicar um carrossel de 3 imagens, com a ordem correta no perfil
2. Publicar um Reels com capa escolhida e conferir a capa no perfil
3. Publicar um Story e conferir que sai e some em 24h
4. Publicar imagem com 2 marcações e conferir a posição delas
5. Enviar um vídeo de 2 minutos como Story — recusado, informando o limite de 60s
6. Enviar um vídeo com o átomo `moov` no fim — aviso exibido
7. Interromper o carrossel após o segundo filho e retomar — os filhos são reaproveitados, não
   recriados

**Validações a resolver:** V-2 (Stories consomem cota), V-4 (limite de colaboradores), V-7 (vídeo de
feed vira Reels), V-8 (máximo de marcações).

**Risco da fase:** vídeo é onde a maior parte das falhas mora. O validador precisa ser rigoroso, e a
mensagem de recusa precisa ser específica o suficiente para o usuário saber o que reexportar.

---

## Fase 3 — Calendário visual

**Objetivo:** ver e reorganizar a programação sem abrir postagem por postagem.

| Entrega | Requisitos |
|---|---|
| Visão mensal e semanal, com cor por status e miniatura | RF-D06 |
| Arrastar e soltar para reagendar, com atualização otimista (`useOptimistic`) e Server Action | RF-D04, RF-D07 |
| Prévia da grade do perfil | RF-D08 |
| Cancelamento pelo calendário | RF-D05 |
| Publicar agora, passando pelo despachante do worker | RF-D02 |

**Marco verificável:**
1. Arrastar uma postagem para outro dia: ela muda de lugar na hora, e o novo horário aparece no banco,
   em UTC
2. Tentar arrastar para o passado — recusado pela API, e o item volta à posição original
3. Tentar arrastar uma postagem em `PROCESSANDO` — bloqueado
4. A prévia da grade mostra as postagens de feed na ordem certa, sem os Stories
5. Duas contas em fusos diferentes exibem horários locais corretos no mesmo calendário

---

## Fase 4 — Aprovação, usuários e permissões

**Objetivo:** nada vai ao ar sem passar por revisão, cada pessoa faz só o que lhe cabe, e o super admin
administra tudo pela tela.

As duas coisas andam juntas: a aprovação só vira controle real quando existe permissão para aprovar. A
infraestrutura de permissões já nasceu na Fase 0; aqui entram as telas e o fluxo.

**Aprovação**

| Entrega | Requisitos |
|---|---|
| Transições de rascunho, revisão e aprovação | RF-E01 a RF-E03 |
| Autoaprovação só com `POSTAGEM_APROVAR_PROPRIA` | RF-E02, RF-I04 |
| Comentários internos por postagem | RF-E04 |
| Invalidação da aprovação ao editar | RF-E05 |
| Fila de pendências ordenada por urgência | RF-E06 |
| Bloqueio de agendamento sem aprovação | RF-D01 |

**Área de administração** — ver [ADR 0015](adr/0015-super-admin-e-permissoes.md)

| Entrega | Requisitos |
|---|---|
| Usuários: criar com link, desativar, reativar, promover e remover super admin | RF-I02, RF-I09 |
| Permissões por usuário, com atalhos | RF-I03 |
| Botões escondidos conforme permissões, com a API recusando de qualquer forma | RF-I04 |
| Tentativas de acesso e bloqueios, com liberação manual | RF-I05 |
| Recuperação de acesso pela tela | RF-I06 |
| Trilha de auditoria | RF-I07 |
| Confirmação recente de 15 minutos | RF-I08 |

**Marco verificável:**
1. Tentar agendar uma postagem em `RASCUNHO` — bloqueado
2. Aprovar, agendar, então editar a legenda — volta para `RASCUNHO`, com aviso explícito
3. Reprovar sem comentário — bloqueado
4. A fila de pendências ordena pelo horário previsto, o mais urgente primeiro
5. Criar pela tela um usuário com o atalho "Editor": ele cria e envia para revisão, mas **não vê** o botão
   de aprovar, e a API recusa se ele chamar a rota diretamente
6. Dar `POSTAGEM_APROVAR` sem `POSTAGEM_APROVAR_PROPRIA`: aprova postagens de outros, não as próprias
7. Tirar uma permissão com o usuário logado: a próxima ação dele já é recusada, sem sair e entrar
8. Tirar `POSTAGEM_AGENDAR` de quem agendou uma postagem: ela continua agendada e sai no horário
9. Com o último código há mais de 15 minutos, alterar uma permissão pede o código antes
10. Tentar desativar o último super admin e a si mesmo — ambos recusados
11. Errar a senha até bloquear uma conta de teste, ver o bloqueio na tela e liberá-lo
12. Toda ação acima aparece na auditoria, com antes e depois, e sem nenhum link ou código

**Por que a aprovação vem depois do calendário:** ela é uma trava no fluxo. Colocá-la antes tornaria
todo teste manual das fases anteriores mais lento, sem ganho. Até a Fase 4, o único usuário é o super
admin, que tem todas as permissões.

---

## Fase 5 — Métricas e painel de saúde

**Objetivo:** saber o que aconteceu depois da publicação, e saber que o sistema está saudável antes
de ele quebrar.

| Entrega | Requisitos |
|---|---|
| Fila `coletar-metricas-instagram` com os quatro momentos | RF-G01, RF-G03 |
| Coleta de Stories em T+20h | RF-G02 |
| Série temporal com histórico de evolução | RF-G04 |
| Painel de saúde completo | RF-H02 |
| Reprocessamento manual pelo painel oficial do pg-boss | RF-H03 |
| Dump e restauração testados (feito na estreia em produção) | RNF-11 |
| Exibição de cota restante por conta | RF-A07 |
| Tarefa `manutencao` com a política de retenção | RNF-12 |
| Tela de evolução da conta, com métricas indisponíveis explicadas | RF-G07 |
| Demais tipos de notificação: `TOKEN_EXPIRANDO`, `CONTA_SEM_ACESSO`, `PROCESSAMENTO_TRAVADO` | RF-J03 |

**Marco verificável:**
1. Publicar e confirmar a coleta em T+1h, com números batendo com o aplicativo do Instagram
2. Publicar um Story e confirmar a coleta antes das 24h
3. Ver a evolução entre T+1h e T+24h numa postagem de feed
4. O painel mostra a cota, os tokens e as falhas corretamente
5. Reprocessar pelo painel do pg-boss uma tarefa que falhou e vê-la concluir
6. A tela da conta mostra a evolução diária desde o início da coleta; na conta de testes, com menos de 100
   seguidores, as métricas ausentes aparecem como indisponíveis, nunca zero

---

## Depois do MVP

Ordenado por valor percebido, não por facilidade:

| Item | Requisito | Observação |
|---|---|---|
| Normalização automática de mídia | RF-B06 | Converter em vez de recusar. Elimina a fricção mais comum do dia a dia |
| Painel de desempenho comparativo | RF-G05 | Só faz sentido com histórico acumulado |
| Sugestão de melhor horário | RF-D10 | Depende do painel acima |
| Modelos de legenda | — | Assinatura, conjuntos de hashtags |
| Programação recorrente | — | Séries semanais |
| Geração de legenda por IA | — | Não é o problema que o produto resolve, mas encaixa bem |

### Mudança para a etapa 2 — quando o projeto for aprovado

Sair do Easypanel para PM2, Docker Compose e Apache, pelo roteiro de
[10 — Mudança de casa](10-infra-deploy.md#mudança-de-casa-da-etapa-1-para-a-etapa-2): mesma `ENCRYPTION_KEY`, mesmo
domínio, e os itens de proxy da estreia refeitos com o Apache ([ADR 0020](adr/0020-easypanel-na-validacao.md)).

### Funcionalidades maiores já planejadas

Cada uma é praticamente um projeto. O terreno foi preparado em [ADR 0009](adr/0009-preparacao-multi-rede.md).

| Item | Dependências conhecidas | Primeiro passo |
|---|---|---|
| **Responder comentários** do Instagram | Novo escopo `instagram_business_manage_comments`, reconexão das contas, modelagem de comentários | Verificar o item V-11 de [08](08-integracao-instagram.md#escopos-futuros-comentários-e-mensagens) |
| **Responder mensagens diretas** | Novo escopo `instagram_business_manage_messages`, reconexão das contas, webhooks, janela de 24h | Verificar o item V-11 — **se exigir App Review, esse passo vem antes de qualquer código** |
| **Outras redes sociais** | Estudo da API da rede escolhida, novos formatos, extração do que for comum | Escolher a rede e documentar a API dela como o [08](08-integracao-instagram.md) faz com o Instagram |

**Risco registrado:** receber aviso em tempo real de comentários e mensagens usa webhooks, e a
documentação da Meta indica que webhooks exigem aplicativo em modo Live com Advanced Access. Se isso
valer para contas testadoras, essas funcionalidades trazem de volta a revisão da Meta que o MVP evita.
Para comentários existe a alternativa de consultar periodicamente; para mensagens, não.

---

## Cobertura de requisitos por fase

| Fase | Requisitos |
|---|---|
| 0 | RF-A01 a RF-A04, RF-A06, RF-A08, RF-A09, RF-G06, RF-H01, RF-H04, RF-H05, RF-H06, RF-H07, RF-I01, RF-J05, RNF-05, RNF-06, RNF-13, RNF-14, RNF-15, RNF-16 (infraestrutura de RF-I04 e RF-I09) |
| 1 | RF-B01 a RF-B03, RF-B05, RF-C01, RF-C03, RF-C12, RF-D01, RF-D03, RF-D09, RF-F01 a RF-F09, RF-F11, RF-J01 a RF-J04, RNF-01 a RNF-04, RNF-07, RNF-08, RNF-09, RNF-10 |
| 2 | RF-B04, RF-C02, RF-C04 a RF-C11, RF-F10 |
| 3 | RF-D02, RF-D04 a RF-D08 |
| 4 | RF-E01 a RF-E06, RF-I02 a RF-I09 |
| 5 | RF-A05, RF-A07, RF-G01 a RF-G04, RF-G07, RF-H02, RF-H03, RNF-11, RNF-12 |
| Depois | RF-B06, RF-D10, RF-G05 |

Todos os requisitos do MVP estão cobertos. Conferido contra [02](02-requisitos.md).

---

## Documentos relacionados

- [02 — Requisitos](02-requisitos.md) — o que cada identificador significa
- [08 — Integração Instagram](08-integracao-instagram.md) — a lista V de validações pendentes
- [09 — Motor de agendamento](09-motor-agendamento.md) — o que a Fase 1 precisa acertar
