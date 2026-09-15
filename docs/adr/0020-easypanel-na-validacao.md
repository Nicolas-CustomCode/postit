# ADR 0020 — Easypanel na validação; PM2 e Apache depois da aprovação

**Data:** 2026-09-15 · **Status:** aceito · **Substitui parcialmente:** [ADR 0003](0003-vps-docker-pm2.md) e
[ADR 0019](0019-sem-homologacao.md) · **Complementa:** [ADR 0014](0014-csp-e-cabecalhos-de-seguranca.md)

## Contexto

O [ADR 0003](0003-vps-docker-pm2.md) definiu a produção como uma VPS com Postgres e MinIO em Docker Compose,
os três processos por PM2 e um proxy reverso (Apache, como no `nossobuncker`).

O dono já usa **Easypanel** na VPS, como no `openreply`. O Easypanel é um painel que constrói uma imagem Docker
a partir do repositório, sobe cada programa como um serviço e cuida do domínio e do HTTPS com o **Traefik**, o
proxy que vem embutido nele.

A decisão do dono: **usar o Easypanel enquanto o projeto é validado** e, **quando for aprovado**, mudar para PM2 e
Apache, o padrão dos outros projetos.

## Decisão

### 1. Duas etapas

| | Etapa 1 — validação | Etapa 2 — depois da aprovação |
|---|---|---|
| **Onde** | VPS com Easypanel | VPS com PM2 e Apache ([ADR 0003](0003-vps-docker-pm2.md)) |
| **Proxy e HTTPS** | Traefik, embutido no Easypanel, com certificado automático | Apache |
| **Web, API e worker** | Três serviços App, construídos do **mesmo `Dockerfile`**; muda só o comando | Três processos PM2 |
| **Postgres e MinIO** | Serviços do Easypanel | Docker Compose |
| **API sem acesso de fora** | Serviço **sem domínio**, alcançável só pela rede interna do Easypanel | Escuta em `127.0.0.1` |
| **Deploy** | Branch `producao` apontada para a tag, e deploy pelo painel | `scripts/deploy.sh vX.Y.Z` |
| **Variáveis** | Aba Environment de cada serviço | `.env` em `/opt/postit` |
| **Logs** | Aba de logs do serviço no Easypanel | Arquivos do PM2 |

### 2. O código não sabe em qual etapa está

Para a mudança não virar retrabalho:

- **Cabeçalhos de segurança das páginas saem do proxy e ficam no próprio Next** (`next.config` e `proxy.ts`).
  Assim, o que protege o navegador vale igual com Traefik ou Apache. Na etapa 2, o Apache pode repeti-los, para
  cobrir também as páginas de erro dele. Isso muda a seção 3 do [ADR 0014](0014-csp-e-cabecalhos-de-seguranca.md)
- **Endereço e porta da API vêm de variável** (`API_HOST`, `API_PORT`): `0.0.0.0` dentro do container na etapa 1,
  `127.0.0.1` na etapa 2
- **O IP do visitante continua vindo só de `X-Real-IP`.** Quem define o cabeçalho é o proxy de cada etapa
- **CORS do envio de mídia fica na configuração do próprio MinIO**, não no proxy

### 3. Só se constrói o que a etapa atual usa

Na etapa 1 entram o `Dockerfile` e os passos no Easypanel. O `ecosystem.config.cjs`, o `docker-compose.yml` de
produção, a configuração do Apache e o `scripts/deploy.sh` ficam **documentados como destino** em
[10](../10-infra-deploy.md#etapa-2--pm2-e-apache), e só são escritos na mudança. O `docker-compose.yml` do
computador local existe desde o início.

### 4. Deploy na etapa 1

A tag continua sendo o que define uma versão ([ADR 0019](0019-sem-homologacao.md)). O Easypanel constrói a partir
de uma branch; a [documentação dele](https://easypanel.io/docs/services/app) não mostra deploy direto de tag. Por
isso:

1. Marcar a tag e apontar a branch `producao` para ela
2. Com dump manual antes, se a versão tiver migration
3. Deploy no painel, **nesta ordem**: API (aplica as migrations ao iniciar), worker, web

Deploy automático a cada push fica **desligado**, para a ordem ser respeitada.

### 5. A mudança de casa

Quando o projeto for aprovado:
- banco por dump e restauração;
- arquivos do bucket copiados;
- **a mesma `ENCRYPTION_KEY`**, senão todas as contas precisam reconectar;
- **o mesmo domínio**, para não mexer nas URIs de retorno da Meta.

Os itens de proxy da [estreia em produção](../10-infra-deploy.md#estreia-em-produção) são refeitos com o Apache.
Roteiro em [10](../10-infra-deploy.md#mudança-de-casa-da-etapa-1-para-a-etapa-2).

## Consequências

### Positivas

- HTTPS, domínios, variáveis e logs pela tela, sem administrar proxy e PM2 na mão durante a validação
- Padrão já conhecido pelo dono (`openreply`)
- Os cabeçalhos no Next deixam a proteção do navegador independente do proxy

### Negativas

- **Dois modelos de infraestrutura documentados**, e uma mudança de casa pela frente
- **O painel do Easypanel controla o servidor inteiro.** Quem entrar nele pode ler variáveis, inclusive
  `ENCRYPTION_KEY`, e mexer em qualquer serviço. Senha forte e acesso só por https são obrigatórios
- **A imagem é construída na VPS**, três vezes por versão (uma por serviço). Construir o Next consome bastante
  memória
- **Cabeçalhos no domínio de mídia** (`sandbox`, `nosniff`) dependem de configuração própria do Traefik, que o
  Easypanel permite por arquivo ([guia](https://easypanel.io/docs/guides/custom-traefik-config)), mas não está
  confirmado que se aplique aos domínios criados pelo painel — item V-22
- **IP real do visitante:** há relatos de o Traefik não repassar o IP de origem em alguns modos de rede do Docker.
  Sem ele, o bloqueio por IP perde efeito (o bloqueio por conta continua) — item V-23
- A rede interna do Easypanel pode ser compartilhada com outros projetos do mesmo servidor. A chave interna da API
  continua obrigatória por isso

## Alternativas consideradas

**Ir direto para PM2 e Apache.** É o destino, mas exige administrar proxy, certificado e processos já na validação.

**Ficar no Easypanel para sempre.** Possível, mas o dono prefere o padrão dos outros projetos depois da aprovação.

**Construir a imagem na CI e só baixá-la no Easypanel.** Uma construção por versão em vez de três, mas exige
registro de imagens e mais configuração. Evolução possível se a construção na VPS pesar.

## Reversibilidade

**Alta.** A aplicação é a mesma nas duas etapas; muda o que a executa. O código não depende do Easypanel.
