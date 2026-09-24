import { Injectable } from "@nestjs/common";
import type { Prisma, PostFormat, PostStatus } from "@repo/database";
import {
  isImageFormat,
  selfApprovalRefused,
  type ComposableFormat,
  type ImageFormat,
  type PermissionHolder,
  type PostTrailAction,
} from "@repo/shared";
import {
  MediaUploadInvalidError,
  PostNotEditableError,
  PostNotFoundError,
  PostNotReadyError,
  PostTransitionInvalidError,
  PostVersionConflictError,
  ScheduleInPastError,
  ScheduleTimeDoesNotExistError,
  SelfApprovalForbiddenError,
} from "../common/errors";
import { postReadinessProblem, type PostProblem } from "../domain/post/post-readiness";
import {
  canApproveAndSchedule,
  canReopen,
  canTransition,
  canUnschedule,
  isEditable,
  keepsSchedule,
  statusAfterContentEdit,
} from "../domain/post/post-state";
import { trailActionFor } from "../domain/post/post-trail";
import { canCancel, resolveSchedule, scheduleMoveFor, type ScheduleProblem } from "../domain/post/schedule";
import { recordNotice } from "../notifications/record-notice";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Criar e editar postagens, e as decisões sobre elas (RF-C01, RF-C03, RF-C12,
 * RF-E01 a RF-E05; docs/05; ADR 0026).
 *
 * ⚠️ **Só dois métodos privados tocam a tabela `Postagem`**, e um teste de
 * arquitetura garante isso:
 *
 * - `applyUserWrite()` — a trava otimista da versão (regra 20), e o registro da
 *   decisão em `Aprovacao`, na mesma transação;
 * - `applyContentChange()` — a mesma coisa, **mais** a invariante I-2.
 *
 * É o que impede o modo de falha que a invariante existe para evitar: alguém
 * acrescenta um campo de conteúdo daqui a três meses, esquece de derrubar a
 * postagem para rascunho, e o sistema passa a publicar algo que ninguém
 * aprovou. Com dois primitivos, a pergunta "isto é conteúdo?" vira a escolha de
 * qual dos dois chamar — e essa escolha mora num método de quatro linhas.
 */
@Injectable()
export class PostsDomainService {
  /**
   * Os métodos que mexem em conteúdo. O teste confere que **todos** eles
   * derrubam a postagem para rascunho: método novo sem linha na tabela do teste
   * reprova a CI.
   */
  static readonly CONTENT_METHODS = ["setCaption", "setMedia", "setFormat"] as const;

  constructor(private readonly prisma: PrismaService) {}

  /** Uma postagem nasce em `RASCUNHO`, vazia. Nenhuma chamada à Meta acontece. */
  async create(input: {
    accountId: string;
    userId: string;
    format: ComposableFormat;
    caption: string | null;
  }): Promise<{ id: string }> {
    const post = await this.prisma.db.post.create({
      data: {
        accountId: input.accountId,
        format: input.format,
        caption: input.caption,
        createdById: input.userId,
      },
      select: { id: true },
    });

    return post;
  }

  setCaption(input: Scope & { caption: string | null }): Promise<Saved> {
    return this.applyContentChange(input, { caption: input.caption });
  }

  /**
   * Troca a lista de mídias da postagem, **inteira e na ordem final**.
   *
   * De 0 a 10 itens: reordenar, remover e trocar são todos esta chamada. A
   * ordem é a do array, e ela é conteúdo de verdade — a primeira imagem define
   * o quadro de todas no carrossel (docs/08).
   *
   * A mídia é validada contra o formato aqui, com os fatos lidos do registro
   * `Midia`: as medidas de lá já têm a rotação do EXIF aplicada.
   */
  async setMedia(
    input: Scope & { media: readonly { mediaId: string; altText: string | null }[] },
  ): Promise<Saved> {
    // A postagem primeiro: é ela que carrega a conferência de conta (regra 24).
    // Validar a mídia antes responderia sobre o arquivo a quem nem tem acesso à
    // postagem.
    const post = await this.load(input);

    const ids = input.media.map((item) => item.mediaId);
    // Uma consulta para todas: dez `findUnique` num carrossel seriam dez idas ao
    // banco para a mesma decisão.
    const encontradas = await this.prisma.db.media.findMany({ where: { id: { in: ids } } });
    const porId = new Map(encontradas.map((linha) => [linha.id, linha]));

    // Mídia inexistente é envio abandonado ou identificador inventado — não é
    // "postagem não encontrada". A mensagem precisa mandar escolher o arquivo de
    // novo, que é o que resolve.
    //
    // ⚠️ Conferir pelo mapa, e não por `encontradas.length === ids.length`: a
    // lista pode repetir a mesma mídia de propósito, e aí as contagens não batem
    // sem que nada esteja errado.
    if (ids.some((id) => !porId.has(id))) throw new MediaUploadInvalidError();

    // Contra o formato **da postagem**, não contra um literal: em Stories a
    // mesma imagem 9:16 que o feed recusa é a que serve.
    const problema = postReadinessProblem({
      format: formatOf(post.format),
      caption: null,
      // ⚠️ Na ordem **pedida**, não na que o banco devolveu: `findMany` com `in`
      // não promete ordem nenhuma e deduplica, e aqui a ordem é conteúdo.
      media: ids.map((id) => {
        const linha = porId.get(id)!;
        return { mimeType: linha.mimeType, bytes: linha.bytes, width: linha.width, height: linha.height };
      }),
    });
    // Lista vazia não impede salvar: é "tirei todas". A falta de imagem é
    // problema de **ficar pronta** — a mesma ressalva que `setFormat` faz.
    if (problema !== null && problema !== "POST_MEDIA_REQUIRED") throw readinessError(problema);

    return this.applyContentChange(input, {}, async (tx) => {
      // ⚠️ Apagar e recriar, e não um diff. A unicidade de `(postagemId, ordem)`
      // é conferida na hora, então reordenar sem apagar antes estoura.
      //
      // No dia em que houver marcação (RF-C05, Fase 2), este `deleteMany` passa
      // a falhar: `Marcacao` aponta para `PostagemMidia` com ON DELETE RESTRICT,
      // e será preciso preservar as linhas cuja (midiaId, ordem) não mudou. Hoje
      // nada grava `Marcacao`, então não há o que preservar.
      await tx.postMedia.deleteMany({ where: { postId: post.id } });
      await tx.postMedia.createMany({
        data: input.media.map((item, indice) => ({
          postId: post.id,
          mediaId: item.mediaId,
          position: indice,
          altText: item.altText,
        })),
      });
    });
  }

  /**
   * Troca o formato de destino (RF-C02).
   *
   * ⚠️ **Revalida a imagem já anexada.** Uma arte 9:16 serve a Stories e não ao
   * feed: anexar em Stories e depois mudar para Feed é a rota de estrago que
   * esta conferência fecha. É a mesma `postReadinessProblem` que decide se a
   * postagem pode ficar pronta — uma regra, dois momentos.
   *
   * Formato **é conteúdo** (o RF-E05 o cita com todas as letras), então passa
   * por `applyContentChange`: derruba para rascunho e apaga o horário, como
   * legenda e mídia.
   */
  async setFormat(input: Scope & { format: ComposableFormat }): Promise<Saved> {
    const post = await this.load(input);

    const problema = postReadinessProblem({
      format: input.format,
      caption: null,
      media: post.media.map((item) => ({
        mimeType: item.media.mimeType,
        bytes: item.media.bytes,
        width: item.media.width,
        height: item.media.height,
      })),
    });
    // Sem imagem ainda não é impedimento para escolher o formato — a falta dela
    // é problema de "ficar pronta", não de "qual formato".
    if (problema !== null && problema !== "POST_MEDIA_REQUIRED") throw readinessError(problema);

    return this.applyContentChange(input, { format: input.format });
  }

  /**
   * Enviar para revisão: `RASCUNHO → EM_REVISAO` (RF-E01; ADR 0026).
   *
   * Confere a prontidão **aqui**, e não só na aprovação: quem revisa não deveria
   * receber uma postagem sem imagem, nem descobrir no clique de aprovar que a
   * proporção não serve.
   */
  async submit(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    if (!canTransition(post.status, "IN_REVIEW")) throw new PostTransitionInvalidError();

    assertReady(post);

    return this.applyUserWrite(input, post.status, { status: "IN_REVIEW" }, {
      trail: { action: "SUBMITTED_FOR_REVIEW" },
      // O aviso de quem pode aprovar, na transação do envio: 409 de versão desfaz os dois.
      extra: async (tx) => {
        await recordNotice(
          tx,
          { type: "POST", id: input.postId },
          { type: "AWAITING_APPROVAL", authorId: post.createdById, actorId: input.userId },
        );
      },
    });
  }

  /**
   * Aprovar (RF-E02) — e, com `schedule`, aprovar **e agendar** numa transação só
   * (ADR 0026): `EM_REVISAO → APROVADO → AGENDADO`, uma linha de `Aprovacao` com o
   * horário junto.
   *
   * ⚠️ **O horário é resolvido antes da transação.** Horário no passado recusa a
   * decisão inteira: a postagem continua em revisão, na mesma versão — e não
   * "aprovada, mas sem agendar", que seria meia decisão tomada em nome de alguém.
   * A mesma ordem de `schedule()`: `resolveSchedule` é puro, e o `now` é o da
   * requisição.
   */
  async approve(
    input: Scope & { approver: Approver; schedule?: { day: string; time: string; now: Date } },
  ): Promise<Saved> {
    const post = await this.load(input);

    // Só de EM_REVISAO. `canTransition(_, APPROVED)` não serve de pergunta: também
    // vale de AGENDADO, que é desagendar — e aprovar o que já estava aprovado
    // gravaria uma aprovação que ninguém deu.
    const pode = input.schedule ? canApproveAndSchedule(post.status) : post.status === "IN_REVIEW";
    if (!pode) throw new PostTransitionInvalidError();
    if (selfApprovalRefused(input.approver, post.createdById)) throw new SelfApprovalForbiddenError();

    // A legenda pode ter mudado durante a revisão; aprovar é dizer "esta vai ao ar".
    assertReady(post);

    if (!input.schedule) {
      return this.applyUserWrite(input, post.status, { status: "APPROVED" }, { trail: { action: "APPROVED" } });
    }

    const resolvido = resolveSchedule({ ...input.schedule, timeZone: post.account.timezone });
    if ("problem" in resolvido) throw scheduleError(resolvido.problem);

    return this.applyUserWrite(
      input,
      post.status,
      { status: "SCHEDULED", scheduledAt: resolvido.instant, scheduledById: input.userId, ...FRESH_CYCLE },
      { trail: { action: "APPROVED", scheduledFor: resolvido.instant } },
    );
  }

  /**
   * Reprovar com motivo (RF-E03): volta para `RASCUNHO`, e o motivo fica em
   * `Aprovacao` — é ele que a Composição mostra no topo para quem vai corrigir.
   *
   * A regra de autoaprovação vale aqui também: o ADR 0015 dá `POSTAGEM_APROVAR`
   * para postagens **de outros**, e reprovar é a outra metade da mesma decisão.
   */
  async reject(input: Scope & { approver: Approver; reason: string }): Promise<Saved> {
    const post = await this.load(input);

    if (post.status !== "IN_REVIEW") throw new PostTransitionInvalidError();
    if (selfApprovalRefused(input.approver, post.createdById)) throw new SelfApprovalForbiddenError();

    return this.applyUserWrite(input, post.status, { status: "DRAFT" }, {
      trail: { action: trailOf(post.status, "DRAFT", input.reason), reason: input.reason },
      extra: async (tx) => {
        // Quem enviou por último. O `extra` roda antes do `record`, então a linha
        // desta reprovação ainda não existe e não atrapalha a busca.
        const envio = await tx.approval.findFirst({
          where: { postId: input.postId, action: "SUBMITTED_FOR_REVIEW" },
          orderBy: { createdAt: "desc" },
          select: { userId: true },
        });
        await recordNotice(
          tx,
          { type: "POST", id: input.postId },
          {
            type: "POST_REJECTED",
            authorId: post.createdById,
            submitterId: envio?.userId ?? null,
            actorId: input.userId,
          },
        );
      },
    });
  }

  /**
   * "Voltar para a composição" (ADR 0026): em revisão, aprovada ou agendada →
   * `RASCUNHO`, sem horário.
   *
   * É `POSTAGEM_EDITAR`, como editar o conteúdo — que já derrubava para rascunho
   * (I-2). A porta explícita não dá poder novo, e anda na direção segura. `FALHOU`
   * tem a sua, com `POSTAGEM_AGENDAR`: é `toDraft()`.
   */
  async reopen(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    assertStillEditable(post);
    if (!canReopen(post.status)) throw new PostTransitionInvalidError();

    return this.applyUserWrite(
      input,
      post.status,
      { status: "DRAFT", scheduledAt: null, scheduledById: null, ...FRESH_CYCLE },
      { trail: { action: trailOf(post.status, "DRAFT") } },
    );
  }

  /**
   * Cancelar o agendamento **sem perder a aprovação** (ADR 0026): `AGENDADO →
   * APROVADO`. Sai o horário, e quem o marcou; fica a aprovação, esperando um
   * horário novo. Descartar de vez continua sendo `cancel()`.
   */
  async unschedule(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    assertStillEditable(post);
    if (!canUnschedule(post.status)) throw new PostTransitionInvalidError();

    return this.applyUserWrite(
      input,
      post.status,
      { status: "APPROVED", scheduledAt: null, scheduledById: null, ...FRESH_CYCLE },
      { trail: { action: trailOf(post.status, "APPROVED") } },
    );
  }

  /**
   * Marcar o horário de publicação (RF-D01, RF-D03, RF-D04; ADR 0006).
   *
   * **Uma rota para agendar e reagendar.** A tela sabe "este é o horário"; quem
   * decide se isso é uma transição ou só a troca do campo é o domínio, com o
   * status lido aqui. Obrigar a tela a escolher o verbo a partir de um status que
   * pode ter mudado daria 409 sem motivo.
   *
   * ⚠️ **A conversão acontece aqui, com o fuso da conta** — nunca no navegador.
   * O que chega é o relógio que a pessoa escolheu; converter na tela deixaria o
   * fuso do aparelho entrar por engano, acertando em Lisboa e errando no Brasil.
   */
  async schedule(input: Scope & { day: string; time: string; now: Date }): Promise<Saved> {
    const post = await this.load(input);
    assertStillEditable(post);

    const movimento = scheduleMoveFor(post.status);
    if (movimento === null) throw new PostTransitionInvalidError();

    /*
     * Reagendar uma que falhou é mandar de novo para o ar: a mesma conferência de
     * quem marca como pronta. Ela foi aprovada, mas pode ter falhado justamente por
     * uma imagem que não servia.
     */
    if (post.status === "FAILED") assertReady(post);

    const resolvido = resolveSchedule({
      day: input.day,
      time: input.time,
      timeZone: post.account.timezone,
      now: input.now,
    });
    if ("problem" in resolvido) throw scheduleError(resolvido.problem);

    return this.applyUserWrite(
      input,
      post.status,
      {
        // Reagendar não mexe no status: `AGENDADO` continua `AGENDADO`, e por isso
        // não passa por `canTransition` (RF-D04; AGENTS.md, regra 8).
        ...(movimento === "TRANSITION" ? { status: "SCHEDULED" as const } : {}),
        scheduledAt: resolvido.instant,
        // Quem definiu o horário vigente é a pergunta que a auditoria faz.
        scheduledById: input.userId,
        /*
         * Horário novo é ciclo novo: sem zerar as tentativas, a I-8 ("a primeira
         * execução não começa mais de 15 minutos atrasada") nunca valeria para uma
         * postagem reagendada depois de falhar. A causa sai junto — inclusive o
         * "esperando cota", que o horário novo deixa para trás.
         */
        ...FRESH_CYCLE,
      },
      // Reagendar também deixa linha: "agendada para sexta" e depois "para sábado".
      { trail: { action: trailOf(post.status, "SCHEDULED"), scheduledFor: resolvido.instant } },
    );
  }

  /**
   * `FALHOU → RASCUNHO`: "voltar para rascunho, para corrigir antes de agendar de
   * novo" (artboard `FalhaCelular`; ADR 0007).
   *
   * É decisão sobre uma postagem que falhou, e por isso pede `POSTAGEM_AGENDAR`,
   * como reagendar e cancelar (ADR 0015). O horário some pela mesma razão da I-2:
   * rascunho não exibe hora de saída.
   */
  async toDraft(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    if (post.status !== "FAILED") throw new PostTransitionInvalidError();

    return this.applyUserWrite(input, post.status, { status: "DRAFT", scheduledAt: null, ...FRESH_CYCLE }, {
      trail: { action: trailOf(post.status, "DRAFT") },
    });
  }

  /** Cancelar o que já tem horário marcado, ou parou de vez (RF-D05). */
  async cancel(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    assertStillEditable(post);
    if (!canCancel(post.status)) throw new PostTransitionInvalidError();

    return this.applyUserWrite(input, post.status, { status: "CANCELED" }, {
      trail: { action: trailOf(post.status, "CANCELED") },
    });
  }

  /** Descartar um rascunho. Cancelar o que já está agendado é `cancel()`. */
  async discard(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    if (post.status !== "DRAFT") throw new PostTransitionInvalidError();

    return this.applyUserWrite(input, post.status, { status: "CANCELED" }, {
      trail: { action: trailOf(post.status, "CANCELED") },
    });
  }

  /** A postagem com o que as regras precisam. Sempre pelos dois identificadores. */
  private async load(scope: Scope) {
    const post = await this.prisma.db.post.findFirst({
      where: { id: scope.postId, accountId: scope.accountId },
      include: {
        // ⚠️ Ordenado: a primeira imagem define o quadro de todas no carrossel
        // (docs/08), e sem `orderBy` o Postgres devolve na ordem que quiser.
        media: { orderBy: { position: "asc" }, include: { media: true } },
        // O fuso vem junto: é com ele que o relógio escolhido vira instante.
        account: { select: { timezone: true } },
      },
    });

    if (post === null) throw new PostNotFoundError();
    return post;
  }

  /**
   * **Primitivo 1 — a trava otimista** (RF-C12, regra 20).
   *
   * O `updateMany` é atômico: ler a versão antes e gravar depois abriria uma
   * janela para duas pessoas passarem. `update` não serve, porque lança `P2025`
   * e o `count` se perde sem ganhar discriminação nenhuma.
   *
   * ⚠️ **O status entra no `where` junto da versão.** O worker muda status sem
   * mexer em `versao` (regra 20), então a versão sozinha não perceberia que a
   * postagem foi despachada para publicação entre a leitura e a escrita.
   *
   * ⚠️ **Mudou o status, grava a decisão** (ADR 0026, decisão 3): toda mudança de
   * status feita por uma pessoa deixa uma linha em `Aprovacao`, na mesma
   * transação. Esquecer a `trail` é erro de programação, e estoura aqui — não vira
   * um buraco silencioso na linha do tempo.
   */
  private async applyUserWrite(
    scope: Scope,
    expectedStatus: PostStatus,
    data: Prisma.PostUncheckedUpdateManyInput,
    options: { trail: TrailEntry | null; extra?: (tx: Prisma.TransactionClient) => Promise<void> },
  ): Promise<Saved> {
    if (data.status !== undefined && data.status !== expectedStatus && options.trail === null) {
      throw new Error(`Mudança de status sem registro em Aprovacao: ${expectedStatus} → ${String(data.status)}`);
    }

    await this.prisma.db.$transaction(async (tx) => {
      const { count } = await tx.post.updateMany({
        where: { id: scope.postId, accountId: scope.accountId, version: scope.version, status: expectedStatus },
        data: { ...data, version: { increment: 1 }, updatedById: scope.userId },
      });

      if (count === 0) {
        // Só no caminho de erro, que é raro — e esta consulta traz os dados do
        // conflito no instante certo, dentro da transação.
        const atual = await tx.post.findFirst({
          where: { id: scope.postId, accountId: scope.accountId },
          select: { version: true, updatedAt: true, updatedBy: { select: { name: true } } },
        });

        if (atual === null) throw new PostNotFoundError();
        if (atual.version !== scope.version) {
          throw new PostVersionConflictError({
            updatedByName: atual.updatedBy?.name ?? null,
            updatedAt: atual.updatedAt,
            version: atual.version,
          });
        }
        // A versão bate, então foi o status que mudou por baixo: o worker pegou
        // a postagem para publicar.
        throw new PostNotEditableError();
      }

      await options.extra?.(tx);
      if (options.trail !== null) await this.record(tx, scope, options.trail);
    });

    /*
     * A versão nova é exatamente esta: o `where` casou com `scope.version` e o
     * incremento é de um. Devolvê-la evita a tela adivinhar — e adivinhar seria
     * frágil no dia em que uma escrita subisse a versão duas vezes.
     */
    return { version: scope.version + 1 };
  }

  /**
   * **Primitivo 2 — a invariante I-2** (RF-E05).
   *
   * Editar legenda ou mídia de uma postagem em revisão, aprovada, agendada ou que
   * falhou a devolve para `RASCUNHO`, e registra o motivo. Sem isso, alguém aprovaria uma legenda
   * e publicaria outra.
   *
   * Quem decide o status novo é `statusAfterContentEdit()`, no domínio — este
   * método só obedece.
   */
  private async applyContentChange(
    scope: Scope,
    data: Prisma.PostUncheckedUpdateManyInput,
    extra?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<Saved> {
    const post = await this.load(scope);
    if (!isEditable(post.status)) throw new PostNotEditableError();

    const novoStatus = statusAfterContentEdit(post.status);
    const rebaixou = novoStatus !== post.status;

    return this.applyUserWrite(
      scope,
      post.status,
      {
        ...data,
        status: novoStatus,
        /*
         * ⚠️ **O horário não sobrevive ao rebaixamento.** Uma postagem que caiu
         * para rascunho não pode continuar exibindo horário de saída: a I-2
         * existe para tornar visível que a aprovação morreu, e um horário
         * sobrevivente diria o contrário no campo que a pessoa foi conferir —
         * ela fecharia o navegador achando que sai sexta às 10:00.
         *
         * O que ela digitou não se perde: a tela mantém os campos preenchidos e
         * oferece reagendar num clique. Só o banco não guarda o que não vai
         * cumprir.
         */
        ...(keepsSchedule(novoStatus) ? {} : { scheduledAt: null }),
        /*
         * Caiu, recomeça a conta do publicador: a que falhou não leva a causa velha,
         * e a agendada que esperava cota não vira rascunho "esperando cota" — o
         * mesmo que `reopen()` faz pela porta explícita.
         */
        ...(rebaixou ? FRESH_CYCLE : {}),
      },
      // A aprovação que morreu fica registrada, com a causa: foi a edição (RF-E05).
      { trail: rebaixou ? { action: "INVALIDATED_BY_EDIT" } : null, ...(extra ? { extra } : {}) },
    );
  }

  /** A única escrita em `Aprovacao`: uma decisão, de quem age, nesta postagem. */
  private async record(tx: Prisma.TransactionClient, scope: Scope, trail: TrailEntry): Promise<void> {
    await tx.approval.create({
      data: {
        postId: scope.postId,
        userId: scope.userId,
        action: trail.action,
        reason: trail.reason ?? null,
        scheduledFor: trail.scheduledFor ?? null,
      },
    });
  }
}

/** Quem decide: a pessoa, com as permissões dela — a autoaprovação depende das duas. */
type Approver = PermissionHolder & { readonly id: string };

/** O que uma decisão grava em `Aprovacao`. */
interface TrailEntry {
  readonly action: PostTrailAction;
  readonly reason?: string | null;
  readonly scheduledFor?: Date | null;
}

/** A ação da transição, pelo domínio. Nula aqui seria transição do worker — que não passa por este serviço. */
function trailOf(from: PostStatus, to: PostStatus, reason?: string): PostTrailAction {
  const acao = trailActionFor(from, to, { reason: reason ?? null });
  if (acao === null) throw new Error(`Transição sem decisão humana: ${from} → ${to}`);
  return acao;
}

/**
 * O que uma postagem perde ao sair de `FALHOU` ou ganhar horário novo: as
 * tentativas do publicador e a causa da última falha. Só o usuário zera isto; o
 * worker zera no despacho (docs/07).
 */
const FRESH_CYCLE = { attempts: 0, lastErrorCode: null, lastErrorMessage: null } as const;

/**
 * A postagem ainda aceita decisão, ou o motor já a pegou?
 *
 * No minuto antes do horário, o despachante pode passar a postagem para
 * `PROCESSANDO` enquanto alguém clica em reagendar, cancelar ou editar. Sem esta
 * conferência a recusa saía por dois caminhos: `POST_TRANSITION_INVALID`, se a
 * leitura já via `PROCESSANDO`, e `POST_NOT_EDITABLE`, se o worker chegava entre a
 * leitura e a escrita (`applyUserWrite`). Agora os dois respondem o mesmo — e a
 * tela consegue dizer "já está sendo publicada" em vez de "mudou".
 */
function assertStillEditable(post: { status: PostStatus }): void {
  if (!isEditable(post.status)) throw new PostNotEditableError();
}

/** A conferência de "pronta para ir ao ar" — enviar para revisão, aprovar e reagendar a que falhou. */
function assertReady(post: {
  format: Parameters<typeof formatOf>[0];
  caption: string | null;
  media: readonly { media: { mimeType: string; bytes: number; width: number; height: number } }[];
}): void {
  const problema = postReadinessProblem({
    format: formatOf(post.format),
    caption: post.caption,
    media: post.media.map((item) => ({
      mimeType: item.media.mimeType,
      bytes: item.media.bytes,
      width: item.media.width,
      height: item.media.height,
    })),
  });
  if (problema !== null) throw readinessError(problema);
}

/**
 * O que toda escrita devolve: a versão nova.
 *
 * Sem ela, a tela teria de adivinhar somando um — e perderia o formulário
 * inteiro no dia em que uma escrita subisse a versão de outro jeito.
 */
export interface Saved {
  readonly version: number;
}

/** Tudo que identifica a escrita: a conta, a postagem, a versão e quem age. */
interface Scope {
  readonly accountId: string;
  readonly postId: string;
  readonly version: number;
  readonly userId: string;
}

/**
 * Todo problema de prontidão vira o mesmo 422, com o código do problema.
 *
 * Os códigos de mídia aparecem aqui também, e não é engano: o acervo aceitou a
 * imagem porque ela serve a **algum** formato, e é este formato que não a aceita
 * (RF-B03).
 */
function readinessError(problem: PostProblem): Error {
  return new PostNotReadyError(problem);
}

/**
 * O formato da postagem como o validador de imagem o conhece.
 *
 * ⚠️ **O enum do banco tem três valores; o validador de imagem conhece dois.**
 * Reels existe na coluna e ainda não é componível: é vídeo, e o validador dele
 * é Fase 2. Se aparecer aqui, é porque chegou ao banco por um caminho que esta
 * fase não abriu — e tratá-lo como feed seria validar contra a regra errada em
 * silêncio.
 */
function formatOf(format: PostFormat): ImageFormat {
  if (!isImageFormat(format)) {
    throw new Error(`Formato ainda não componível nesta fase: ${format}`);
  }
  return format;
}

function scheduleError(problem: ScheduleProblem): Error {
  return problem === "SCHEDULE_IN_PAST" ? new ScheduleInPastError() : new ScheduleTimeDoesNotExistError();
}
