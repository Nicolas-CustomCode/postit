# ADR 0025 — Ajustar a imagem ao formato: recortar ou emoldurar, nunca à força

**Data:** 2026-09-22 · **Status:** aceito

## Contexto

A faixa de proporção do feed — 4:5 a 1.91:1 — deixa de fora **a foto mais comum que existe**. Câmera
de celular fotografa em 3:4, e 3:4 é mais alta que 4:5: pela API, `36003 / 2207009`, "aspect ratio not
supported". O acervo aceita a foto (o envio valida só o piso comum, [ADR 0012](0012-upload-direto-minio.md)
e [docs/08](../08-integracao-instagram.md)), e a composição do feed a recusava depois — sem saída
nenhuma além de "mande outra".

**O aplicativo do Instagram aceita a mesma foto** desde maio de 2025, e oferece redimensionar. A API
não acompanhou; o registro do achado, com as fontes e o aviso de que a fonte do lado do aplicativo é
jornalística, está em [docs/08](../08-integracao-instagram.md#o-aplicativo-aceita-34-a-api-não--observado-em-22092026).
O pedido que originou este ADR foi exatamente esse: *"quero deixar a programação de postagens o mais
fiel possível com o app"*.

**A pergunta que precisava ser respondida antes de construir** era do multi-rede: o TikTok entra
depois do MVP ([ADR 0009](0009-preparacao-multi-rede.md)), e um fluxo que não servisse a ele seria
trabalho a refazer.

O que a documentação do TikTok publica para foto é resolução (até 1080p), tamanho (20 MB por imagem),
formatos (JPEG e WebP) e até 35 fotos por publicação
([Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide),
[Photo Post](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post)). **Faixa de
proporção obrigatória, nenhuma das duas páginas traz** — circula um "1/2.2 a 2.2" que não aparece na
especificação de foto e que não vale citar como se fosse.

Sem faixa publicada, o TikTok cairia no mesmo ramo de Stories — `ratio: null`, ajuste simplesmente não
oferecido — e o fluxo se sustenta sem código novo. **Isto é leitura de documentação, não medição**, e
vale reconferir quando a segunda rede for construída de verdade. A conclusão para hoje: seguir, e não
criar eixo de rede antes de a segunda rede existir.

## Decisão

**A imagem que não serve ao formato deixa de ser um beco e passa a ter duas saídas: recortar ou
caber inteira com fundo.** As duas produzem um **arquivo novo**, e a original fica intacta.

### Recortar é oferta, nunca imposição

É a regra 10 do [AGENTS.md](../../AGENTS.md), e ela manda aqui: uma arte 9:16 feita para Stories é
válida como está, e recortá-la para 4:5 sem perguntar destruiria o formato pretendido. O ajuste só
acontece quando a pessoa pede, e **quem pede diz para qual formato**.

Por isso `fitFrame` e `targetRatioFor` recebem o `ImageSpec` do formato escolhido, e não uma constante:
recortar contra a faixa do feed uma imagem que ia para Stories é o defeito que a assinatura impede.

### Emoldurar é invenção nossa

O Instagram recorta e não põe borda. "Imagem inteira com faixas brancas" não existe no aplicativo —
quem quer a arte inteira hoje usa um app de borda antes de postar. Entra porque é a única saída que
**não perde pixel**, e a tela diz o que cada uma faz antes de a pessoa escolher.

**Branco fixo, sem desfoque.** O arquivo vai para o Instagram: o tema do aparelho de quem publica não
tem nada a ver com o resultado. Desfoque está fora por dois motivos — o [13](../13-telas-e-navegacao.md)
proíbe efeito, e `ctx.filter` tem suporte irregular no Safari, que é onde o PWA precisa rodar.

### O ajuste acontece no navegador

Três razões: o arquivo que sai é exatamente o que a pessoa viu na prévia; a API não precisa de
biblioteca de processamento de imagem, que seria a maior dependência do projeto; e o navegador **já
aplica a orientação EXIF** ao decodificar, então a foto deitada some na origem em vez de virar caso
especial.

### A ajustada é derivada, e some do acervo

Uma coluna `derivadaDeId` em `Midia`, chave estrangeira para a própria tabela, `ON DELETE SET NULL`.
A listagem do acervo filtra por `derivadaDeId IS NULL`.

**Chave estrangeira e não booleano** porque custa o mesmo e responde a pergunta que alguém vai fazer
olhando dois arquivos parecidos: de onde isto veio? **`SET NULL` e não `RESTRICT`** porque a derivada
pode estar numa postagem agendada, e apagar a original não pode impedir a publicação; a consequência
aceita é que, sem original, ela volta a aparecer no acervo — o que é verdade, deixou de ser variante
de alguma coisa.

⚠️ **Guardar "para que formato a imagem foi feita" seria a violação**, e é a tentação que vai
aparecer. Origem é fato, da mesma família de `bytes` e `hashSha256`; formato de destino é decisão de
uma postagem, e mora na postagem.

**A origem viaja dentro do comprovante assinado**, não numa chamada depois. O comprovante já é HMAC,
então o cliente não forja nada, e a `Midia` nasce marcada na mesma `create`. Confirmar e depois marcar
abriria uma janela — curta — em que a derivada aparece no acervo, o tipo de coisa que vira "às vezes
duplica".

### Onde a tela oferece

| Onde | Quando aparece | O que a ajustada faz |
|---|---|---|
| Seletor do acervo, na composição | A imagem não serve ao formato escolhido | **Acrescenta** à postagem |
| Tarja da faixa de mídia | A imagem anexada deixou de servir — trocou-se o formato | **Substitui** naquela posição |
| Confirmação do envio | O arquivo escolhido não serve | Vira o que sobe; o original **não** sobe |

A diferença entre acrescentar e substituir não é detalhe: quem trocou de formato quer a mesma imagem
consertada no mesmo lugar, não uma segunda cópia no fim do carrossel.

⚠️ **No envio, a ajustada não é derivada de nada** — o original nunca subiu. Marcá-la a faria sumir da
grade e parecer envio perdido.

## Consequências

- **O acervo continua aceitando o que não serve ao feed**, e agora isso deixou de ser um beco. A
  política do [ADR 0012](0012-upload-direto-minio.md) não muda.
- **Uma foto usada em dois formatos ocupa três objetos** — a original e duas variantes. É o preço de a
  Meta publicar baixando de uma URL: o recorte precisa existir como arquivo.
- **O acervo não mostra as variantes**, então a pessoa não vê o custo. Se um dia isso incomodar, a
  coluna já permite listá-las sob a original, e apagar órfãs.
- **A largura da moldura para em 1440 px** (`FIT_MAX_WIDTH`). Não é validação — a Meta redimensiona
  sozinha acima disso e nunca recusa por largura (docs/08). É que emoldurar é a **única operação que
  aumenta** a imagem, e sem o teto um panorama grande viraria um JPEG acima dos 8 MB da própria
  política de envio.
- **O ajuste não roda nos testes automáticos.** O canvas precisa dos pixels de verdade, e a mídia
  semeada no e2e não tem objeto no MinIO. O Playwright prova a navegação — que a porta aparece, que
  abre a folha certa e que não se perde o que já estava escolhido —, e recortar e enviar fica no
  roteiro manual, como o envio (V-15).
- **Nada disto cria eixo de rede.** Quando o TikTok chegar, ele traz o seu `ImageSpec`; se vier sem
  faixa obrigatória, como a documentação de hoje indica, o ajuste simplesmente não é oferecido, do
  mesmo jeito que não é em Stories. `media-crop.ts` já opera sobre `ImageSpec`, não sobre constantes
  do Instagram.

## Alternativas descartadas

**Recortar sozinho, como o aplicativo faz.** Quebra a regra 10 e destrói arte de Stories sem
perguntar. O aplicativo pode fazer isso porque pergunta na hora, com a foto na tela; aqui a imagem
entra no acervo hoje e vira postagem semana que vem.

**Ajustar na API, com biblioteca de imagem.** Seria a maior dependência do projeto, e o arquivo que
sai deixaria de ser exatamente o que a pessoa viu — a prévia passaria a ser uma promessa em vez de o
resultado.

**Substituir a original pela ajustada.** Quem usa a mesma foto no feed e no Stories precisa das duas
versões, e a original é a única que serve para gerar a terceira.

**Guardar a variante como coluna na `Postagem`, sem virar `Midia`.** A Meta publica baixando de uma
URL pública: o recorte precisa ser um objeto no armazenamento de qualquer jeito, e um objeto sem linha
em `Midia` seria o defeito que o `confirmUpload` existe para evitar, ao contrário.
