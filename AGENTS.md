# AGENTS.md — PostIt

Fonte de verdade para agentes trabalhando neste repositório.

## O que é

Agendador de postagens para Instagram. Ferramenta **interna**, single-tenant. Conecta várias contas
profissionais do Instagram, guarda conteúdo preparado com antecedência, publica automaticamente no
horário marcado e coleta métricas depois — das postagens e da conta. Funciona por completo no celular, é
instalável na tela inicial (PWA) e avisa por notificação push.

**Nome:** PostIt é provisório e interno ([docs/adr/0016-nome-do-produto.md](docs/adr/0016-nome-do-produto.md)).
**Nunca use "Insta", "gram" ou "IG"** em nome de produto, domínio, pacote ou nome do app na Meta — as
diretrizes de marca da Meta proíbem. A pasta do repositório ainda se chama `instaplan`; isso é histórico.

**Planejado para depois do MVP:** outras redes sociais e respostas a comentários e mensagens
diretas. Não construa nada disso agora, mas respeite a preparação descrita em
[docs/adr/0009-preparacao-multi-rede.md](docs/adr/0009-preparacao-multi-rede.md): nomes genéricos
onde o conceito é genérico (`Account`, `network`, `externalId` no código; `Conta`, `rede`, `idExterno` no banco), módulos e filas separados por rede, e
nenhuma interface genérica de "publicador" antes de a segunda rede existir.

**Estado atual: Fase 0 em andamento** ([docs/12-roadmap.md](docs/12-roadmap.md)). Toda a arquitetura está em `docs/` e
deve ser lida antes de mexer no código.

## Estrutura

Monorepo com npm workspaces e Turborepo. Ver [docs/05-arquitetura.md](docs/05-arquitetura.md) e
[docs/adr/0010-monorepo-next-nest-bff.md](docs/adr/0010-monorepo-next-nest-bff.md).

```
apps/web          Next.js — telas e BFF. Única parte que o navegador enxerga
apps/api          NestJS + Fastify — dois pontos de entrada:
  src/main.ts       processo HTTP, só alcançável pelo Next em 127.0.0.1   (postit-api)
  src/worker.ts     processo sem HTTP, com as filas pg-boss               (postit-worker)
packages/shared   schemas zod, tipos de resposta, enums, especificações de mídia
packages/database schema Prisma, migrations, seed
.github/workflows CI (a cada push na main), CodeQL
scripts/          version.mjs, tunnel.cjs; deploy.sh só na etapa 2
Dockerfile        uma imagem, comandos web | api | worker — produção na etapa 1 (Easypanel)
```

**Infraestrutura em duas etapas** ([docs/adr/0020-easypanel-na-validacao.md](docs/adr/0020-easypanel-na-validacao.md)):
Easypanel durante a validação; PM2, Docker Compose e Apache depois da aprovação. O código não pode depender de
qual etapa está rodando — endereço da API por variável, cabeçalhos no Next, nada de caminho fixo do servidor.
Não escreva `ecosystem.config.cjs`, configuração do Apache nem `deploy.sh` antes da mudança.

## Leitura obrigatória antes de codar

| Vai mexer em... | Leia antes |
|---|---|
| Qualquer coisa | [docs/README.md](docs/README.md) |
| Estrutura, processos, fronteiras | [docs/05-arquitetura.md](docs/05-arquitetura.md) |
| Integração com a Meta | [docs/08-integracao-instagram.md](docs/08-integracao-instagram.md) |
| Worker, filas, publicação | [docs/09-motor-agendamento.md](docs/09-motor-agendamento.md) |
| Banco, entidades | [docs/07-modelo-dados.md](docs/07-modelo-dados.md) |
| Login, sessão, duas etapas, guardas | [docs/adr/0013-autenticacao-com-duas-etapas.md](docs/adr/0013-autenticacao-com-duas-etapas.md) |
| CSP, cabeçalhos, proxy | [docs/adr/0014-csp-e-cabecalhos-de-seguranca.md](docs/adr/0014-csp-e-cabecalhos-de-seguranca.md) |
| Permissões, super admin, área de administração | [docs/adr/0015-super-admin-e-permissoes.md](docs/adr/0015-super-admin-e-permissoes.md) |
| Envio de mídia | [docs/adr/0012-upload-direto-minio.md](docs/adr/0012-upload-direto-minio.md) |
| Deploy, Easypanel, Docker, PM2, Apache | [docs/10-infra-deploy.md](docs/10-infra-deploy.md) e [docs/adr/0020-easypanel-na-validacao.md](docs/adr/0020-easypanel-na-validacao.md) |
| Token, segredo, cifra | [docs/11-seguranca.md](docs/11-seguranca.md) |
| Telas, navegação, celular | [docs/13-telas-e-navegacao.md](docs/13-telas-e-navegacao.md) |
| Cores, fontes, ícone, tema escuro | [docs/13-telas-e-navegacao.md](docs/13-telas-e-navegacao.md#identidade-visual) — nada de cor ou fonte fora de lá |
| Rodar localmente, túnel, apps da Meta, ambientes | [docs/14-ambientes-e-desenvolvimento.md](docs/14-ambientes-e-desenvolvimento.md) |
| Commits, versão, CI, testes, Playwright | [docs/15-qualidade-e-fluxo-de-trabalho.md](docs/15-qualidade-e-fluxo-de-trabalho.md) |
| Notificações, push, service worker | [docs/adr/0017-pwa-e-notificacoes-push.md](docs/adr/0017-pwa-e-notificacoes-push.md) |

Decisões arquiteturais estão em `docs/adr/`. **Não contrarie um ADR sem escrever outro** que o
substitua.

## Convenções

**Idioma** ([docs/adr/0023-codigo-em-ingles.md](docs/adr/0023-codigo-em-ingles.md)):

| O quê | Idioma |
|---|---|
| Identificadores no código — variáveis, funções, classes, tipos, arquivos, pastas, módulos | **Inglês**: `Post`, `Account`, `scheduledAt`, `dispatcher`, módulos `posts` e `approval` |
| Variáveis de ambiente, comandos `npm run`, serviços do compose | **Inglês** |
| Comentários no código | Português |
| Banco — tabelas, colunas, enums | Português, pelo `@@map`/`@map` do schema: `Post` grava em `Postagem`, `DRAFT` em `RASCUNHO` |
| Endereços das telas, textos e mensagens para o usuário | Português |
| Documentação e mensagens de commit | Português |

A documentação fala o vocabulário do domínio em português; **a tabela de tradução para o código está no ADR 0023**.
Modelo ou valor novo no schema entra com nome em inglês e `@map` para o nome em português do [07](docs/07-modelo-dados.md).

**As exceções:** nomes vindos da API da Meta ficam como a Meta os define — `media_type`,
`creation_id`, `user_tags`, `status_code`, `is_carousel_item`. Nomes impostos por frameworks —
`main.ts`, `app.module.ts`, `proxy.ts` — seguem o framework.

**Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui, lucide-react,
react-hook-form, zod; NestJS 11 com Fastify; Prisma 7 sobre PostgreSQL 16; pg-boss 12.x (filas no
próprio Postgres, exige Node 22.12+); argon2id; otplib e qrcode para a verificação em duas etapas;
Serwist (PWA) e web-push; Jest na API e Playwright nas telas; GitHub Actions. **Não há** Redis, NextAuth, TanStack
Query nem Vitest. Justificativa de cada escolha em [docs/06-stack.md](docs/06-stack.md).

**Na API:** módulos por funcionalidade; serviços separados em `*.query.service.ts` (só lê) e
`*.domain.service.ts` (escreve e abre transação); regras puras em `src/domain/`, sem Nest nem Prisma;
integrações atrás de porta (como `storage/`); erros próprios traduzidos por filtro global.

**No Next:** leituras em `lib/data/` (Server Components), escritas em `lib/actions/` (Server Actions),
toda chamada à API por `lib/api/client.ts`. O Next 16 mudou APIs e convenções — `proxy.ts` no lugar de
`middleware.ts`, por exemplo. Antes de escrever código do Next, consulte o guia da versão instalada em
`node_modules/next/dist/docs/`.

**Monorepo:** escopo `@repo/*`; `tsconfig.base.json` sem `paths`; `.env` único na raiz, validado com
zod por cada app no boot; client do Prisma gerado fora do git; comentários explicativos em
`package.json` com campos `"//chave"`, e comentários com a razão da decisão em `docker-compose.yml`,
`ecosystem.config.cjs` e `turbo.json` — mesmo padrão de `nossobuncker`.

**Git:** direto na `main`; a CI roda a cada push e avisa quando quebra — **conserte antes de seguir**.
Commits `tipo(escopo): resumo` em pt-BR, com corpo explicando o porquê. O pre-commit sobe a versão (patch);
produção só recebe tag `vX.Y.Z`. Detalhes em [docs/15-qualidade-e-fluxo-de-trabalho.md](docs/15-qualidade-e-fluxo-de-trabalho.md).

## Regras que não se negociam

Estas vêm de decisões registradas. Quebrar uma delas é bug, não estilo.

1. **Só o processo worker publica.** Nem o Next nem o processo HTTP da API chamam a Meta para
   publicar — nem no "publicar agora", que só grava a postagem como agendada. `PublishingModule` e
   `QueuesModule` são importados **apenas** pelo `WorkerModule`; um teste de arquitetura confere.
2. **Nenhuma postagem é publicada duas vezes.** Quatro camadas independentes garantem isso —
   `singletonKey` do pg-boss, verificação inicial, trava otimista com criação da tarefa na mesma
   transação, e restrição de unicidade no banco. Não remova nenhuma por parecer redundante: a
   redundância é o projeto.
3. **Segredo nunca aparece em log, erro, resposta ou tela.** Vale para token do Instagram, sessão,
   desafio, links, senha (inclusive a tentada), códigos de 6 dígitos e códigos de recuperação. Toda
   chamada à Meta passa por `apps/api/src/instagram/client.ts`, o único lugar que anexa o token.
4. **O navegador só fala com o Next.** A API não tem nome público — serviço sem domínio no Easypanel (etapa 1),
   `127.0.0.1` na etapa 2 — e exige chave interna. Não crie CORS, não exponha URL da API ao navegador, não acesse banco nem MinIO a
   partir de `apps/web`.
5. **Toda rota da API declara seu acesso** com exatamente uma política: `@Public`,
   `@AnyAuthenticated`, `@RequirePermission(...)` ou `@SuperAdmin`. Rota sem declaração é recusada, e o teste
   de política de rotas falha. Leitura é `@AnyAuthenticated`; **toda ação** exige `@RequirePermission` do
   catálogo. No Next, toda página e Server Action chama `requireSession()` — nunca confie só no `proxy.ts`.
6. **Contrato em `packages/shared`.** Entradas validadas com os schemas zod de lá; respostas tipadas
   com os tipos de lá, **nunca** com tipos gerados pelo Prisma.
7. **Horário é sempre UTC** no domínio, no worker e no banco. Conversão só na borda da tela, usando o
   identificador IANA da conta.
8. **A verdade está no Postgres.** Postagem agendada é linha na tabela `Postagem`, não tarefa agendada
   na fila — reagendar é um `UPDATE`. Mudança de status e criação de tarefa acontecem na mesma
   transação (`db: fromPrisma(tx)`).
9. **Falha definitiva para e espera decisão humana.** O sistema nunca publica atrasado sozinho, e
   nenhuma publicação começa mais de 15 minutos depois do horário marcado.
10. **Mídia só fica pública depois de validada.** O navegador envia para `recebidos/` com política
    assinada; a API valida e move para `publicas/`. Validar no envio, não na publicação. Nenhuma rota
    da API aceita corpo acima de 1 MB.
    **O envio valida o piso; o formato valida o resto.** A faixa de proporção 4:5 a 1.91:1 é **do
    feed** — Stories não tem faixa nenhuma. O acervo é compartilhado entre contas e formatos, então
    ele aceita pelo que vale em qualquer formato (`validateImageUpload`) e a composição confere o
    formato escolhido (`validateImageFormat`), ambos em `packages/shared/src/media-formats.ts`.
    Recortar é oferta, nunca imposição: recortar uma arte 9:16 para 4:5 destrói o formato pretendido.
11. **Verificação em duas etapas é obrigatória para todos.** Senha certa cria só um desafio; sessão só
    nasce depois do código. Não crie atalho, modo de teste nem exceção por usuário. Detalhes em
    [docs/adr/0013-autenticacao-com-duas-etapas.md](docs/adr/0013-autenticacao-com-duas-etapas.md).
12. **Login responde sempre igual.** E-mail inexistente e senha errada: mesma mensagem, mesmo tempo
    (hash isca). Bloqueio conferido antes da senha.
13. **Toda escrita no Next é Server Action.** Não crie route handler POST em `apps/web`. Route handlers
    GET não podem causar efeito perigoso.
14. **Destino depois do login passa por `safeRedirect()`** de `packages/shared`. Nunca redirecione para
    um valor vindo da URL sem ele.
15. **O IP do visitante vem só de `X-Real-IP`**, definido pelo proxy. Nunca leia `X-Forwarded-For`.
16. **CSP com nonce em toda página.** Não adicione `'unsafe-inline'` em `script-src`, não carregue
    recurso de domínio de terceiro, não use `dangerouslySetInnerHTML` com conteúdo de usuário. Biblioteca
    que exigir afrouxar a CSP precisa de ADR. Os cabeçalhos de segurança fixos ficam no `next.config`, não no
    proxy.
17. **Autorização decide na API, nunca na tela.** O Next esconde botões conforme as permissões, mas a API
    confere sempre. O catálogo é fixo: `POST_EDIT`, `POST_APPROVE`, `POST_APPROVE_OWN`,
    `POST_SCHEDULE`, `ACCOUNT_MANAGE` (no banco e nos docs: `POSTAGEM_EDITAR` e demais, ADR 0023). Permissão nova exige código, migração e atualização do
    [ADR 0015](docs/adr/0015-super-admin-e-permissoes.md). Autoaprovação é regra do serviço de aprovação.
18. **Toda ação administrativa** usa `@SuperAdmin` + `@RecentConfirmation` (código há menos de 15 min) e
    grava `EventoAuditoria`, sem links, códigos, senhas ou tokens. Vale também para os comandos `admin:*`,
    com origem `CLI`.
19. **Nunca zero super admins.** Desativar ou remover super admin confere, na mesma transação, que sobra ao
    menos um ativo (invariante I-10). Ninguém desativa a si mesmo.
20. **Toda escrita de usuário em `Postagem` confere e sobe `versao`.** A tela envia a versão que carregou;
    a API atualiza com `where id + versao` e responde 409 se nada mudou. O worker **não** mexe em `versao`.
    Ver [docs/05-arquitetura.md](docs/05-arquitetura.md#8-edição-simultânea).
21. **Nenhum ambiente além da produção tem credencial de conta real.** Só existem local e produção
    ([ADR 0019](docs/adr/0019-sem-homologacao.md)); o local usa o app **PostIt Dev** e a conta de testes. Nunca copie token, banco ou `.env` de produção para outro ambiente.
22. **Push não carrega dado sensível.** Só título genérico e link — nada de nome de conta, legenda, e-mail ou
    motivo de erro. O detalhe aparece depois de abrir o sistema logado. O service worker **não guarda em cache**
    página autenticada nem resposta com dado pessoal (`NetworkOnly`).
23. **Testes nunca falam com a Meta real.** Playwright usa a Meta falsa, e o endereço da Meta só pode ser
    trocado com `NODE_ENV=test`. Banco de teste precisa terminar em `_test`.
24. **A conta ativa vem do endereço da página** (`/c/<conta>/…`), nunca de estado guardado no servidor ou na
    sessão. Toda chamada à API passa a conta explicitamente, e a API confere que a postagem pertence a ela. O cookie
    da última conta só decide onde o sistema abre. Ver [docs/13-telas-e-navegacao.md](docs/13-telas-e-navegacao.md#conta-ativa).
    **Quem lê o endereço é `accountFromPath()` de `packages/shared`** — o proxy e a casca, os dois. Duas leituras
    que discordem fazem o sistema abrir numa conta e marcar outra como ativa.
25. **Nada que dependa da rota é calculado em layout.** No App Router o layout **não re-renderiza** ao navegar
    entre rotas que o compartilham: o valor congela na primeira carga completa. A conta ativa sai do
    `useActiveAccount()`, num componente de cliente. Já custou um defeito — a barra lateral dizendo "Nenhuma
    conta" com o endereço dentro da conta, e os itens da conta apagados.
26. **Toda ação que mexe em conta chama `revalidatePath("/", "layout")`.** A lista de contas da casca —
    seletor, barra lateral, barra inferior — vem do layout autenticado, e sem isso ela envelhece: a conta
    aparece na tela de Contas e não aparece no seletor, ao mesmo tempo. `revalidatePath("/contas")` sozinho
    revalida a página, não a casca das outras rotas.

## Antes de afirmar algo sobre a API da Meta

A documentação da Meta **se contradiz em vários pontos** — cota de 50 versus 100 publicações,
colaboradores 3 versus 5, marcação de produto documentada e simultaneamente declarada não
suportada.

`docs/08-integracao-instagram.md` traz link da fonte em cada afirmação e isola o que não é
confirmável na seção "A validar em desenvolvimento". **Não afirme nada sobre a API sem fonte**, e ao
confirmar empiricamente algum item da lista, registre o resultado naquele documento com a data.

## Comandos

```bash
docker compose up -d     # postgres, minio
npm run dev              # web, api e worker juntos, via turbo
npm run tunnel            # dois túneis rápidos (app e mídia), sempre ligados — necessário para OAuth e publicação
npm run dev:web          # só o Next
npm run dev:api          # só o processo HTTP da API
npm run dev:worker       # só o processo worker
npm run build            # turbo build
npm run typecheck        # tsc --noEmit em todos os pacotes
npm run lint
npm run test             # jest na API (com Postgres real, banco terminado em _test)
npm run test:e2e         # playwright, computador e celular, com a Meta falsa
npm run version:minor     # sobe a versão (o pre-commit já sobe o patch; SKIP_BUMP=1 pula)
npm run version:major
npm run db:migrate       # desenvolvimento
npm run db:deploy        # produção — nunca db:push nem reset
npm run db:studio
npm run db:seed          # dados de exemplo; nunca cria super admin nem conta do Instagram
npm run admin:create -- --email voce@exemplo.com --name "Você" --super-admin   # primeiro usuário
npm run admin:refresh-tokens   # força a renovação que o worker faz às 3h UTC
npm run admin:collect-metrics  # força a coleta de métricas que o worker faz às 6h UTC
# Produção — só por tag; versão com migration: dump manual antes (docs/10-infra-deploy.md#dump-e-restauração)
git push --force origin "v1.4.0^{commit}:refs/heads/producao"   # etapa 1: Easypanel; deploy api → worker → web
scripts/deploy.sh v1.4.0                                         # etapa 2: PM2 e Apache, depois da aprovação
```

## Onde o teste rende mais

- `apps/api/src/domain/` — máquina de estados, invariantes, cálculo de horário com fuso, validação de
  mídia por formato. Regras puras, testáveis sem subir banco, e é onde um erro custa caro
- **Política de rotas** — nenhuma rota sem declaração de acesso
- **Arquitetura** — nenhum módulo do processo HTTP importa publicação ou filas
- **Matriz de permissões** — nenhuma rota com `@RequirePermission` aceita usuário sem ela; autoaprovação sem
  `POSTAGEM_APROVAR_PROPRIA` é recusada
- **Último super admin** — desativar ou remover o último é recusado
- **Conflito de edição** — salvar com `versao` antiga devolve 409
- **Idempotência e transações** — com Postgres real, não com mock

A integração real com a Meta **não** entra em teste automático: consome cota, publica de verdade e
depende de conta viva. A verificação dela é manual, **no computador local, pelo túnel e com a conta de testes**, pelo
roteiro da Fase 1 em [docs/12-roadmap.md](docs/12-roadmap.md).
