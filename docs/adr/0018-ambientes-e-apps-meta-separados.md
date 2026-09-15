# ADR 0018 — Três ambientes, túnel no desenvolvimento e apps da Meta separados

**Data:** 2026-09-15 · **Status:** parcialmente substituído pelo [ADR 0019](0019-sem-homologacao.md) em 2026-09-15

> **A homologação foi retirada.** A seção 1 (três ambientes) e todas as menções à homologação deixam de valer:
> agora são só **local e produção**, e o PostIt Dev é usado só no local. Continuam valendo o túnel (agora o rápido, pelo [ADR 0022](0022-tunel-rapido-no-desenvolvimento.md)),
> os dois apps da Meta, a conta de testes e a regra inegociável. O texto abaixo é mantido como registro
> histórico.

## Contexto

Para publicar, a Meta **baixa a mídia por uma URL pública** ([ADR 0005](0005-minio-midia-publica.md)). Ela
não alcança o computador de quem desenvolve. Sem uma solução, o caminho mais crítico do sistema — a
publicação — só poderia ser testado direto no servidor de produção.

Além disso:

- O OAuth do Instagram exige uma URI de retorno registrada no painel do aplicativo. Se `http://localhost` é
  aceita no Instagram Login, **não está confirmado** na documentação (item V-18)
- Testar publicação numa conta real significa publicar de verdade para o público
- Não havia ambiente intermediário para ensaiar deploy e migrations

Referências: o `nossobuncker` tem um script de túnel com `cloudflared`; o `openreply` documenta como
apontar o OAuth e o webhook da Meta para um túnel.

## Decisão

### 1. Três ambientes

| | Local | Homologação | Produção |
|---|---|---|---|
| **Onde** | Computador de quem desenvolve | VPS | VPS |
| **Processos** | `npm run dev` | `postit-web-homolog`, `postit-api-homolog`, `postit-worker-homolog` | `postit-web`, `postit-api`, `postit-worker` |
| **Endereços** | Túnel: `dev-app.seudominio` e `dev-midia.seudominio` | `homolog.seudominio` e `midia-homolog.seudominio` | `app.seudominio` e `midia.seudominio` |
| **Banco** | Postgres local, em Docker | `postit_homolog`, com usuário próprio | `postit` |
| **Bucket** | MinIO local, em Docker | Bucket próprio de homologação | Bucket de produção |
| **App da Meta** | **PostIt Dev** | **PostIt Dev** | **PostIt** |
| **Conta de Instagram** | **Conta de testes** | **Conta de testes** | Contas reais |
| **Código** | Qualquer estado | O que está na `main` | Versão marcada com tag `vX.Y.Z` |

### 2. Túnel com endereço fixo

O **Cloudflare Tunnel** expõe o computador local por https, sem abrir portas no roteador.

- **Túnel nomeado, com hostname fixo** — não o túnel rápido. O túnel rápido gera um endereço diferente a cada
  execução, e a URI de retorno do OAuth registrada na Meta precisa ser sempre a mesma
- Dois hostnames: um para o app, outro para o MinIO local. É pelo segundo que a Meta baixa a mídia quando o
  worker local publica
- Exige conta gratuita na Cloudflare e o domínio gerenciado por ela
- Script `npm run tunnel`, inspirado em `nossobuncker/apps/web/scripts/tunel.cjs`

Com isso, **o fluxo completo roda no computador**, inclusive publicar na conta de testes.

### 3. Aplicativos da Meta separados

| App | Usado em | Testadores |
|---|---|---|
| **PostIt Dev** | Local e homologação | Só a conta de Instagram de testes |
| **PostIt** | Produção | As contas reais |

- **Um erro em teste nunca alcança uma conta real**: o app de teste simplesmente não tem acesso a ela
- **O segredo do app de produção nunca sai do servidor de produção**
- URIs de retorno registradas: no PostIt Dev, as do túnel e da homologação; no PostIt, só a de produção

### 4. Conta de Instagram de testes

- Uma **conta profissional** (Business ou Creator) criada só para testes, adicionada como Instagram Tester
  no PostIt Dev
- Publicar nela consome a cota de publicação **dela**, não das contas reais
- A documentação da Meta não menciona restrição de publicação para contas novas — não confirmado

### 5. Regra inegociável

**Nenhum ambiente além da produção tem credencial de conta real** — nem token do Instagram, nem segredo do
app PostIt, nem backup do banco de produção restaurado sem antes apagar os tokens.

## Consequências

### Positivas

- O caminho mais crítico — publicar — é testável no computador
- Deploy e migrations ensaiados em homologação antes da produção
- Contas reais fora do alcance de qualquer teste

### Negativas

- **Mais configuração inicial:** conta na Cloudflare, domínio gerenciado por ela, dois apps na Meta, uma conta
  de Instagram de testes
- **Homologação consome recursos da VPS**: mais três processos
- O banco e o MinIO de homologação dividem os containers com a produção. Isolados por banco, usuário e bucket,
  mas no mesmo servidor

## Alternativas consideradas

**Só túnel, sem homologação.** Mais simples, mas o primeiro ensaio de deploy e de migration seria na produção.

**Só homologação, sem túnel.** Ciclo de teste lento: toda mudança na publicação exigiria deploy para testar.

**Um único app da Meta para tudo.** Menos configuração, mas o segredo de produção circularia em todos os
ambientes e as contas reais ficariam ao alcance de testes.

**Homologação em outro servidor.** Isolamento total, com custo de mais uma VPS. Evolução possível.

## Reversibilidade

**Alta.** Ambientes são configuração: variáveis, processos e registros de DNS.
