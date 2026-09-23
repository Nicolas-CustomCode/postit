import { Inject, Injectable } from "@nestjs/common";
import { TOKEN_WARNING_DAYS } from "@repo/shared";
import { AccountAlreadyConnectedError } from "../common/errors";
import { encryptSecret } from "../common/crypto";
import { ACCOUNTS_CONFIG, type AccountsConfig } from "./accounts.config";
import { INSTAGRAM_SCOPES, InstagramOAuthService } from "../instagram/oauth.service";
import { InstagramProfilePhotoService } from "../instagram/profile-photo.service";
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
    private readonly photos: InstagramProfilePhotoService,
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
    const perfil = await this.profiles.read(token, "conexao");

    const jaExiste = await this.prisma.db.account.findUnique({
      where: { network_externalId: { network: "INSTAGRAM", externalId: perfil.externalId } },
      select: { id: true, active: true, photoObjectKey: true, accessLostAt: true, tokenExpiresAt: true },
    });

    const expiresAt = new Date(input.now.getTime() + expiresInSeconds * 1000);
    const tokenEncrypted = encryptSecret(token, this.config.encryptionKey, "instagram-token");

    try {
      const conta = await this.gravar({ jaExiste, perfil, tokenEncrypted, expiresAt, now: input.now });

      // Depois da transação, nunca dentro: baixar e gravar a foto é rede, e
      // transação não espera por rede. O método não lança — conta sem avatar
      // funciona, e a tela já trata a foto ausente.
      await this.photos.copy(conta.id, perfil.photoUrl, jaExiste?.photoObjectKey ?? null);

      return conta.username;
    } catch (error) {
      /*
       * Duas abas concluindo a conexão da MESMA conta ao mesmo tempo: as duas
       * leem "não existe" acima e as duas tentam criar. A restrição de
       * unicidade do banco impede a linha duplicada — e é ela que garante isso,
       * não a leitura acima; mover o `findUnique` para dentro da transação não
       * resolveria, porque o nível é *read committed*.
       *
       * O que falta é traduzir: sem isto, a segunda aba vê "algo deu errado"
       * (500) em vez de "esta conta já está conectada".
       */
      if (isUniqueViolation(error)) throw new AccountAlreadyConnectedError();
      throw error;
    }
  }

  private gravar(input: {
    jaExiste: { id: string; active: boolean; accessLostAt: Date | null; tokenExpiresAt: Date } | null;
    perfil: { externalId: string; username: string; name: string | null };
    tokenEncrypted: string;
    expiresAt: Date;
    now: Date;
  }): Promise<{ id: string; username: string }> {
    const { jaExiste, perfil, tokenEncrypted, expiresAt } = input;

    return this.prisma.db.$transaction(async (tx) => {
      // Reconectar uma conta desativada é religar a mesma linha, não criar outra:
      // as postagens antigas continuam apontando para ela.
      if (jaExiste !== null) {
        /*
         * Conta ativa só se reconecta quando precisa: a Meta recusou o acesso, ou o
         * token venceu ou está para vencer. É o "Reconectar" da postagem que falhou
         * por token (docs/09). Conta saudável continua dizendo "já está conectada" —
         * conectar de novo por engano não é ação que a tela deva aceitar calada.
         */
        if (jaExiste.active && !needsReconnect(jaExiste, input.now)) throw new AccountAlreadyConnectedError();

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
            // Token novo: o sinal de acesso perdido não vale mais (docs/07).
            accessLostAt: null,
          },
        });
        await tx.tokenEvent.create({
          data: { accountId: jaExiste.id, action: "LONG_LIVED_EXCHANGE", result: "SUCCESS" },
        });

        return { id: jaExiste.id, username: perfil.username };
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

      return conta;
    });
  }
}

/**
 * P2002 é a violação de restrição de unicidade do Prisma — aqui, sempre a
 * `@@unique([network, externalId])` da tabela de contas.
 *
 * Conferido pelo `code`, e não pela classe: importar o tipo de erro do Prisma
 * amarraria este módulo ao client gerado, que é justamente o acoplamento que a
 * regra 6 evita.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

/** A conta ativa precisa de token novo? A mesma régua do aviso da tela de contas. */
function needsReconnect(account: { accessLostAt: Date | null; tokenExpiresAt: Date }, now: Date): boolean {
  if (account.accessLostAt !== null) return true;
  return account.tokenExpiresAt.getTime() - now.getTime() <= TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000;
}
