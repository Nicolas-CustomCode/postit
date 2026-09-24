# ADR 0028 — MinIO pela build da comunidade (pgsty), com versão fixa

**Data:** 2026-09-24 · **Status:** aceito

## Contexto

O armazenamento de mídia é o MinIO desde o começo ([ADR 0012](0012-upload-direto-minio.md)): envio direto do
navegador com política assinada, `recebidos/` e `publicas/`, leitura anônima só em `publicas/` e o ciclo de vida
que apaga os envios abandonados.

Em 24/09/2026 a CI quebrou num passo que nada tinha mudado: **o pull de `quay.io/minio/minio` passou a responder
401**. Conferido na mesma hora, sem login:

- `minio/minio` e `minio/mc` no Docker Hub: "pull access denied" — as imagens foram apagadas em 11/09/2026;
- `quay.io/minio/minio` e `quay.io/minio/mc`, inclusive versões fixas antigas: 401;
- `bitnami/minio`: indisponível.

É o fim de um recuo de um ano: a MinIO parou de publicar imagens e binários gratuitos em outubro de 2025 e arquivou
o repositório aberto em fevereiro de 2026, empurrando para o produto comercial, o AIStor
([flowershow#1382](https://github.com/flowershow/flowershow/issues/1382), com a linha do tempo). O desenvolvimento
local só continuava funcionando porque as imagens estavam no cache da máquina, de 12 meses antes. **Uma máquina
nova, a CI e a estreia no Easypanel quebrariam.**

## Decisão

**`pgsty/minio` e `pgsty/mc`, com versão fixa** (`RELEASE.…`, nunca `latest`), no `docker-compose.yml`, na CI e
na produção (docs/10).

O `pgsty/minio` é um fork do MinIO aberto, mantido pelo projeto Pigsty, sob a mesma AGPL: compila as versões,
publica as imagens e aplica as correções de segurança que a MinIO passou a lançar só no AIStor
([releases](https://github.com/pgsty/minio/releases)). É o mesmo binário, com os mesmos comandos:

- a imagem do servidor traz o `mc`, e o healthcheck do compose (`mc ready local`) continua valendo;
- a do `mc` tem terminal, e o `media-init` e o passo da CI, que rodam `sh -c "mc …"`, não mudam;
- o volume de dados é o mesmo formato: o MinIO de desenvolvimento subiu na imagem nova com os dados que já tinha.

A troca de versão é deliberada: subir a tag no compose, na CI e no docs/10 **juntos**, e rodar a suíte de mídia.

## Alternativas descartadas

**AIStor Free, da própria MinIO.** Viável: licença sem vencimento, uso comercial permitido em servidor único, e o
PostIt só usa o que ele também tem. Descartado por três motivos:

- o arquivo de licença entra nos três ambientes (local, CI e Easypanel) como segredo, e sem ele o servidor sobe e
  bloqueia toda operação S3 ([licenças](https://docs.min.io/aistor/operations/licenses/));
- é proprietário, e o contrato reserva à MinIO mudar o software a qualquer momento — o mesmo fornecedor que acaba
  de tirar as imagens gratuitas do ar ([contrato do Free](https://www.min.io/legal/aistor-free-agreement));
- a documentação só mostra `latest`, e o `mc` não vem como imagem.

**Imagens `chainguard/minio`.** Sem terminal, o que quebra o `media-init` e o passo da CI como estão escritos, e a
camada gratuita só oferece `latest`, sem versão fixa.

**Trocar de armazenamento** (SeaweedFS, Garage, outro S3). O [ADR 0012](0012-upload-direto-minio.md) depende da
política assinada de envio e das regras de ciclo de vida do `mc`: seria reescrever o envio para resolver um problema
de distribuição de imagem, não de software.

## Consequências

- **O risco muda de lugar, não some**: depende de um mantenedor da comunidade em vez da empresa. Se o `pgsty` parar,
  a saída continua aberta — o código é AGPL, dá para compilar ou passar a outro fork, e o AIStor lê o mesmo formato
  de dados.
- **Correção de segurança não chega sozinha**: com a versão fixa, alguém precisa olhar as releases do `pgsty/minio`
  de tempos em tempos. O Dependabot não acompanha imagem de `docker run` na CI.
- **Produção**: o App `minio` do Easypanel usa a mesma imagem e a mesma tag do compose (docs/10).
