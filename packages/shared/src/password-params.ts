/**
 * Parâmetros do argon2id.
 *
 * Ficam aqui, e não na API, porque os comandos admin:* e qualquer script que
 * gere senha precisam usar os MESMOS números (ADR 0013, seção 7). Parâmetros
 * diferentes não quebram nada de imediato — o custo viaja dentro do hash, e o
 * `verify` continua funcionando —, então metade da base ficaria com senha mais
 * barata do que a política manda, sem nenhum sintoma.
 *
 * Só os números viajam neste pacote: a biblioteca `argon2` é um módulo nativo, e
 * este pacote é importado também pelo Next.
 *
 * Valores: os recomendados pelo OWASP para argon2id (19 MiB, 2 passagens).
 */
export const ARGON2ID_PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
