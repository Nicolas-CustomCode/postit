# ADR 0023 — Código em inglês; banco, textos e documentação em português

**Data:** 2026-09-15 · **Status:** aceito

## Contexto

A convenção era **tudo em português**: documentação, comentários e identificadores de domínio (`Postagem`, `Conta`,
`publicarEm`, `despachante`). O dono decidiu adotar **código em inglês**.

## Decisão

| O quê | Idioma |
|---|---|
| Identificadores no código: variáveis, funções, classes, tipos, arquivos, pastas, módulos | **Inglês** |
| Variáveis de ambiente, comandos `npm run`, serviços do `docker-compose.yml` | **Inglês** |
| Comentários no código | Português |
| Banco de dados: tabelas, colunas, tipos e valores de enum | Português, como no [07](../07-modelo-dados.md) |
| Endereços das telas (`/entrar`, `/c/<conta>/calendario`) | Português — o usuário vê |
| Textos das telas, mensagens de erro para o usuário | Português |
| Documentação e mensagens de commit | Português |

**Continua a exceção de sempre:** nomes vindos da API da Meta ficam como a Meta os define — `media_type`,
`creation_id`, `user_tags`, `status_code`.

### Banco em português, código em inglês: o mapeamento

O schema do Prisma usa **nomes em inglês mapeados** para os nomes em português do banco, com `@@map` nos modelos e
enums e `@map` nos campos e valores:

```prisma
model Post {
  scheduledAt DateTime? @map("publicarEm")
  status      PostStatus @default(DRAFT)
  @@map("Postagem")
}

enum PostStatus {
  DRAFT @map("RASCUNHO")
  @@map("StatusPostagem")
}
```

O código escreve `post.scheduledAt` e `PostStatus.DRAFT`; o banco guarda `Postagem.publicarEm` e `RASCUNHO`. A
documentação continua usando o vocabulário do domínio em português, e a tabela abaixo é a ponte.

### Vocabulário: domínio → código

**Entidades**

| Domínio (docs e banco) | Código |
|---|---|
| Usuario | `User` |
| PermissaoUsuario | `UserPermission` |
| Sessao | `Session` |
| DesafioLogin | `LoginChallenge` |
| CodigoRecuperacao | `RecoveryCode` |
| LinkAcesso | `AccessLink` |
| TentativaAcesso | `AccessAttempt` |
| BloqueioAcesso | `AccessBlock` |
| EventoAuditoria | `AuditEvent` |
| Conta | `Account` |
| Midia | `Media` |
| Postagem | `Post` |
| PostagemMidia | `PostMedia` |
| Marcacao | `UserTag` |
| Colaborador | `Collaborator` |
| ContainerPublicacao | `PublishContainer` |
| Publicacao | `Publication` |
| MetricaPostagem | `PostMetric` |
| Aprovacao | `Approval` |
| ComentarioInterno | `InternalComment` |
| EventoPublicacao | `PublishEvent` |
| EventoToken | `TokenEvent` |
| MetricaConta | `AccountMetric` |
| Notificacao | `Notification` |
| NotificacaoEntrega | `NotificationDelivery` |
| InscricaoPush | `PushSubscription` |
| PreferenciaNotificacao | `NotificationPreference` |

**Valores que mais aparecem**

| Domínio | Código |
|---|---|
| RASCUNHO, EM_REVISAO, APROVADO, AGENDADO, PROCESSANDO, PUBLICADO, FALHOU, CANCELADO | `DRAFT`, `IN_REVIEW`, `APPROVED`, `SCHEDULED`, `PROCESSING`, `PUBLISHED`, `FAILED`, `CANCELED` |
| FEED_IMAGEM, FEED_VIDEO, CARROSSEL, REELS, STORIES | `FEED_IMAGE`, `FEED_VIDEO`, `CAROUSEL`, `REELS`, `STORIES` |
| POSTAGEM_EDITAR, POSTAGEM_APROVAR, POSTAGEM_APROVAR_PROPRIA, POSTAGEM_AGENDAR, CONTA_GERENCIAR | `POST_EDIT`, `POST_APPROVE`, `POST_APPROVE_OWN`, `POST_SCHEDULE`, `ACCOUNT_MANAGE` |

Os demais enums seguem a mesma regra, sempre registrados no `schema.prisma` com o `@map` para o valor do banco.

**Conceitos e peças de código**

| Domínio | Código |
|---|---|
| despachante, publicador | `dispatcher`, `publisher` |
| conta ativa | `activeAccount` |
| versão da postagem | `version` |
| `destinoSeguro()` | `safeRedirect()` |
| `exigirSessao()` | `requireSession()` |
| `@Publica`, `@QualquerAutenticado`, `@Permissao(...)`, `@SuperAdmin`, `@ConfirmacaoRecente` | `@Public`, `@AnyAuthenticated`, `@RequirePermission(...)`, `@SuperAdmin`, `@RecentConfirmation` |
| `PublicacaoModule`, `FilasModule`, `WorkerModule` | `PublishingModule`, `QueuesModule`, `WorkerModule` |
| `instagram/cliente.ts` | `instagram/client.ts` |

**Variáveis de ambiente e comandos que mudaram de nome**

| Antes | Agora |
|---|---|
| `SESSAO_INATIVIDADE_DIAS`, `SESSAO_MAXIMO_DIAS` | `SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS` |
| `TOTP_EMISSOR` | `TOTP_ISSUER` |
| `DATABASE_URL_TESTE` | `TEST_DATABASE_URL` |
| `MINIO_URL_PUBLICA`, `MINIO_PORTA_LOCAL` | `MINIO_PUBLIC_URL`, `MINIO_LOCAL_PORT` |
| `VAPID_ASSUNTO` | `VAPID_SUBJECT` |
| `SEM_BUMP=1` | `SKIP_BUMP=1` |
| `npm run tunel`, `npm run midia:preparar` | `npm run tunnel`, `npm run media:setup` |
| `npm run versao:minor`, `versao:major` | `npm run version:minor`, `version:major` |
| `admin:criar`, `admin:promover`, `admin:redefinir-senha`, `admin:resetar-2fa` | `admin:create`, `admin:promote`, `admin:reset-password`, `admin:reset-2fa` |
| `scripts/versao.mjs`, `scripts/tunel.cjs` | `scripts/version.mjs`, `scripts/tunnel.cjs` |

## Consequências

### Positivas

- Nomes do código no idioma das bibliotecas e da maior parte do material técnico
- O banco não muda: a migração inicial continua a mesma, e os nomes do [07](../07-modelo-dados.md) seguem valendo

### Negativas

- **Dois vocabulários**: documentação e banco falam `Postagem`, o código fala `Post`. A tabela acima é a ponte e
  precisa ser mantida
- O `schema.prisma` fica mais longo, com `@map` em cada campo

## Alternativas consideradas

**Tudo em inglês, inclusive o banco.** Um vocabulário só no código e no banco, mas descartado pelo dono: o banco
mantém os nomes do documento de modelo de dados.

**Manter tudo em português.** A convenção anterior.

## Reversibilidade

**Média.** Renomear identificadores é mecânico, mas atinge todo o código já escrito.
