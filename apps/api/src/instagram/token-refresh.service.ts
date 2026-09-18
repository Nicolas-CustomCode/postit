import { Inject, Injectable, Logger } from "@nestjs/common";
import { InstagramUnavailableError } from "../common/errors";
import { decryptSecret, encryptSecret } from "../common/crypto";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramClient } from "./client";
import { translateRefusal } from "./errors";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "./instagram.config";
import { InstagramProfilePhotoService } from "./profile-photo.service";
import { InstagramProfileService } from "./profile.service";

/**
 * Mantém vivo o token de cada conta conectada (docs/08, "Renovação"; docs/09,
 * "renovar-tokens-instagram").
 *
 * **Por que isto existe:** o token do Instagram vale 60 dias. Passado esse prazo
 * não há recuperação — só reconectar a conta à mão. E o sintoma é o pior
 * possível: todas as publicações agendadas daquela conta falham, em silêncio,
 * até alguém reparar. O docs/08 chama isso de "a falha mais cara do sistema e a
 * mais fácil de prevenir".
 *
 * **Por que 30 dias, e não 55:** renovar na metade do prazo dá 30 dias de folga.
 * A tarefa pode falhar todo dia por um mês inteiro — worker parado, Meta fora do
 * ar, deploy demorado — e nenhuma conta expira. A folga é o desenho, não sobra.
 *
 * Mora no `InstagramModule`, que os dois processos podem importar, e não em
 * `publishing/`: o comando `admin:refresh-tokens` precisa chamar o mesmo método,
 * e o CLI não pode importar publicação nem filas (AGENTS.md, regra 1). Em
 * `publishing/` fica só o tratador da fila, que chama isto aqui.
 */
const REFRESH_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenRefreshOutcome {
  /** Contas que estavam no prazo de renovar. */
  readonly due: number;
  readonly refreshed: number;
  /** Falhas que adianta tentar de novo — rede, tempo esgotado, Meta fora do ar. */
  readonly recoverable: number;
  /** Falhas que não melhoram com repetição: acesso revogado, token morto. */
  readonly fatal: number;
}

@Injectable()
export class InstagramTokenRefreshService {
  private readonly logger = new Logger("Instagram");

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: InstagramClient,
    private readonly profiles: InstagramProfileService,
    private readonly photos: InstagramProfilePhotoService,
    @Inject(INSTAGRAM_CONFIG) private readonly config: InstagramConfig,
  ) {}

  /**
   * Renova toda conta cujo token já passou de 30 dias.
   *
   * Cada conta é isolada: uma que falha não impede as outras de renovar. Seria
   * fácil errar aqui — um `throw` no meio do laço deixaria metade das contas
   * sem renovar por causa de uma só.
   *
   * **Não lança, devolve o que aconteceu.** Quem decide se vale repetir é quem
   * chama: o tratador da fila lança para o pg-boss reagendar (docs/09, "quando
   * lançar e quando não lançar"), enquanto o comando de terminal imprime o
   * resumo. Lançar aqui perderia justamente o resumo que o comando precisa.
   */
  async refreshDue(now: Date): Promise<TokenRefreshOutcome> {
    const contas = await this.findDue(now);
    const resultado = { due: contas.length, refreshed: 0, recoverable: 0, fatal: 0 };

    for (const conta of contas) {
      const falha = await this.refreshOne(conta, now);
      if (falha === null) resultado.refreshed += 1;
      else if (falha === "recoverable") resultado.recoverable += 1;
      else resultado.fatal += 1;
    }

    this.logger.log(
      `Renovação de tokens: ${resultado.due} no prazo, ${resultado.refreshed} renovadas, ` +
        `${resultado.recoverable} a repetir, ${resultado.fatal} sem recuperação.`,
    );

    return resultado;
  }

  /**
   * Contas no prazo de renovar.
   *
   * A idade do token sai de `tokenRenovadoEm`, ou de `criadoEm` enquanto ele
   * nunca foi renovado — é quando o token atual nasceu. Derivar de
   * `tokenExpiraEm - 60 dias` seria adivinhar o prazo que a Meta concedeu.
   *
   * Token já expirado fica de fora: a Meta recusa renovar token vencido, e
   * insistir só gastaria chamada. Aquela conta precisa ser reconectada à mão, e
   * a tela já a mostra com aviso (`TOKEN_EXPIRED`).
   */
  private findDue(now: Date): Promise<AccountToRefresh[]> {
    const limite = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY_MS);

    return this.prisma.db.account.findMany({
      where: {
        active: true,
        network: "INSTAGRAM",
        tokenExpiresAt: { gt: now },
        OR: [{ tokenRefreshedAt: { lt: limite } }, { tokenRefreshedAt: null, createdAt: { lt: limite } }],
      },
      select: { id: true, username: true, tokenEncrypted: true, photoObjectKey: true },
      orderBy: { username: "asc" },
    });
  }

  /** `null` quando deu certo; o tipo da falha quando não. */
  private async refreshOne(conta: AccountToRefresh, now: Date): Promise<"recoverable" | "fatal" | null> {
    let token: string;

    try {
      token = decryptSecret(conta.tokenEncrypted, this.config.encryptionKey, "instagram-token");
    } catch {
      // Token que não decifra é chave trocada ou linha corrompida. Nenhuma das
      // duas se resolve tentando de novo, e a mensagem não pode dizer mais que
      // isso — ela descreveria o formato do que está guardado.
      this.logger.error(`O token guardado da conta ${conta.username} não pôde ser lido.`);
      await this.record(conta.id, "FATAL_ERROR");
      return "fatal";
    }

    let renovado: { access_token: string; expires_in: number };
    try {
      renovado = await this.client.refreshLongLived(token);
    } catch (error) {
      const traduzido = translateRefusal(error, "uso");
      const tipo = traduzido instanceof InstagramUnavailableError ? "recoverable" : "fatal";

      this.logger.warn(`Não renovei o token da conta ${conta.username}: ${traduzido.name}`);
      await this.record(conta.id, tipo === "recoverable" ? "RECOVERABLE_ERROR" : "FATAL_ERROR");
      return tipo;
    }

    await this.save(conta.id, renovado, now);
    await this.copyPhoto(conta, renovado.access_token);

    return null;
  }

  /**
   * O token novo e o evento entram na **mesma transação** (AGENTS.md, regra 8).
   *
   * Separá-los deixaria a trilha mentindo sobre quando aquele token nasceu — e é
   * justamente por `tokenRenovadoEm` que a próxima execução decide o que renovar.
   */
  private save(accountId: string, renovado: { access_token: string; expires_in: number }, now: Date): Promise<unknown> {
    const tokenEncrypted = encryptSecret(renovado.access_token, this.config.encryptionKey, "instagram-token");
    const tokenExpiresAt = new Date(now.getTime() + renovado.expires_in * 1000);

    return this.prisma.db.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { tokenEncrypted, tokenExpiresAt, tokenRefreshedAt: now },
      });
      await tx.tokenEvent.create({ data: { accountId, action: "REFRESH", result: "SUCCESS" } });
    });
  }

  /**
   * O endereço da foto que a Meta fornece é assinado e vence, então a cópia é
   * refeita a cada renovação (docs/08). Fora da transação de propósito: são duas
   * chamadas de rede, e nenhuma transação deve esperar por rede.
   */
  private async copyPhoto(conta: AccountToRefresh, token: string): Promise<void> {
    try {
      const perfil = await this.profiles.read(token, "uso");
      await this.photos.copy(conta.id, perfil.photoUrl, conta.photoObjectKey);
    } catch {
      // A renovação já deu certo, que é o que importa. Avatar velho não é falha.
      this.logger.warn(`Não reli o perfil da conta ${conta.username} depois de renovar; a foto continua a anterior.`);
    }
  }

  private async record(accountId: string, result: "RECOVERABLE_ERROR" | "FATAL_ERROR"): Promise<void> {
    await this.prisma.db.tokenEvent.create({ data: { accountId, action: "REFRESH", result } });
  }
}

interface AccountToRefresh {
  readonly id: string;
  readonly username: string;
  readonly tokenEncrypted: string;
  readonly photoObjectKey: string | null;
}
