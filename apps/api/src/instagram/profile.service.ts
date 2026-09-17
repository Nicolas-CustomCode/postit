import { Injectable } from "@nestjs/common";
import { AccountNotProfessionalError, InstagramUnavailableError } from "../common/errors";
import { InstagramClient } from "./client";
import { translateRefusal, type RefusalOrigin } from "./errors";

/**
 * Leitura do perfil da conta conectada (docs/08, "Dados do perfil").
 *
 * Os nomes dos campos são os que a Meta define — `account_type`,
 * `profile_picture_url`, `followers_count` — e ficam como ela os escreve
 * (AGENTS.md, "As exceções").
 */
const FIELDS = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";

/** Os dois tipos que o Instagram Login aceita. Conta pessoal não entra. */
const PROFESSIONAL = new Set(["BUSINESS", "MEDIA_CREATOR"]);

export interface InstagramProfile {
  /** O id que a Meta usa para esta conta — vai para `Conta.idExterno`. */
  readonly externalId: string;
  readonly username: string;
  readonly name: string | null;
  readonly photoUrl: string | null;
  readonly followersCount: number | null;
  readonly followsCount: number | null;
  readonly mediaCount: number | null;
}

interface MeResponse {
  readonly id?: string;
  readonly user_id?: string;
  readonly username?: string;
  readonly name?: string;
  readonly account_type?: string;
  readonly profile_picture_url?: string;
  readonly followers_count?: number;
  readonly follows_count?: number;
  readonly media_count?: number;
}

@Injectable()
export class InstagramProfileService {
  constructor(private readonly client: InstagramClient) {}

  async read(token: string, origin: RefusalOrigin): Promise<InstagramProfile> {
    let dados: MeResponse;

    try {
      dados = await this.client.get<MeResponse>("/me", token, { fields: FIELDS });
    } catch (error) {
      throw translateRefusal(error, origin);
    }

    // `account_type` só vem quando a conta é profissional o bastante para
    // tê-lo; ausente, não concluímos nada — a autorização já teria falhado.
    if (dados.account_type !== undefined && !PROFESSIONAL.has(dados.account_type)) {
      throw new AccountNotProfessionalError();
    }

    const externalId = dados.user_id ?? dados.id;
    if (externalId === undefined || dados.username === undefined) throw new InstagramUnavailableError();

    return {
      externalId,
      username: dados.username,
      name: dados.name ?? null,
      photoUrl: dados.profile_picture_url ?? null,
      followersCount: dados.followers_count ?? null,
      followsCount: dados.follows_count ?? null,
      mediaCount: dados.media_count ?? null,
    };
  }
}

