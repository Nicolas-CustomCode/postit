import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { imageSize } from "image-size";
import { IMAGE_UPLOAD_SPEC, validateImageUpload, type ImageProblem, type MediaSummary } from "@repo/shared";
import {
  MediaAlreadyConfirmedError,
  MediaCorruptError,
  MediaRatioUnsupportedError,
  MediaTooLargeError,
  MediaTooNarrowError,
  MediaUploadInvalidError,
  MediaWrongTypeError,
} from "../common/errors";
import { detectImageType, orientedSize } from "../domain/media/image-rules";
import { PrismaService } from "../prisma/prisma.service";
import { PUBLIC_PREFIX, RECEIVED_PREFIX, StorageService } from "../storage/storage.service";
import { MEDIA_CONFIG, type MediaConfig } from "./media.config";
import { readUploadTicket, signUploadTicket } from "./upload-ticket";

/**
 * Enviar e validar mídia (RF-B01, RF-B02; ADR 0012).
 *
 * O fluxo tem três passos, e o do meio não passa por aqui: a API autoriza, **o
 * navegador envia direto ao MinIO**, e a API confere depois. Arquivo grande
 * nunca atravessa o Next nem a API — é o que permite o limite de 1 MB por
 * requisição valer sem exceção (regra 10).
 *
 * A regra que dá sentido a tudo: **o arquivo só fica público depois de
 * validado**. Até lá ele mora em `recebidos/`, que ninguém de fora lê.
 *
 * ⚠️ **O que se valida aqui é o piso, não o formato.** Proporção depende do
 * formato de destino, que só existe na postagem (RF-B03): uma arte 9:16 é
 * inválida para o feed e perfeita para Stories. O acervo é compartilhado e a
 * mesma mídia serve a várias postagens (RF-B04), então ela entra pelo que vale em
 * qualquer formato, e a pergunta "isto serve?" fica para a composição.
 */
@Injectable()
export class MediaDomainService {
  private readonly logger = new Logger("Media");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  /**
   * Autoriza um envio: uma chave nova, e a permissão assinada para ela.
   *
   * **A chave é nossa, nunca do usuário.** O nome original do arquivo é
   * descartado — nem sanitizado —, porque em `publicas/` a URL imprevisível *é*
   * a proteção (ADR 0005, docs/11). São 128 bits aleatórios, só US-ASCII, como
   * a Meta exige do caminho do objeto.
   */
  async authorizeUpload(userId: string, now: Date) {
    const objectKey = `${RECEIVED_PREFIX}postagens/${randomBytes(16).toString("hex")}.jpg`;

    const politica = await this.storage.signedUpload({
      key: objectKey,
      contentType: IMAGE_UPLOAD_SPEC.mime,
      // Um byte: arquivo vazio é recusado pelo próprio armazenamento.
      minBytes: 1,
      maxBytes: IMAGE_UPLOAD_SPEC.maxBytes,
      ttlSeconds: this.config.uploadTtlSeconds,
      now,
    });

    const ticket = signUploadTicket(
      {
        objectKey,
        userId,
        contentType: IMAGE_UPLOAD_SPEC.mime,
        maxBytes: IMAGE_UPLOAD_SPEC.maxBytes,
        expiresAt: politica.expiresAt.getTime(),
      },
      this.config.uploadSecret,
    );

    return {
      // O destino e os campos vão para o navegador; a chave, não — ela viaja
      // dentro do comprovante assinado.
      url: politica.url,
      fields: politica.fields,
      ticket,
      expiresAt: politica.expiresAt.toISOString(),
    };
  }

  /**
   * Confere o que foi enviado e, se prestar, publica.
   *
   * **A ordem importa em dois lugares.** A `Midia` é gravada **antes** de o
   * arquivo ir para `publicas/`: se a cópia falhasse depois de publicar,
   * sobraria um objeto público sem registro — órfão invisível, que é justamente
   * a fraqueza que o ADR 0012 veio corrigir. E `recebidos/` é limpo **em
   * qualquer desfecho**, no `finally`, porque o arquivo recusado não pode ficar
   * ocupando espaço nem esperando alguém achá-lo.
   */
  async confirmUpload(input: { userId: string; ticket: string; now: Date }): Promise<MediaSummary> {
    const ticket = readUploadTicket(input.ticket, input.userId, this.config.uploadSecret, input.now);
    if (ticket === null) throw new MediaUploadInvalidError();

    const publicKey = ticket.objectKey.replace(RECEIVED_PREFIX, PUBLIC_PREFIX);

    // Confirmar duas vezes acontece: a tela repete depois de um tempo esgotado
    // que tinha dado certo. Sem esta conferência, a segunda vez estoura a
    // unicidade e vira "Algo deu errado" com o arquivo já publicado.
    const jaExiste = await this.prisma.db.media.findUnique({ where: { objectKey: publicKey } });
    if (jaExiste !== null) throw new MediaAlreadyConfirmedError();

    let apagarRecebido = true;
    try {
      const bytes = await this.readReceived(ticket.objectKey);
      const fatos = this.inspect(bytes, ticket.maxBytes);

      const midia = await this.prisma.db.media.create({
        data: {
          objectKey: publicKey,
          mimeType: fatos.mimeType,
          bytes: fatos.bytes,
          width: fatos.width,
          height: fatos.height,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });

      try {
        await this.storage.promoteToPublic(ticket.objectKey, publicKey);
      } catch (error) {
        // A linha existiria apontando para um objeto que não está em
        // `publicas/`: a tela mostraria uma imagem quebrada para sempre.
        await this.prisma.db.media.delete({ where: { id: midia.id } });
        throw error;
      }

      // `promoteToPublic` já apagou o original.
      apagarRecebido = false;

      return {
        id: midia.id,
        width: midia.width,
        height: midia.height,
        bytes: midia.bytes,
      };
    } finally {
      if (apagarRecebido) {
        await this.storage.removeReceived(ticket.objectKey).catch(() => undefined);
      }
    }
  }

  /** Some entre autorizar e confirmar: envio abandonado, ou chave inventada. */
  private async readReceived(objectKey: string): Promise<Buffer> {
    try {
      return await this.storage.getReceived(objectKey);
    } catch {
      // Sem isto, o `NoSuchKey` do SDK vira "Algo deu errado" no filtro global.
      throw new MediaUploadInvalidError();
    }
  }

  /**
   * O que os **bytes** dizem sobre o arquivo.
   *
   * Nada aqui confia no que o navegador declarou: quem envia controla o
   * `Content-Type` e o nome. O tipo sai da assinatura do arquivo, as medidas do
   * cabeçalho, e o tamanho é o que realmente chegou — mesmo princípio do
   * `profile-photo.service.ts`.
   */
  private inspect(bytes: Buffer, maxBytes: number) {
    const mimeType = detectImageType(bytes);
    if (mimeType === null) throw new MediaWrongTypeError();

    // O MinIO já recusaria pelo limite da política; esta conferência cobre o
    // caso de a política ter sido emitida com outro limite.
    if (bytes.length > maxBytes) throw new MediaTooLargeError();

    let medidas: { width?: number; height?: number; orientation?: number };
    try {
      medidas = imageSize(bytes);
    } catch {
      throw new MediaCorruptError();
    }

    // Medida ausente ou degenerada é arquivo quebrado, não regra violada — a
    // mensagem precisa mandar trocar o arquivo, não redimensioná-lo.
    if (medidas.width === undefined || medidas.height === undefined) throw new MediaCorruptError();
    if (medidas.width <= 0 || medidas.height <= 0) throw new MediaCorruptError();

    // A rotação do EXIF entra aqui: a foto tirada em pé chega deitada nos bytes,
    // e as medidas gravadas na `Midia` são as que a composição vai usar para
    // decidir a que formatos ela serve.
    const { width, height } = orientedSize(medidas.width, medidas.height, medidas.orientation);

    const problema = validateImageUpload({ mimeType, bytes: bytes.length, width, height });
    if (problema !== null) throw problemToError(problema);

    return { mimeType, bytes: bytes.length, width, height };
  }
}

/**
 * O `MEDIA_RATIO_UNSUPPORTED` não sai do envio — proporção é decisão do formato,
 * e a composição é que a toma (RF-B03). Fica aqui porque `ImageProblem` é o mesmo
 * tipo das duas validações, e o switch precisa ser exaustivo.
 */
function problemToError(problem: ImageProblem): Error {
  switch (problem) {
    case "MEDIA_WRONG_TYPE":
      return new MediaWrongTypeError();
    case "MEDIA_TOO_LARGE":
      return new MediaTooLargeError();
    case "MEDIA_TOO_NARROW":
      return new MediaTooNarrowError();
    case "MEDIA_RATIO_UNSUPPORTED":
      return new MediaRatioUnsupportedError();
  }
}
