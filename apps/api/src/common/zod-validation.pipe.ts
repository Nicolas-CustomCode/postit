import { Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { ValidationFailedError } from "./errors";

/**
 * Valida o corpo com o schema de @repo/shared — o MESMO que a Server Action do
 * Next usa. Duas validações separadas divergem, e a divergência aparece como
 * "o formulário aceitou e a API recusou".
 *
 * Uso: `@Body(new ZodValidationPipe(loginSchema)) body: LoginInput`.
 *
 * ⚠️ O erro leva só o CAMINHO do campo, nunca o valor: o corpo do login tem a
 * senha dentro (AGENTS.md, regra 3).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "corpo"))];
    throw new ValidationFailedError(fields);
  }
}
