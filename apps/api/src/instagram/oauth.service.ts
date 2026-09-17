import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConnectionInvalidError, InstagramUnavailableError } from "../common/errors";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "./instagram.config";
import { InstagramClient } from "./client";
import { translateRefusal } from "./profile.service";

/**
 * O fluxo de autorização do Instagram Login (docs/08, "Fluxo de autorização").
 *
 * Só existe no processo HTTP: o worker renova token, mas nunca autoriza nada.
 */

/** Os três escopos do projeto, e nenhum a mais (docs/08, "Escopos que o projeto usa"). */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const;

/**
 * Ficam no código, não em variável de ambiente, de propósito: mudar a lista
 * obriga **toda conta conectada a autorizar de novo**. Isso é mudança de código
 * com aviso na tela, não ajuste de operação.
 *
 * ⚠️ Grafia: `instagram_business_content_publish`, sem `ing`. A Meta escreve das
 * duas formas na documentação dela, e a errada falha na autorização (docs/08).
 */

/** Dez minutos: o tempo de autorizar, não o de deixar a aba aberta o dia todo. */
const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class InstagramOAuthService {
  private readonly logger = new Logger("Instagram");

  constructor(
    @Inject(INSTAGRAM_CONFIG) private readonly config: InstagramConfig,
    private readonly client: InstagramClient,
  ) {}

  /**
   * Para onde mandar a pessoa, e o `state` que amarra a volta a ela.
   *
   * O `state` leva HMAC, prazo e o id de quem começou. Sem assinatura, qualquer
   * um forja um retorno; sem o id, alguém conclui no seu PostIt uma conexão que
   * outra pessoa começou.
   */
  authorizationUrl(userId: string, now: Date): string {
    const url = new URL(`${this.config.authUrl}/oauth/authorize`);
    url.searchParams.set("client_id", this.requireAppId());
    url.searchParams.set("redirect_uri", this.requireRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
    url.searchParams.set("state", this.signState(userId, now));

    return url.toString();
  }

  /**
   * Confere o `state` da volta.
   *
   * Prazo vencido, assinatura errada, formato estranho e `state` de outra pessoa
   * levantam **o mesmo erro**, de propósito: distinguir os casos diria a quem
   * forja um retorno exatamente o que ele acertou.
   */
  verifyState(state: string, userId: string, now: Date): void {
    const partes = state.split(".");
    if (partes.length !== 2) throw new ConnectionInvalidError();

    const [corpo, assinatura] = partes as [string, string];
    if (!this.signatureMatches(corpo, assinatura)) throw new ConnectionInvalidError();

    let dados: { u?: unknown; e?: unknown };
    try {
      dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as typeof dados;
    } catch {
      throw new ConnectionInvalidError();
    }

    if (dados.u !== userId) throw new ConnectionInvalidError();
    if (typeof dados.e !== "number" || dados.e < now.getTime()) throw new ConnectionInvalidError();
  }

  /**
   * Do código da autorização ao token de 60 dias, em dois saltos (docs/08).
   *
   * O token curto some aqui dentro: quem chama recebe só o longo, que é o que
   * vai cifrado para o banco.
   */
  async redeem(code: string): Promise<{ token: string; expiresInSeconds: number }> {
    try {
      const curto = await this.client.exchangeCode(code, this.requireRedirectUri());
      const longo = await this.client.exchangeForLongLived(curto.access_token);

      return { token: longo.access_token, expiresInSeconds: longo.expires_in };
    } catch (error) {
      // Sem isto, uma recusa da Meta aqui sobe como erro desconhecido e vira 500
      // na tela — em vez da frase que diz o que fazer.
      throw translateRefusal(error);
    }
  }

  private signState(userId: string, now: Date): string {
    // O nonce não é conferido na volta — não há onde guardar um `state` usado sem
    // uma tabela. Ele existe para dois pedidos seguidos do mesmo usuário no mesmo
    // milissegundo não gerarem o mesmo texto.
    const corpo = Buffer.from(
      JSON.stringify({ u: userId, e: now.getTime() + STATE_TTL_MS, n: randomBytes(8).toString("base64url") }),
      "utf8",
    ).toString("base64url");

    return `${corpo}.${this.sign(corpo)}`;
  }

  private sign(corpo: string): string {
    return createHmac("sha256", this.requireStateSecret()).update(corpo).digest("base64url");
  }

  /** Comparação de tempo constante: comparar com `===` vaza a assinatura por tempo. */
  private signatureMatches(corpo: string, recebida: string): boolean {
    const esperada = Buffer.from(this.sign(corpo), "utf8");
    const dada = Buffer.from(recebida, "utf8");

    return esperada.length === dada.length && timingSafeEqual(esperada, dada);
  }

  /**
   * Variável faltando não é a Meta fora do ar.
   *
   * A pessoa continua vendo "o Instagram não respondeu" — não há o que ela faça
   * a respeito, e o vocabulário de erro é fechado. Mas quem está desenvolvendo
   * vê no log **qual variável** falta, em vez de procurar problema de rede que
   * não existe. Sem isto, `.env` vazio e Meta fora do ar são indistinguíveis.
   */
  private required<T>(valor: T | null, variavel: string): T {
    if (valor === null) {
      this.logger.error(`${variavel} não está configurada — a conexão com o Instagram não pode começar.`);
      throw new InstagramUnavailableError();
    }
    return valor;
  }

  private requireAppId(): string {
    return this.required(this.config.appId, "IG_APP_ID");
  }

  private requireRedirectUri(): string {
    return this.required(this.config.redirectUri, "IG_REDIRECT_URI");
  }

  private requireStateSecret(): Buffer {
    return this.required(this.config.stateSecret, "STATE_SECRET");
  }
}
