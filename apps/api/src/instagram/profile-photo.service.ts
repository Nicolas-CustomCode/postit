import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PUBLIC_PREFIX, StorageService } from "../storage/storage.service";

/**
 * Copia a foto de perfil da conta para o nosso armazenamento (docs/08, "Padrões
 * de implementação"; docs/11, "O bucket de mídia").
 *
 * Roda ao conectar a conta **e a cada renovação de token**, porque o endereço que
 * a Meta fornece é assinado e deixa de valer. As telas nunca carregam imagem dos
 * servidores da Meta: a CSP não libera domínio de terceiro, o navegador de quem
 * usa não conversa com a Meta, e a foto não some quando o link expira.
 *
 * ⚠️ Este é o único lugar que busca algo da Meta sem passar pelo `InstagramClient`,
 * e não contraria a regra 3: o que a regra protege é o **token**, e aqui não há
 * token nenhum. O endereço já vem assinado do CDN e é baixado sem credencial.
 */

/** O que aceitamos como foto. Qualquer outra coisa é descartada sem gravar. */
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Foto de perfil do Instagram não chega perto disso. O limite é contra surpresa. */
const MAX_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 20_000;

@Injectable()
export class InstagramProfilePhotoService {
  private readonly logger = new Logger("Instagram");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Baixa, grava e aponta a conta para a foto nova.
   *
   * **Nunca lança.** A conta funciona sem avatar — a tela já trata
   * `photoObjectKey` nulo —, e derrubar uma conexão ou uma renovação de token
   * porque uma imagem não baixou seria trocar um problema cosmético por um caro.
   * Quem chama não precisa de `try/catch`.
   */
  async copy(accountId: string, sourceUrl: string | null, currentKey: string | null): Promise<void> {
    if (sourceUrl === null) return;

    try {
      const imagem = await this.download(sourceUrl);
      if (imagem === null) return;

      const key = `${PUBLIC_PREFIX}contas/${randomBytes(16).toString("hex")}.${imagem.extension}`;
      await this.storage.putPublic(key, imagem.body, imagem.contentType);
      await this.prisma.db.account.update({ where: { id: accountId }, data: { photoObjectKey: key } });

      /*
       * A antiga só sai depois que a conta já aponta para a nova. Na ordem
       * inversa, uma falha no meio deixaria a conta apontando para um objeto que
       * não existe mais — avatar quebrado em vez de avatar velho.
       *
       * Gravar numa chave nova em vez de sobrescrever a mesma é de propósito: o
       * domínio de mídia serve com cache longo (docs/10), e reusar a chave
       * deixaria a foto antiga no navegador de quem já a tinha visto.
       */
      if (currentKey !== null && currentKey !== key) await this.storage.removePublic(currentKey);
    } catch (error) {
      this.logger.warn(
        `Não consegui copiar a foto de perfil da conta ${accountId}: ${error instanceof Error ? error.name : "desconhecido"}`,
      );
    }
  }

  /** `null` quando a resposta não serve — a razão vai para o log, o erro não sobe. */
  private async download(sourceUrl: string): Promise<{ body: Buffer; contentType: string; extension: string } | null> {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      this.logger.warn(`O CDN da Meta respondeu ${response.status} para a foto de perfil.`);
      return null;
    }

    // Só o tipo, sem o `; charset=` que alguns servidores acrescentam.
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = ACCEPTED[contentType];
    if (extension === undefined) {
      this.logger.warn(`Foto de perfil recusada: tipo "${contentType}" não é imagem aceita.`);
      return null;
    }

    const body = Buffer.from(await response.arrayBuffer());
    // Conferido no buffer, e não no Content-Length: o cabeçalho pode faltar ou
    // mentir, e é o que realmente chegou que vai para o bucket.
    if (body.length === 0 || body.length > MAX_BYTES) {
      this.logger.warn(`Foto de perfil recusada: ${body.length} bytes fora do limite.`);
      return null;
    }

    return { body, contentType, extension };
  }
}
