/**
 * O endereço público de um objeto do armazenamento.
 *
 * **Montado na leitura, nunca guardado no banco**, porque ele muda junto com o
 * domínio de mídia — no computador local é o endereço do túnel, que troca a cada
 * `npm run tunnel`. Guardá-lo deixaria toda foto quebrada no dia seguinte. O
 * bucket entra no caminho pela mesma razão: é infraestrutura, não dado.
 *
 * Mora aqui, e não dentro de um serviço, porque a foto de perfil da conta e a
 * mídia da postagem precisam montar **o mesmo** endereço. Duas cópias que
 * divergissem dariam uma imagem quebrada só numa das telas — o tipo de defeito
 * que ninguém reproduz.
 *
 * ⚠️ Quem precisa disto **não importa o módulo do vizinho** para reaproveitar:
 * `forEnv` devolve um módulo novo a cada chamada, e o Fastify recusa a rota
 * duplicada. Cada módulo tem a sua config e chama esta função.
 */
export function publicUrlFor(objectKey: string, config: { publicUrl: string; bucket: string }): string {
  return `${config.publicUrl.replace(/\/$/, "")}/${config.bucket}/${objectKey}`;
}
