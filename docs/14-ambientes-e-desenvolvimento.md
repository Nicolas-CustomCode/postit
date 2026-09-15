# 14 — Ambientes e Desenvolvimento

Como o PostIt roda em cada lugar — no computador de quem desenvolve e em produção — e por que publicar em
teste nunca alcança uma conta real. Decisões em [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md) (túnel,
apps e conta de testes) e [ADR 0019](adr/0019-sem-homologacao.md) (sem homologação). Requisito: RNF-16.

---

## O problema que este documento resolve

Para publicar, a Meta **baixa a mídia por uma URL pública**. O computador de quem desenvolve não é
alcançável pela internet. Sem uma solução, a publicação — a parte mais crítica do sistema — só seria testável
no servidor.

A solução tem duas partes: **túnel** no desenvolvimento e **aplicativo e conta de Instagram separados** para
teste. Não há homologação: tudo que ela testaria é testado no computador, e o que só existe no servidor é
conferido na [estreia em produção](10-infra-deploy.md#estreia-em-produção).

---

## Os dois ambientes

| | Local | Produção |
|---|---|---|
| **Para quê** | Desenvolver e testar tudo, inclusive publicar e o roteiro manual antes de cada versão | Uso real |
| **Onde** | Seu computador | VPS |
| **Processos** | `npm run dev` | `postit-web` · `postit-api` · `postit-worker` |
| **Portas** | Padrões de desenvolvimento | 3010 (web) · 3011 (API) |
| **App** | Túnel rápido: `https://….trycloudflare.com` | `https://app.seudominio` |
| **Mídia** | Segundo túnel rápido: `https://….trycloudflare.com` | `https://midia.seudominio` |
| **Banco** | Postgres em Docker local | `postit` |
| **Bucket** | MinIO em Docker local | `postit` |
| **App da Meta** | PostIt Dev | PostIt |
| **Conta de Instagram** | Conta de testes | Contas reais |
| **Código** | Qualquer estado | Tag `vX.Y.Z` |
| **Variáveis** | `.env` local | Aba Environment do Easypanel (etapa 1) · `/opt/postit/.env` (etapa 2) |
| **Chaves** | Próprias | Próprias — nunca copiadas para o local |

**Regra inegociável: nenhum ambiente além da produção tem credencial de conta real.** Nem token do Instagram,
nem segredo do app PostIt, nem backup do banco de produção restaurado sem antes apagar tokens, sessões e
segredos de duas etapas.

---

## Local: desenvolvendo com túnel

### O que é o túnel

O **Cloudflare Tunnel** cria uma ligação de saída do seu computador até a Cloudflare, que publica endereços
https apontando para ele. Não é preciso abrir portas no roteador nem ter IP fixo.

### Túnel rápido, sempre ligado

O **túnel rápido** (`cloudflared tunnel --url ...`) não exige conta nem domínio, mas gera um endereço aleatório
`….trycloudflare.com` a cada vez que o processo sobe. Por isso ele **fica ligado o tempo todo**. Decisão e limites
em [ADR 0022](adr/0022-tunel-rapido-no-desenvolvimento.md).

São **dois túneis**, porque cada um aponta para uma porta só: um para o Next e outro para o MinIO local, por onde a
Meta baixa a mídia.

### Montando pela primeira vez

1. Instalar o `cloudflared`
2. `docker compose up -d` — Postgres e MinIO locais
3. `npm run tunnel` — mostra os dois endereços e deixa os túneis de pé; não feche
4. Preencher o `.env` local com `APP_URL` e `IG_REDIRECT_URI` do primeiro endereço, `MINIO_PUBLIC_URL` do
   segundo, e as credenciais do **PostIt Dev**
5. Cadastrar a URI de retorno no PostIt Dev, no painel da Meta
6. `npm run media:setup`, `npm run db:migrate` e `npm run db:seed`
7. `npm run admin:create -- --email voce@exemplo.com --nome "Você" --super-admin`
8. `npm run dev`

O script `npm run tunnel` segue a ideia de `nossobuncker/apps/web/scripts/tunel.cjs`: as portas saem do `.env`,
para o túnel nunca apontar para o servidor errado. O Next aceita o endereço do túnel em `allowedDevOrigins`, lido de
`APP_URL`.

### Quando o endereço do túnel mudar

1. No `.env`: `APP_URL`, `IG_REDIRECT_URI` e `MINIO_PUBLIC_URL`
2. No painel da Meta, app **PostIt Dev**: a URI de retorno
3. `npm run media:setup`, que reaplica o CORS do MinIO
4. Reiniciar `npm run dev`
5. Entrar de novo — o cookie de sessão é do endereço antigo
6. No celular: reinstalar o app e reativar as notificações

### O que dá para testar localmente

**Tudo**, inclusive:

- Login com https de verdade — o cookie usa `__Host-sessao`, igual à produção
- Conectar a conta de testes pelo OAuth
- Publicar de verdade na conta de testes: o worker local cria o container e a Meta baixa a mídia pelo
  endereço do segundo túnel
- Instalar o PWA e receber push no celular, que exige https
- O **roteiro manual de publicação** da Fase 1 ([12](12-roadmap.md)), rodado antes de cada versão ir para
  produção

**Cuidado:** com o túnel sempre ligado, o PostIt local fica acessível pela internet o tempo todo. A verificação em
duas etapas protege, e o PostIt Dev só tem acesso à conta de testes.

### Sem túnel

Dá para desenvolver em `http://localhost` quase tudo que não fala com a Meta. O cookie passa a se chamar
`sessao`, sem o prefixo `__Host-`. Se o Instagram Login aceita `localhost` como URI de retorno não está
confirmado (item V-18 de [08](08-integracao-instagram.md#a-validar-em-desenvolvimento)) — e mesmo que aceite,
publicar continuaria impossível sem URL pública para a mídia.

### Dados de exemplo

`npm run db:seed` cria postagens, mídias fictícias e usuários de exemplo com permissões variadas, para testar
telas e permissões. **O seed nunca cria super admin nem conta do Instagram**: super admin sai de
`admin:create --super-admin`; conta, do OAuth.

---

## Produção

- Recebe só versões marcadas. A `main` não vai para lá sozinha
  - **Etapa 1, na validação:** Easypanel, com a branch `producao` apontada para a tag
  - **Etapa 2, depois da aprovação:** PM2 e Apache, com `scripts/deploy.sh v1.4.0`
  - Ver [ADR 0020](adr/0020-easypanel-na-validacao.md)
- **Versão com migration:** faça o dump do banco **manualmente** antes do deploy. Nenhum deploy faz dump, e voltar
  para a tag anterior não desfaz a migration. Ver [10 — Deploy](10-infra-deploy.md#deploy)
- **Primeira instalação:** a [estreia em produção](10-infra-deploy.md#estreia-em-produção) confere, antes de
  conectar contas reais, o que o computador local não tem como testar — o proxy de verdade

Detalhes em [10](10-infra-deploy.md) e no fluxo de versões de [15](15-qualidade-e-fluxo-de-trabalho.md).

---

## Os dois aplicativos da Meta

| | PostIt Dev | PostIt |
|---|---|---|
| **Ambiente** | Local | Produção |
| **URI de retorno** | `https://<túnel do app>.trycloudflare.com/contas/conectar/retorno` — trocar quando o túnel mudar | `https://app.seudominio/contas/conectar/retorno` |
| **Instagram Testers** | Só a conta de testes | As contas reais |
| **Segredo** | No `.env` local | Só no `.env` de produção |

**Por que separados:** o PostIt Dev simplesmente não tem acesso às contas reais. Um erro no código em teste —
publicar na conta errada, desconectar a conta errada — é impossível por construção, não por cuidado.

**A validar (item V-20):** se a Meta exige URL de política de privacidade e de exclusão de dados em modo de
desenvolvimento. A documentação confirma a exigência para o modo Live; para desenvolvimento, não.

Nomes dos apps seguem as regras de marca: nada de "Insta" ([ADR 0016](adr/0016-nome-do-produto.md)).

---

## A conta de Instagram de testes

- Conta **profissional** (Business ou Creator), criada só para isso
- Adicionada como **Instagram Tester** no PostIt Dev, com o convite aceito
  ([08](08-integracao-instagram.md#cada-conta-precisa-ser-cadastrada-no-aplicativo))
- Publicar nela consome a cota **dela**
- Pode ser mantida privada no Instagram
- Menos de 100 seguidores: algumas métricas da conta não existem — o sistema precisa mostrar isso direito,
  e a conta de testes serve justamente para ver esse caso

---

## Documentos relacionados

- [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md) — túnel, apps da Meta e conta de testes
- [ADR 0019](adr/0019-sem-homologacao.md) — por que não há homologação
- [10 — Infra e deploy](10-infra-deploy.md) — processos, proxy e deploy
- [15 — Qualidade e fluxo de trabalho](15-qualidade-e-fluxo-de-trabalho.md) — git, CI e testes
