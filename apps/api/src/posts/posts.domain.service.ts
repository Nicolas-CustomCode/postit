import { Injectable } from "@nestjs/common";
import type { Prisma, PostFormat, PostStatus } from "@repo/database";
import { isImageFormat, type ComposableFormat, type ImageFormat, type PermissionHolder } from "@repo/shared";
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
import { selfApprovalRefused } from "../domain/post/approval-rules";
import { postReadinessProblem, type PostProblem } from "../domain/post/post-readiness";
import {
  canMarkReady,
  isEditable,
  keepsSchedule,
  READY_CHAIN,
  statusAfterContentEdit,
} from "../domain/post/post-state";
import { canCancel, resolveSchedule, scheduleMoveFor, type ScheduleProblem } from "../domain/post/schedule";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Criar e editar postagens (RF-C01, RF-C03, RF-C12; docs/05).
 *
 * ⚠️ **Só dois métodos privados tocam a tabela `Postagem`**, e um teste de
 * arquitetura garante isso:
 *
 * - `applyUserWrite()` — a trava otimista da versão (regra 20);
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
   * Troca a imagem da postagem.
   *
   * Nesta fase é **uma** imagem, em `position: 0`. Apagar e recriar evita o
   * conflito com a unicidade de `(postagemId, ordem)` que reordenar um carrossel
   * traria — e carrossel é Fase 2.
   *
   * A mídia é validada contra o formato aqui, com os fatos lidos do registro
   * `Midia`: as medidas de lá já têm a rotação do EXIF aplicada.
   */
  async setMedia(input: Scope & { mediaId: string; altText: string | null }): Promise<Saved> {
    // A postagem primeiro: é ela que carrega a conferência de conta (regra 24).
    // Validar a mídia antes responderia sobre o arquivo a quem nem tem acesso à
    // postagem.
    const post = await this.load(input);

    const media = await this.prisma.db.media.findUnique({ where: { id: input.mediaId } });
    // Mídia inexistente é envio abandonado ou identificador inventado — não é
    // "postagem não encontrada". A mensagem precisa mandar escolher o arquivo de
    // novo, que é o que resolve.
    if (media === null) throw new MediaUploadInvalidError();

    // Contra o formato **da postagem**, não contra um literal: em Stories a
    // mesma imagem 9:16 que o feed recusa é a que serve.
    const problema = postReadinessProblem({
      format: formatOf(post.format),
      caption: null,
      media: [{ mimeType: media.mimeType, bytes: media.bytes, width: media.width, height: media.height }],
    });
    if (problema !== null) throw readinessError(problema);

    return this.applyContentChange(input, {}, async (tx) => {
      await tx.postMedia.deleteMany({ where: { postId: post.id } });
      await tx.postMedia.create({
        data: { postId: post.id, mediaId: input.mediaId, position: 0, altText: input.altText },
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
   * Marcar como pronta: `RASCUNHO → EM_REVISAO → APROVADO`, numa transação.
   *
   * ⚠️ **Duas transições legais encadeadas, não uma aresta inventada.** Nenhuma
   * postagem persiste em `EM_REVISAO` — não há fila de revisão nesta fase —, mas
   * a máquina de estados continua a do `docs/05` e a invariante I-1 vale sem
   * asterisco. As duas linhas de `Aprovacao` contam a verdade: "Fulano enviou e
   * aprovou às 14h32". Na Fase 4 a mudança é parar de encadear.
   */
  async markReady(input: Scope & { approver: PermissionHolder & { id: string } }): Promise<Saved> {
    const post = await this.load(input);

    if (!canMarkReady(post.status)) throw new PostTransitionInvalidError();
    if (selfApprovalRefused(input.approver, post.createdById)) throw new SelfApprovalForbiddenError();

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

    return this.applyUserWrite(input, post.status, { status: "APPROVED" }, async (tx) => {
      // Uma linha por passo do caminho, no mesmo instante e do mesmo usuário.
      await tx.approval.createMany({
        data: READY_CHAIN.map((passo) => ({
          postId: post.id,
          userId: input.userId,
          action: passo === "IN_REVIEW" ? ("SUBMITTED_FOR_REVIEW" as const) : ("APPROVED" as const),
        })),
      });
    });
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

    const movimento = scheduleMoveFor(post.status);
    if (movimento === null) throw new PostTransitionInvalidError();

    const resolvido = resolveSchedule({
      day: input.day,
      time: input.time,
      timeZone: post.account.timezone,
      now: input.now,
    });
    if ("problem" in resolvido) throw scheduleError(resolvido.problem);

    return this.applyUserWrite(input, post.status, {
      // Reagendar não mexe no status: `AGENDADO` continua `AGENDADO`, e por isso
      // não passa por `canTransition` (RF-D04; AGENTS.md, regra 8).
      ...(movimento === "TRANSITION" ? { status: "SCHEDULED" as const } : {}),
      scheduledAt: resolvido.instant,
      // Quem definiu o horário vigente é a pergunta que a auditoria faz.
      scheduledById: input.userId,
    });
  }

  /** Cancelar o que já tem horário marcado, ou parou de vez (RF-D05). */
  async cancel(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    if (!canCancel(post.status)) throw new PostTransitionInvalidError();

    return this.applyUserWrite(input, post.status, { status: "CANCELED" });
  }

  /** Descartar um rascunho. Cancelar o que já está agendado é `cancel()`. */
  async discard(input: Scope): Promise<Saved> {
    const post = await this.load(input);
    if (post.status !== "DRAFT") throw new PostTransitionInvalidError();

    return this.applyUserWrite(input, post.status, { status: "CANCELED" });
  }

  /** A postagem com o que as regras precisam. Sempre pelos dois identificadores. */
  private async load(scope: Scope) {
    const post = await this.prisma.db.post.findFirst({
      where: { id: scope.postId, accountId: scope.accountId },
      include: {
        media: { include: { media: true } },
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
   */
  private async applyUserWrite(
    scope: Scope,
    expectedStatus: PostStatus,
    data: Prisma.PostUncheckedUpdateManyInput,
    extra?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<Saved> {
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

      await extra?.(tx);
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
   * Editar legenda ou mídia de uma postagem `APROVADO` ou `AGENDADO` a devolve
   * para `RASCUNHO`, e registra o motivo. Sem isso, alguém aprovaria uma legenda
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
      },
      async (tx) => {
        if (rebaixou) {
          await tx.approval.create({
            data: { postId: post.id, userId: scope.userId, action: "INVALIDATED_BY_EDIT" },
          });
        }
        await extra?.(tx);
      },
    );
  }
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
