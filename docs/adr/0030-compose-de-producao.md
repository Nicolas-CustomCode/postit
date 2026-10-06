# ADR 0030 — Compose de produção, com a imagem publicada no GHCR

**Data:** 2026-10-05 · **Status:** aceito · **Substitui parcialmente:** [ADR 0020](0020-easypanel-na-validacao.md)
(a tabela da etapa 1 e a seção 3, "só se constrói o que a etapa atual usa")

## Contexto

O [ADR 0020](0020-easypanel-na-validacao.md) previu a etapa 1 como **três serviços App no Easypanel**, construídos
do mesmo `Dockerfile`, mais Postgres e MinIO como serviços do painel, e proibiu escrever o compose de produção antes
da etapa 2. A estreia ainda não aconteceu, e duas coisas mudaram:

- **O usuário quer migrar entre plataformas.** Rodar na VPS com o Easypanel agora, e depois noutra máquina, com
  Apache na frente, sem refazer a configuração à mão em cada lugar. Configuração que mora só no painel não se leva.
- **Faltava uma peça da estreia**: a preparação do bucket de produção (política de leitura e ciclo de vida de
  `recebidos/`), registrada como pendência no [12](../12-roadmap.md) em 24/09/2026. No local, quem faz isso é o
  `media-init` do `docker-compose.yml`; na produção, nada fazia.

O Easypanel tem um tipo de serviço **Compose**: roda `docker compose up -d` sobre um arquivo do repositório, e liga
domínio e HTTPS a um serviço e porta do compose, pelo Traefik dele
([documentação](https://easypanel.io/docs/services/compose), lida em 05/10/2026). Ele pede que o compose não publique
portas nem use `container_name`.

## Decisão

### 1. Um compose com o PostIt inteiro — `deploy/compose.yml`

| Serviço | O quê | Exposto |
|---|---|---|
| `postgres` | Postgres 16, volume nomeado | não |
| `minio` | MinIO (build da comunidade, [ADR 0028](0028-minio-pela-build-da-comunidade.md)), volume nomeado, CORS pela `APP_URL` | domínio de **mídia** → `minio:9000` |
| `bucket-init` | Roda a cada subida e sai: bucket, leitura só em `publicas/`, ciclo de vida de `recebidos/` | não |
| `api` | Imagem do PostIt, comando `api`: aplica as migrations e sobe | **não** — regra 4 |
| `worker` | Mesma imagem, comando `worker` | não |
| `web` | Mesma imagem, comando `web` | domínio do **app** → `web:3010` |

- **Cada processo recebe só as variáveis que usa**: o web não vê o banco nem a credencial do MinIO, o worker não vê
  a chave interna.
- **Ordem de subida por verificação de saúde**: banco e bucket antes da api, a api antes do web e do worker — o
  worker não disputa as migrations.
- **Sem `ports` e sem `container_name`.** Para testar no computador, `deploy/compose.local.yml` só acrescenta as duas
  portas que fazem o papel dos domínios.
- O `bucket-init` **é** o script de preparação do bucket que faltava: a pendência da estreia se fecha aqui.

### 2. A imagem sai da CI, por tag, para o GHCR

- O workflow `release.yml` constrói o `Dockerfile` a cada tag `vX.Y.Z` e publica
  `ghcr.io/nicolas-customcode/postit:vX.Y.Z`, **pública** (ver o acréscimo de 06/10/2026, no fim).
- O compose baixa a versão em `POSTIT_TAG`. Trocar de versão é mudar essa variável e fazer o deploy; a VPS não
  compila nada.

### 3. Onde roda

- **VPS com Easypanel**, como serviço Compose, com os domínios `postit-app.kwlyqm.easypanel.host` (app) e
  `postit-media.kwlyqm.easypanel.host` (mídia).
- **Plano B**, se o serviço Compose não servir: um serviço App
  por processo, como o ADR 0020 previa, com a mesma imagem.
- **Depois**, o mesmo arquivo noutra máquina, com Apache ou outro proxy na frente — o que antes era a etapa 2 com
  PM2 deixa de ser a única saída.

## Alternativas descartadas

- **Uma imagem "tudo em um"**, com Postgres e MinIO dentro: atualizar o PostIt reiniciaria o banco, o backup ficaria
  preso no container, e as versões dos três andariam juntas.
- **Compilar no servidor a cada deploy** (`build:` no compose): dispensa o registro, mas o build do Next pesa na VPS
  e cada deploy demora. Fica como plano B do plano B.
- **Só o painel do Easypanel, sem compose**: funciona, mas a configuração não se leva para outro lugar.

## Consequências

- O ADR 0020 continua valendo no que decide sobre o **código** — cabeçalhos no Next, endereço da API por variável,
  `X-Real-IP` vindo do proxy, CORS no MinIO. Muda só **onde** e **como** a etapa 1 sobe.
- O `docker-compose.yml` da raiz continua sendo **só do computador local**.
- **Confirmado na estreia (06/10/2026):** o serviço Compose do Easypanel usa o `docker login ghcr.io` feito na VPS — o
  plano B não foi preciso. O `.env` que ele cria vai para o Build path, que precisa ser `/deploy`.
- Fica a conferir: se o Traefik entrega o IP real em `X-Real-IP` (V-23 do [08](../08-integracao-instagram.md)).
- O roteiro está no [10](../10-infra-deploy.md).

## Acréscimo de 06/10/2026 — a imagem é pública

A decisão original era imagem **privada**, com `docker login ghcr.io` na VPS e um token só de `read:packages` — e
assim foi a estreia. No mesmo dia, o pacote no GHCR ficou **público**, e o usuário decidiu mantê-lo assim:

- é coerente com o repositório, que é público ([ADR 0032](0032-main-protegida-e-fluxo-por-pull-request.md)) — a
  imagem não carrega nada que o código já não mostre;
- **segredo nenhum entra na imagem**: o `.dockerignore` deixa de fora `.env`, chaves e dumps, e toda credencial chega pelo Environment do
  Easypanel na hora de subir;
- a VPS deixa de precisar do token do GitHub — uma credencial a menos para guardar e renovar.

O `docker login` feito na estreia pode continuar na VPS sem efeito; se a imagem voltar a ser privada, é ele que volta
a valer.
