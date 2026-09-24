# ADR 0027 — Converter e reduzir a imagem no navegador, antes do envio

**Data:** 2026-09-24 · **Status:** aceito

## Contexto

A Meta publica imagem só em **JPEG de até 8 MB** ([docs/08](../08-integracao-instagram.md)), e o envio
recusava o resto com "converta a imagem e tente de novo". Na prática, era a recusa mais comum: print de
tela é PNG, arte exportada de programa de design costuma ser PNG ou WebP, e foto de câmera passa dos 8 MB.
A saída era abrir outro programa, converter e voltar.

O RF-B06 ("normalizar mídia") estava em **Depois**, com imagem e vídeo juntos. Em 24/09/2026 o usuário
decidiu antecipar a **metade das imagens**, antes do sino da Fase 1d: ela é barata, porque o ajuste ao
formato ([ADR 0025](0025-ajustar-imagem-ao-formato.md)) já decodifica e codifica JPEG no navegador. Vídeo
continua em Depois — recodificar vídeo no navegador é outro problema.

## Decisão

**A tela converte e reduz antes de enviar, e a API não muda.**

### No navegador, pelas mesmas razões do ADR 0025

- **O arquivo que sobe é exatamente o que a prévia mostra.**
- **A API segue sem biblioteca de imagem.** `sharp` continua descartado ([docs/06](../06-stack.md)).
- **O navegador aplica a orientação EXIF ao decodificar.**

A regra é pura e mora em `packages/shared/src/image-normalize.ts`. Quem desenha é
`apps/web/lib/media/normalize-image.ts`.

### O que acontece com cada arquivo

| Arquivo escolhido | O que a tela faz |
|---|---|
| JPEG de até 8 MB | **Nada.** Sobe intocado, qualquer que seja o tamanho em pixels |
| PNG, WebP, AVIF | Converte para JPEG, com **fundo branco** onde havia transparência |
| JPEG acima de 8 MB | Recodifica |
| Qualquer recodificação | O lado maior fica em até **2160 px**, com a proporção preservada |
| HEIC | Recusa, com o caminho: no iPhone, a galeria já entrega JPEG |
| GIF | Recusa: o Instagram publicaria só o primeiro quadro, sem avisar |
| Acima de 50 MB ou de 50 megapixels | Recusa: decodificar derruba a aba no celular |

A confirmação diz o que mudou, com as medidas de antes e de depois. Nada muda sem a pessoa ver.

### Por que cada escolha

**O tipo sai dos bytes, não do `file.type`.** Um PNG chamado `foto.jpg` chega ao navegador como
`image/jpeg`. Pelo tipo declarado, ele passaria pela tela e seria recusado só pela API, depois do envio.

**JPEG válido fica intocado.** Recodificar sem necessidade só perde qualidade, e a Meta reduz sozinha
acima de 1440 px de largura.

**2160 px no lado maior.** A Meta publica até 1440 px de largura. O que sobra é folga para recortar
depois sem cair abaixo disso. Em qualidade 0,92, o arquivo sai com 1 a 3 MB, longe dos 8.

**HEIC fica fora.** Só o Safari o decodifica. No iPhone, o próprio Safari converte a foto da galeria
para JPEG quando o `accept` do seletor não lista HEIC. Por isso o `accept` lista só JPEG, PNG, WebP e
AVIF.

### A API continua sendo a barreira

`validateImageUpload`, a política assinada do armazenamento e a checagem dos bytes na API ficam como
estavam, e os testes deles também. A conversão é conveniência da tela. Quem decide é a API (AGENTS.md,
regras 10 e 17), e o que chegar sem passar pela tela é recusado como antes.

## Consequências

- **Os testes 3 e 4 do roteiro da Fase 1 mudaram de sinal** ([docs/12](../12-roadmap.md)). PNG e JPEG
  pesado são aceitos, com aviso. A recusa continua coberta, na API.
- **A imagem convertida não é byte a byte a escolhida.** É o mesmo custo que a Meta já impunha ao
  reduzir por conta própria. A diferença é que agora a pessoa vê o resultado antes.
- **O PNG com transparência ganha fundo branco.** É a mesma escolha da moldura do ADR 0025, e pela
  mesma razão: o arquivo vai para o Instagram, e o tema do aparelho não tem nada a ver com ele.
- **A conversão fica fora do teste automático só na metade do celular.** O e2e converte e reduz de
  verdade no Chromium, com o PNG que o próprio teste gera. O Safari do iPhone e a memória de um
  aparelho de verdade ficam no roteiro manual.

## Alternativas descartadas

**Converter na API, com `sharp`.** Seria a maior dependência do projeto, com binário nativo por
plataforma. O arquivo também deixaria de ser o que a pessoa viu.

**Reduzir todo JPEG grande em pixels, mesmo abaixo de 8 MB.** Perde qualidade sem necessidade, e a Meta
já faz isso ao publicar.

**Aceitar HEIC decodificando com biblioteca em JavaScript.** Seriam megabytes de código, carregados por
todo mundo, para um caso que o iPhone já resolve sozinho.
