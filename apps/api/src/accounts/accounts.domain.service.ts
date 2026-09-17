import { Inject, Injectable } from "@nestjs/common";
import { AccountAlreadyConnectedError } from "../common/errors";
import { encryptSecret } from "../common/crypto";
import { ACCOUNTS_CONFIG, type AccountsConfig } from "./accounts.config";
import { INSTAGRAM_SCOPES, InstagramOAuthService } from "../instagram/oauth.service";
import { InstagramProfileService } from "../instagram/profile.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Conectar uma conta do Instagram (RF-A01, RF-A02).
 *
 * Escreve; a leitura é do `AccountsQueryService`. O fuso nasce em
 * `America/Sao_Paulo` e é editável depois (docs/13) — quem publica no Brasil
 * quase sempre quer esse, e pedir o fuso no meio do OAuth atrapalha mais do que
 * ajuda.
 */
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

@Injectable()
export class AccountsDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: InstagramOAuthService,
    private readonly profiles: InstagramProfileService,
    @Inject(ACCOUNTS_CONFIG) private readonly config: AccountsConfig,
  ) {}

  /** Para onde mandar a pessoa autorizar. O `state` amarra a volta a ela. */
  startConnection(userId: string, now: Date): string {
    return this.oauth.authorizationUrl(userId, now);
  }

  /**
   * Conclui o que a autorização começou.
   *
   * A ordem importa: conferir o `state` **antes** de gastar uma chamada na Meta,
   * e ler o perfil **antes** de gravar, para uma conta pessoal ou não testadora
   * nunca virar linha no banco.
   *
   * A conta e o evento de token entram na **mesma transação** (AGENTS.md, regra
   * 8): uma conta gravada sem o evento correspondente deixa a trilha mentindo
   * sobre quando aquele token nasceu.
   */
  async finishConnection(input: { userId: string; code: string; state: string; now: Date }): Promise<string> {
    this.oauth.verifyState(input.state, input.userId, input.now);

    const { token, expiresInSeconds } = await this.oauth.redeem(input.code);
    const perfil = await this.profiles.read(token);

    const jaExiste = await this.prisma.db.account.findUnique({
      where: { network_externalId: { network: "INSTAGRAM", externalId: perfil.externalId } },
      select: { id: true, active: true },
    });

    const expiresAt = new Date(input.now.getTime() + expiresInSeconds * 1000);
    const tokenEncrypted = encryptSecret(token, this.config.encryptionKey, "instagram-token");

    return this.prisma.db.$transaction(async (tx) => {
      // Reconectar uma conta desativada é religar a mesma linha, não criar outra:
      // as postagens antigas continuam apontando para ela.
      if (jaExiste !== null) {
        if (jaExiste.active) throw new AccountAlreadyConnectedError();

        await tx.account.update({
          where: { id: jaExiste.id },
          data: {
            username: perfil.username,
            name: perfil.name,
            tokenEncrypted,
            tokenExpiresAt: expiresAt,
            tokenRefreshedAt: null,
            scopes: INSTAGRAM_SCOPES.join(","),
            active: true,
          },
        });
        await tx.tokenEvent.create({
          data: { accountId: jaExiste.id, action: "LONG_LIVED_EXCHANGE", result: "SUCCESS" },
        });

        return perfil.username;
      }

      const conta = await tx.account.create({
        data: {
          network: "INSTAGRAM",
          externalId: perfil.externalId,
          username: perfil.username,
          name: perfil.name,
          tokenEncrypted,
          tokenExpiresAt: expiresAt,
          scopes: INSTAGRAM_SCOPES.join(","),
          timezone: DEFAULT_TIMEZONE,
        },
        select: { id: true, username: true },
      });
      await tx.tokenEvent.create({
        data: { accountId: conta.id, action: "LONG_LIVED_EXCHANGE", result: "SUCCESS" },
      });

      return conta.username;
    });
  }
}
