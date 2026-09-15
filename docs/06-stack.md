# 06 — Stack

Cada escolha com justificativa, alternativa descartada e custo de trocar depois.

O critério que orienta todas elas: **este projeto adota as convenções que já existem nos seus
outros repositórios**. Um stack familiar significa menos tempo perdido em decisão banal e mais
reaproveitamento de padrão já resolvido. Onde `alivio-crm` e `nossobuncker` divergem, segue-se o
`nossobuncker`, que é o mais recente e documenta as correções. Divergir dos dois só quando houver
razão específica — e isso fica dito.

**Versões:** os números abaixo são os usados nos seus projetos e os verificados em 14/09/2026. Na
instalação, confirme a versão estável mais recente de cada pacote antes de fixar.

---

## Organização do repositório

### Monorepo com npm workspaces e Turborepo 2

**Por quê:** é a estrutura do `alivio-crm` e do `nossobuncker`. Três partes com responsabilidades
diferentes — telas, API e contratos compartilhados — ficam no mesmo repositório, com build e testes
orquestrados pelo Turborepo. Decisão registrada em [ADR 0010](adr/0010-monorepo-next-nest-bff.md).

| Pasta | Conteúdo |
|---|---|
| `apps/web` | Next.js |
| `apps/api` | NestJS — API HTTP e worker |
| `packages/shared` | Schemas zod, tipos de resposta, enums, especificações de mídia |
| `packages/database` | Schema Prisma, migrations, seed |

**Convenções herdadas do `nossobuncker`:**

- Pacotes com escopo neutro `@repo/*`, porque o nome do produto pode mudar
- `tsconfig.base.json` mínimo e **sem `paths`** — cada pacote é resolvido pelo próprio `package.json`
- `.env` único na raiz, lido por cada app
- Build de `@repo/database` **sem cache** no Turborepo, para o client do Prisma nunca ficar velho
- Limite de tamanho do cache do Turborepo configurado — lá, o cache chegou a 30 GB
- Client do Prisma gerado **fora do git** — commitá-lo gerou conflito a cada deploy no `alivio-crm`
- Comentários explicativos no `package.json` com campos `"//chave"`

**Node 22.12 ou mais novo**, exigência do pg-boss ([npm](https://registry.npmjs.org/pg-boss/latest)).

**Alternativa descartada:** um único app Next.js com rotas de API. Era a decisão anterior. Mais rápido
para o MVP, mas o backend vai crescer com outras redes, comentários e mensagens — e organizar isso
depois custa mais do que começar organizado.

**Alternativa descartada:** pnpm ou Bun. Nenhum dos seus monorepos usa. npm workspaces resolve.

---

## Telas

### Next.js 16 com App Router, React 19, TypeScript strict — como BFF

**Por quê:** é o padrão de todos os seus projetos web. Aqui ele tem um papel específico: é a **única
porta de entrada do navegador** e conversa com a API por dentro do servidor.

| Onde | Para quê |
|---|---|
| `lib/data/` | Leituras, chamadas por Server Components |
| `lib/actions/` | Escritas, como Server Actions |
| `lib/api/client.ts` | Única forma de chamar a API, marcada `server-only` |
| `lib/auth/` | Cookie de sessão e `requireSession()` |
| `proxy.ts` | Só confere se o cookie existe e redireciona para o login |

**Alternativa descartada:** navegador chamando a API direto, como no `alivio-crm`. Exige CORS, token
acessível ao JavaScript e API exposta na internet.

### Tailwind v4 + shadcn/ui + lucide-react

**Por quê:** presente em todos os seus projetos web. O `shadcn/ui` entrega componentes que ficam no
seu repositório, não numa dependência — o que importa numa interface com peças incomuns, como o
posicionador de marcações sobre a imagem e o calendário arrastável, que sempre precisam de ajuste.

**Alternativa descartada:** biblioteca de componentes fechada. Rápido no começo, caro na primeira
customização que ela não prevê.

### react-hook-form + zod, sem TanStack Query

**Por quê:** formulários com `react-hook-form` e os **mesmos schemas zod** que a API usa, vindos de
`packages/shared`. As regras de validação de mídia por formato são numerosas; valer igual na tela e
na API evita a divergência clássica em que a tela aceita e o servidor recusa.

**Sem TanStack Query no MVP**, seguindo o `nossobuncker`. Com Server Components para leitura e Server
Actions para escrita, a biblioteca teria pouco a fazer. O arrastar do calendário usa `useOptimistic`,
do próprio React, para a postagem mudar de lugar na hora; a atualização de status das postagens usa
recarregamento periódico dos dados da página.

**Alternativa descartada:** TanStack Query, como no `alivio-crm`. Faz sentido quando o navegador busca
dados sozinho da API — o que aqui não acontece. Reavaliar se alguma tela exigir muita interatividade
com dados vivos.

---

## API e worker

### NestJS 11 com Fastify

**Por quê:** é o framework e o adaptador do `alivio-crm` e do `nossobuncker`. Organiza o backend em
módulos, com injeção de dependência — o que importa para um backend que vai ganhar outras redes,
comentários e mensagens.

**Configuração adotada, dos seus projetos:**

| Item | Escolha | Origem |
|---|---|---|
| Endereço | Só `127.0.0.1` | `nossobuncker` |
| Limite de corpo da requisição | 1 MB global, **sem exceções** — arquivos vão direto ao MinIO ([ADR 0012](adr/0012-upload-direto-minio.md)) | `alivio-crm` e `nossobuncker` |
| Cabeçalhos de segurança | `@fastify/helmet` | os dois |
| Encerramento | `enableShutdownHooks`, para terminar tarefas antes de sair | `alivio-crm` |
| Variáveis de ambiente | Validadas com zod no boot; erro fatal em produção | `nossobuncker` |
| Erros | Classes próprias traduzidas por um filtro global | `nossobuncker` |
| Serviços | Separados em leitura e escrita | `nossobuncker` |
| Integrações | Atrás de uma porta, trocáveis | `nossobuncker` |
| `/health` | Com versão da aplicação, exigindo chave interna | `nossobuncker` |

**Alternativa descartada:** Express. O Fastify é o padrão dos dois monorepos.

### Worker como segundo ponto de entrada do mesmo código

**Por quê:** `apps/api/src/worker.ts` inicia o projeto Nest **sem HTTP**
(`NestFactory.createApplicationContext`), carregando só os módulos do worker. API e worker reaproveitam
banco, integração com o Instagram e domínio sem copiar código.

**Alternativa descartada:** `apps/worker` separado, como no `alivio-crm`. Lá, o acesso ao banco ficou
duplicado entre os dois apps, e o worker pede à API por HTTP que faça o trabalho pesado — o que não
serve para uma publicação que leva minutos.

**Alternativa descartada:** tarefas agendadas dentro do processo da API, como no `nossobuncker`.
Mistura publicação demorada com atendimento de telas e impede ter mais de uma instância da API.

### Validação com zod compartilhado

**Por quê:** schemas em `packages/shared`, aplicados na API por um `ZodValidationPipe` e usados nos
formulários do Next. O `nossobuncker` migrou para isso depois de viver a duplicação.

**Alternativa descartada:** class-validator, como no `alivio-crm`. As regras ficam escritas duas vezes
— decorators na API e zod na tela.

### pg-boss para as filas

**Por quê:** guarda as tarefas **dentro do Postgres**, num esquema separado. Roda só no processo worker.
Entrega pronto o que o projeto precisa: criar a tarefa na mesma transação do Prisma, retentativa com
espera crescente, tarefas com início atrasado, tarefas recorrentes, fila de falhas e painel oficial.
Decisão em [ADR 0008](adr/0008-pg-boss-em-vez-de-bullmq.md).

**Alternativa descartada:** BullMQ com Redis, como no `openreply` e no `agente-evoapi-lupobalneario`.
Escolha certa para volume alto; aqui o Redis existiria só para servir a fila.

**Alternativa descartada:** `@nestjs/schedule` sozinho. Sem fila, sem retentativa estruturada, sem
visibilidade de trabalho pendente.

**Custo de trocar depois:** baixo. Os consumidores recebem só o identificador da postagem.

---

## Dados

### PostgreSQL 16 + Prisma 7, em `packages/database`

**Por quê:** Postgres com Prisma é o seu padrão em `openreply`, `vortex` e `alivio-crm`. O schema, as
migrations e o seed ficam num pacote próprio; API e worker usam o client por um `PrismaService`
compartilhado dentro de `apps/api`.

O Postgres traz duas coisas de que o projeto precisa especificamente:

- **`timestamptz` de verdade** — o agendamento é o coração do sistema e fuso horário é onde ele
  quebra. Ver [ADR 0006](adr/0006-fuso-horario-utc.md)
- **Transação com trava** — a garantia de não publicar duas vezes depende de mudar o status, gravar o
  identificador e criar tarefas na mesma transação

**Regra herdada do `nossobuncker`:** as respostas da API usam tipos de `packages/shared`, **nunca**
tipos gerados pelo Prisma.

**Alternativa descartada:** MySQL, usado no `nossobuncker`. Tratamento de fuso horário mais frágil.

**Alternativa descartada:** Supabase. Não é o seu padrão como banco principal, e não agrega numa VPS
própria.

### MinIO para as mídias

**Por quê:** compatível com S3, roda em Docker ao lado do resto, e você já usa em `nossobuncker`. A
migração para S3 ou Cloudflare R2, se um dia fizer sentido, vira troca de variável de ambiente.

O navegador envia direto ao MinIO com permissão assinada pela API, num prefixo privado; só depois de
validado o arquivo vai para o prefixo público. Ver [ADR 0012](adr/0012-upload-direto-minio.md).

**Alternativa descartada:** arquivos direto no disco. Sem ciclo de vida de objeto e sem envio assinado.

**Alternativa descartada:** Cloudflare R2. Adiciona dependência externa a uma ferramenta que se propõe
autocontida.

---

## Autenticação

### Sessão opaca com argon2id e verificação em duas etapas obrigatória

**Por quê:** a base é o modelo do `nossobuncker` — senha com argon2id, token aleatório com só o hash no
banco, cookie `httpOnly` gravado pelo Next, guardas globais na API com autorização "negar por padrão",
proteção contra tentativas repetidas no banco. Em cima dela, **verificação em duas etapas obrigatória**
com aplicativo autenticador, porque a ferramenta publica em contas reais e senha vazada não pode bastar.
Decisão em [ADR 0013](adr/0013-autenticacao-com-duas-etapas.md).

| Peça | Biblioteca | Observação |
|---|---|---|
| Hash de senha | `argon2` | argon2id, parâmetros no pacote compartilhado |
| Códigos de 6 dígitos (TOTP) | `otplib` | Usada no `hotclone`. Confirmar a API na versão instalada — item V-17 |
| QR code do cadastro | `qrcode` | Gerado na API, entregue como imagem |
| Cifra do segredo das duas etapas | `node:crypto` | AES-256-GCM, o mesmo usado para os tokens do Instagram |

**Não copiado do `hotclone`:** segredo das duas etapas guardado legível, código aceito duas vezes, falta
de tolerância de relógio e de códigos de recuperação.

**Alternativa descartada:** NextAuth. Resolve o login das telas, mas a API ficaria sem saber quem é o
usuário.

**Alternativa descartada:** JWT com refresh token, como no `alivio-crm`. Mais peças — rotação,
detecção de reuso — e um JWT não pode ser revogado antes de expirar.

**Alternativa descartada:** código de verificação por e-mail. Exige serviço de e-mail, e o e-mail
costuma ser justamente a conta invadida junto com a senha.

**Evolução futura:** chaves de acesso (passkeys), mais seguras e confortáveis que o código de 6 dígitos.

### Autorização por permissões por usuário, sem biblioteca

**Por quê:** um enum com cinco permissões fixas, uma tabela `PermissaoUsuario`, um atributo `superAdmin` e
decorators de política no mesmo guard que já nega por padrão. É a extensão direta do `RolesGuard` do
`nossobuncker`, trocando papéis por permissões. Decisão em
[ADR 0015](adr/0015-super-admin-e-permissoes.md).

**Alternativa descartada:** CASL e bibliotecas de autorização parecidas. Resolvem regras dinâmicas por
atributo e por registro — muito além de cinco permissões globais. Seria mais uma coisa para aprender sem
ganho.

**Alternativa descartada:** papéis configuráveis, como o `RoleTag` do `vortex`. Excesso para um time
pequeno.

### CSP com nonce, cabeçalhos no Next

**Por quê:** padrão do `nossobuncker`. A CSP é montada a cada página em `apps/web/lib/security/csp.ts`,
com nonce gerado no `proxy.ts`; os cabeçalhos fixos ficam no `next.config`, para valerem igual com qualquer
proxy ([ADR 0020](adr/0020-easypanel-na-validacao.md)). Decisão em [ADR 0014](adr/0014-csp-e-cabecalhos-de-seguranca.md).

**Alternativa descartada:** CSP fixa com `'unsafe-inline'` em script, como no `alivio-crm`. Anula a
principal proteção contra código injetado.

**Importante não confundir:** isto é o login **na ferramenta**. A conexão com contas do Instagram é
outro assunto, em [08](08-integracao-instagram.md).

---

## Qualidade

### Jest na API, `tsc --noEmit` e ESLint 9 em tudo

**Por quê:** Jest é o padrão do Nest e do `alivio-crm`, e funciona com os decorators sem configuração
extra. Testes `*.spec.ts` ao lado do código.

Onde o teste rende mais:

| Alvo | Por quê |
|---|---|
| `apps/api/src/domain/` | Máquina de estados, invariantes, fuso, especificações de mídia — regras puras, testáveis sem subir nada |
| Política de rotas | Nenhuma rota da API sem declaração de acesso. Padrão do `nossobuncker` |
| Arquitetura | Nenhum módulo do processo HTTP importa publicação ou filas (invariante I-9) |
| Integração com Postgres real | Idempotência, transações, bloqueios, conflito de edição — só um banco de verdade reproduz concorrência |

### Playwright para testes de tela, em desktop e celular

**Por quê:** o sistema funciona por completo no celular e tem fluxos em que um erro custa caro — login com duas
etapas, permissões, publicação. Testar pelo navegador, nos dois tamanhos de tela, é a forma de garantir isso.
Contra uma **Meta falsa**, nunca a real. Nenhum dos seus projetos tem testes de tela: este é o primeiro.
Detalhes em [15 — Qualidade e fluxo de trabalho](15-qualidade-e-fluxo-de-trabalho.md).

**Alternativa descartada:** Cypress. Suporte a vários navegadores e a emulação de celular mais limitados.

**O que não entra em teste automático:** a integração real com a Meta. Consome cota, publica de
verdade e depende de conta viva. A verificação é manual, com o roteiro de [12](12-roadmap.md), no
computador local, pelo túnel e com a conta de testes.

### GitHub Actions, CodeQL e Dependabot

**Por quê:** CI a cada push na `main`, no modelo do `security.yml` do `alivio-crm`, com o `concurrency` do
`hotclone`. CodeQL e Dependabot semanais, como no `alivio-crm`.

**Alternativa descartada:** Vitest. Estava na decisão anterior por causa dos projetos só-Next; com
Nest, exige plugin extra para os decorators, e não aparece em nenhum dos seus monorepos.

**Alternativa descartada:** `node --test` sobre o código compilado, como no `nossobuncker`. Funciona,
mas o Jest é mais familiar e o padrão da comunidade Nest.

---

## Infraestrutura

### Etapa 1: Easypanel na VPS

**Por quê:** o painel que você já usa no `openreply`. Constrói a imagem do `Dockerfile`, sobe web, API e worker
como serviços e cuida de domínio e HTTPS com o Traefik embutido. Serve para a validação do projeto
([ADR 0020](adr/0020-easypanel-na-validacao.md)).

**Contrapartida:** a imagem é construída na própria VPS, e o painel controla o servidor inteiro.

### Etapa 2: VPS com Docker Compose para serviços, PM2 para os processos, Apache

**Por quê:** exatamente o seu padrão, adotado depois da aprovação. O `docker-compose.yml` sobe Postgres e MinIO com portas
deslocadas presas a `127.0.0.1`; os três processos — web, API e worker — rodam por PM2 com
`ecosystem.config.cjs`, e o deploy segue um `scripts/deploy.sh` como o do `nossobuncker`. A publicação
de vídeo pode levar mais de cinco minutos, o que não cabe em função serverless.

**Alternativa descartada:** Vercel com worker externo. Dois lugares para manter, sem resolver nada que
a VPS não resolva.

Detalhes em [10 — Infra e deploy](10-infra-deploy.md) e [ADR 0003](adr/0003-vps-docker-pm2.md).

### Cloudflare Tunnel no desenvolvimento

**Por quê:** a Meta precisa baixar a mídia por URL pública, e o OAuth precisa de URI de retorno cadastrada. O
**túnel rápido** dá ao computador local endereços https sem conta nem domínio; fica sempre ligado para o endereço não
mudar. O `nossobuncker` já usa. Ver [ADR 0022](adr/0022-tunel-rapido-no-desenvolvimento.md).

**Alternativas:** túnel nomeado, com endereço fixo, exige conta e domínio na Cloudflare — evolução possível. ngrok,
usado no `openreply`: endereço fixo exige plano pago.

---

## Aplicativo instalável e notificações

### Serwist e web-push

**Por quê:** o PostIt é um **PWA** — instalável no celular e no computador — com Serwist, o mesmo do
`nossobuncker`. Notificações push usam a biblioteca `web-push` com chaves VAPID, enviadas pelo worker. Sem
serviço externo pago. Decisão em [ADR 0017](adr/0017-pwa-e-notificacoes-push.md).

**Alternativa descartada:** WhatsApp via Evolution API. Depende de um número conectado; se ele cair, os avisos
param.

**Alternativa descartada:** aplicativo nativo. Muito mais trabalho para o que um PWA entrega.

---

## Idioma

**Código em inglês; o resto em português** ([ADR 0023](adr/0023-codigo-em-ingles.md)). Identificadores, arquivos,
variáveis de ambiente e comandos em inglês — `Post`, `Account`, `scheduledAt`, `dispatcher`. Comentários, banco,
endereços e textos das telas, documentação e commits em português. O banco guarda os nomes do [07](07-modelo-dados.md)
pelo mapeamento do Prisma, e o ADR 0023 traz a tabela de tradução do vocabulário.

**A exceção:** nomes que vêm da API da Meta permanecem como a Meta os define — `media_type`,
`creation_id`, `user_tags`, `status_code`. E nomes impostos por frameworks — `main.ts`, `app.module.ts`,
`proxy.ts` — seguem o framework.

---

## Resumo

| Camada | Escolha | Alternativa mais forte descartada |
|---|---|---|
| Repositório | Monorepo npm workspaces + Turborepo 2 | App Next único |
| Telas | Next.js 16 como BFF + React 19 | Navegador chamando a API direto |
| Estilo | Tailwind v4 + shadcn/ui | Biblioteca de componentes fechada |
| Formulários | react-hook-form + zod compartilhado | TanStack Query + validação separada |
| API | NestJS 11 + Fastify | Rotas de API no Next |
| Worker | Mesmo código Nest, segundo ponto de entrada | App de worker separado |
| Validação | zod em `packages/shared` | class-validator |
| Banco | PostgreSQL 16 + Prisma 7 em pacote próprio | MySQL, Supabase |
| Arquivos | MinIO com envio assinado | Disco local, Cloudflare R2 |
| Filas | pg-boss, no próprio Postgres | BullMQ com Redis |
| Autenticação | Sessão opaca + argon2id + duas etapas (otplib) + cookie no Next | NextAuth, JWT com refresh |
| Proteção do navegador | CSP com nonce + cabeçalhos no Next | CSP fixa com `'unsafe-inline'` |
| Autorização | Permissões por usuário + super admin, sem biblioteca | CASL, papéis configuráveis |
| Testes | Jest na API com Postgres real + Playwright desktop e celular | Vitest, Cypress |
| CI | GitHub Actions + CodeQL + Dependabot | — |
| Aplicativo e avisos | PWA com Serwist + web-push | WhatsApp, app nativo |
| Desenvolvimento local | Cloudflare Tunnel rápido, sempre ligado | Túnel nomeado, ngrok |
| Execução | Etapa 1: serviços no Easypanel. Etapa 2: 3 processos PM2 + Apache | Vercel |
| Serviços | Etapa 1: serviços do Easypanel. Etapa 2: Docker Compose | Instalação direta no host |
