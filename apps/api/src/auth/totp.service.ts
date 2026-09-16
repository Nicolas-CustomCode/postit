import { Inject, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  isRecoveryCodeShaped,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_GROUP,
  type TwoFactorSetup,
} from "@repo/shared";
import { decryptSecret, encryptSecret, sha256Hex } from "../common/crypto";
import { isReplay } from "../domain/auth/totp-window";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import { newTotpSecret, otpauthUrl, qrCodeDataUrl, verifyTotp } from "./totp";

/**
 * Verificação em duas etapas (ADR 0013, seção 1).
 *
 * O segredo fica cifrado no banco, com envelope `v1:` — a falha do `hotclone`,
 * que guardava em claro, não se repete aqui.
 */
@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * Primeiro acesso: garante um segredo pendente e devolve o QR.
   *
   * Ainda NÃO ativa as duas etapas: `totpAtivadoEm` só é preenchido quando a
   * pessoa prova que conseguiu cadastrar, digitando um código. Ativar antes
   * trancaria fora quem fechasse a tela no meio.
   *
   * ⚠️ **Chamar de novo reaproveita o segredo pendente, em vez de sortear
   * outro.** Sortear a cada chamada parece mais seguro e é uma armadilha: a tela
   * de cadastro é renderizada mais de uma vez pelo Next (documento e navegação),
   * e o segundo sorteio invalidaria justamente o QR que a pessoa acabou de ler —
   * o código certo aparece como "código incorreto". Segredo pendente nunca
   * chegou a valer para entrar, e o `admin:reset-2fa` apaga tudo quando é
   * preciso recomeçar de fato.
   */
  async beginSetup(userId: string, email: string): Promise<TwoFactorSetup> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecretEncrypted: true, totpEnabledAt: true },
    });

    const pendente =
      user.totpEnabledAt === null && user.totpSecretEncrypted !== null
        ? decryptSecret(user.totpSecretEncrypted, this.config.encryptionKey, "totp-secret")
        : null;

    const secret = pendente ?? newTotpSecret();
    if (pendente === null) {
      await this.prisma.db.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: encryptSecret(secret, this.config.encryptionKey, "totp-secret") },
      });
    }

    const url = otpauthUrl(this.config.totpIssuer, email, secret);
    return { otpauthUrl: url, qrDataUrl: await qrCodeDataUrl(url) };
  }

  /**
   * Confere um código do aplicativo e, de quebra, fecha a porta do reuso.
   *
   * Guardar o passo aceito é o que impede o mesmo código de entrar duas vezes
   * dentro da mesma janela de 30 segundos — olhar por cima do ombro deixa de
   * servir.
   */
  async verifyCode(
    user: { id: string; totpSecretEncrypted: string | null; totpLastStep: bigint | null },
    code: string,
    now: Date,
  ): Promise<boolean> {
    if (user.totpSecretEncrypted === null) return false;

    const secret = decryptSecret(user.totpSecretEncrypted, this.config.encryptionKey, "totp-secret");
    const check = verifyTotp(secret, code, now);
    if (!check.valid || check.step === null) return false;

    const lastStep = user.totpLastStep === null ? null : Number(user.totpLastStep);
    if (isReplay(lastStep, check.step)) return false;

    // updateMany com a condição junto: duas requisições com o mesmo código, ao
    // mesmo tempo, não passam as duas.
    const updated = await this.prisma.db.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(check.step) } }] },
      data: { totpLastStep: BigInt(check.step) },
    });

    return updated.count === 1;
  }

  /** Marca as duas etapas como ativas. Só depois de um código conferido. */
  async activate(userId: string, now: Date): Promise<void> {
    await this.prisma.db.user.update({ where: { id: userId }, data: { totpEnabledAt: now } });
  }

  /**
   * Gera os 10 códigos de recuperação, apaga os anteriores e devolve os novos em
   * claro — a única vez que eles existem fora do hash.
   */
  async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());

    await this.prisma.db.$transaction([
      this.prisma.db.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.db.recoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: sha256Hex(code) })),
      }),
    ]);

    return codes;
  }

  /**
   * Consome um código de recuperação. Uso único, conferido por UPDATE
   * condicional: dois pedidos com o mesmo código só marcam um.
   */
  async consumeRecoveryCode(userId: string, raw: string, now: Date): Promise<boolean> {
    const code = normalizeRecoveryCode(raw);
    if (!isRecoveryCodeShaped(code)) return false;

    const consumed = await this.prisma.db.recoveryCode.updateMany({
      where: { userId, codeHash: sha256Hex(code), usedAt: null },
      data: { usedAt: now },
    });

    return consumed.count === 1;
  }

  /** Apaga segredo e códigos: é o `admin:reset-2fa` (ADR 0013, seção 6). */
  async reset(userId: string): Promise<void> {
    await this.prisma.db.$transaction([
      this.prisma.db.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null },
      }),
      this.prisma.db.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }
}

/** `randomInt` e não `Math.random`: o código de recuperação é uma credencial. */
function randomRecoveryCode(): string {
  const letters = Array.from(
    { length: RECOVERY_CODE_GROUP * 2 },
    () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)] ?? "2",
  ).join("");
  return `${letters.slice(0, RECOVERY_CODE_GROUP)}-${letters.slice(RECOVERY_CODE_GROUP)}`;
}
