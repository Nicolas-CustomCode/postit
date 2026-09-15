# ADR 0005 — MinIO com bucket público para a mídia

**Data:** 2026-09-09 · **Status:** aceito · **Complementado por:** [ADR 0012](0012-upload-direto-minio.md)

> O ADR 0012 acrescenta como o arquivo chega ao MinIO — direto do navegador, num prefixo privado — e
> estabelece que só arquivos validados vão para o prefixo público. A decisão abaixo continua valendo.

## Contexto

A API da Meta **não aceita o arquivo na requisição**. Ela recebe uma URL e os servidores dela vão
buscar o arquivo:

> *"We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible
> server at the time of the attempt."*

Isso não é preferência de projeto — é como a API funciona. O arquivo precisa estar acessível
publicamente, sem autenticação, no instante da publicação.

## Decisão

**MinIO em Docker**, servido por um nome público dedicado atrás do proxy reverso. Objetos com nome
contendo identificador aleatório de 128 bits. Listagem do bucket desabilitada. Somente GET, somente
no prefixo de publicação.

## Consequências

### Positivas

- Compatível com S3: migrar para S3 ou Cloudflare R2 vira troca de variável de ambiente
- Roda ao lado do resto, sem custo de banda entre serviços nem credencial de terceiro
- Ciclo de vida de objeto nativo, o que viabiliza a retenção do RNF-12
- Já é o seu padrão em `nossobuncker`

### Negativas — e a principal é incontornável

- **Todo conteúdo agendado fica acessível a quem souber a URL**, inclusive o que ainda não foi ao
  ar. Para campanha com data marcada, é exposição real
- A proteção é a **imprevisibilidade da URL**, não controle de acesso
- Mais um serviço para operar e incluir no backup
- Disco cresce rápido com vídeo. Um Reels de 300 MB por dia são 9 GB por mês

## Alternativas consideradas

**URL assinada com prazo curto.** A solução aparentemente óbvia. Rejeitada porque depende de a Meta
baixar dentro da validade — e o container vive 24 horas, com o download podendo acontecer a qualquer
momento até a publicação. Prazo curto criaria falha intermitente e difícil de diagnosticar. Um prazo
maior que 24 horas funcionaria, mas reduz tão pouco o risco que não justifica a complexidade.

**Lista de permissão por IP da Meta.** Impossível: a Meta não publica as faixas de IP que usa para
buscar mídia.

**Arquivos no disco com o proxy servindo.** Mais simples, mas sem ciclo de vida de objeto — a
política de retenção viraria script artesanal, e a migração futura seria manual.

**Cloudflare R2.** Zero manutenção e banda de saída gratuita. Fica como saída de emergência, não
como ponto de partida: adiciona dependência externa a uma ferramenta que se propõe autocontida.

## Honestidade obrigatória

O modelo de proteção é a imprevisibilidade da URL. Isso precisa estar claro para quem usa a
ferramenta, e está em [11 — O bucket público](../11-seguranca.md#o-bucket-de-mídia).

## Reversibilidade

**Alta** para trocar de armazenamento, por causa da compatibilidade com S3. **Nula** para deixar de
ser público — é exigência da API.
