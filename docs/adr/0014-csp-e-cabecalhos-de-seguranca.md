# ADR 0014 — CSP com nonce e cabeçalhos de segurança

**Data:** 2026-09-14 · **Status:** aceito · **Complementado por:** [ADR 0017](0017-pwa-e-notificacoes-push.md) e [ADR 0020](0020-easypanel-na-validacao.md)

> O ADR 0017 acrescenta `worker-src 'self'` e `manifest-src 'self'` à CSP, para o service worker e o
> manifesto do app instalável.
>
> O ADR 0020 muda **onde** ficam os cabeçalhos da seção 3: passam a ser gerados pelo **próprio Next**
> (`next.config`), para valerem igual com o Traefik do Easypanel e com o Apache. Os valores continuam os mesmos.
> Na etapa 2, o Apache pode repeti-los, cobrindo também as páginas de erro dele. Os cabeçalhos do domínio de mídia
> (seção 4) dependem do proxy: no Traefik, a confirmar (item V-22).

## Contexto

A documentação não definia **nenhuma CSP** nem os cabeçalhos de segurança das páginas. Sem isso, o
navegador executa qualquer script que conseguir entrar numa página — por exemplo, escondido numa legenda
maliciosa que a tela exiba sem tratamento. É o ataque chamado XSS, o mais comum em aplicações web.

A CSP (*Content Security Policy*) é uma lista que o site envia ao navegador dizendo de onde a página pode
carregar scripts, estilos, imagens, e para onde pode enviar dados. O que não estiver na lista, o navegador
recusa.

O `nossobuncker` já tem CSP com nonce e os cabeçalhos no proxy, e foi a referência.

## Decisão

### 1. CSP nas páginas do Next, com nonce

A cada carregamento de página, o `proxy.ts` do Next sorteia um número — o **nonce** — e o coloca na CSP.
O Next marca os próprios scripts com esse número. Um script injetado por um atacante não conhece o número
daquele carregamento, e o navegador se recusa a executá-lo.

Política, montada em `apps/web/lib/security/csp.ts`:

| Diretiva | Valor | Por quê |
|---|---|---|
| `default-src` | `'self'` | Tudo que não for especificado abaixo, só do próprio site |
| `script-src` | `'self' 'nonce-…'` | Só scripts do próprio site e marcados com o nonce. Em desenvolvimento, mais `'unsafe-eval'`, que o React usa para mostrar erros |
| `style-src` | `'self' 'nonce-…'` | Estilos do próprio site. Em desenvolvimento, mais `'unsafe-inline'` |
| `style-src-attr` | `'unsafe-inline'` | Componentes de menu e popover do shadcn/ui posicionam elementos com o atributo `style`. Estilo não executa código |
| `img-src` | `'self' data: blob:` + domínio de mídia | Miniaturas e prévias vêm do MinIO; `blob:` para a prévia antes do envio |
| `media-src` | `'self' blob:` + domínio de mídia | Prévia de vídeos |
| `connect-src` | `'self'` + domínio de mídia | O envio de arquivo vai direto ao MinIO ([ADR 0012](0012-upload-direto-minio.md)) |
| `font-src` | `'self'` | Fontes servidas pelo próprio app |
| `object-src` | `'none'` | Nada de plugins antigos |
| `base-uri` | `'self'` | Impede que um código injetado mude o endereço base dos links |
| `form-action` | `'self'` | Formulários só enviam para o próprio site |
| `frame-ancestors` | `'none'` | Nenhum site pode embutir o PostIt — contra *clickjacking* |
| `upgrade-insecure-requests` | só com `APP_URL` https | Força https em qualquer recurso |

O domínio de mídia é lido de `MINIO_PUBLIC_URL` no boot.

**Sem `'strict-dynamic'`** e **sem endereço de relatório**, como no `nossobuncker`. Relatórios de violação
exigiriam uma rota pública para recebê-los — pode entrar depois.

**Efeito colateral aceito:** com nonce por requisição, as páginas deixam de ser pré-geradas e passam a ser
montadas a cada acesso. Irrelevante numa ferramenta interna.

### 2. Nada de recursos da Meta nas páginas

A foto de perfil das contas do Instagram **é copiada para o MinIO** quando a conta é conectada e quando o
token é renovado. As telas nunca carregam imagens dos servidores da Meta.

- A CSP não precisa liberar domínios de terceiros
- O navegador do usuário não conversa com a Meta a cada vez que abre a tela de contas
- A imagem não some quando o endereço fornecido pela Meta deixar de valer

### 3. Cabeçalhos no proxy reverso

Aplicados com `always` — ou seja, também em respostas de erro — no domínio do app:

| Cabeçalho | Valor | Protege contra |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Acesso por http sem criptografia depois da primeira visita |
| `X-Content-Type-Options` | `nosniff` | Navegador "adivinhar" que um arquivo é script |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Vazar endereços internos do app para outros sites |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | Código injetado pedir acesso a câmera, microfone, localização |
| `X-Frame-Options` | `DENY` | *Clickjacking* em navegadores antigos, que não entendem `frame-ancestors` |

**Sem `preload` no HSTS.** O `preload` coloca o domínio numa lista embutida nos navegadores, e sair dela
leva meses. Só vale quando houver certeza de que todo subdomínio terá https para sempre.

### 4. Domínio de mídia

| Cabeçalho | Valor | Por quê |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; sandbox` | Se algum arquivo indevido passar pela validação, o navegador não executa nada dele |
| `X-Content-Type-Options` | `nosniff` | O arquivo é tratado como o tipo declarado, nunca como script |
| `Strict-Transport-Security` | `max-age=31536000` | Só https |
| CORS | origem `https://app.dominio`, método POST, sem credenciais | Só o app envia arquivos |

Esses cabeçalhos não afetam a Meta: ela só baixa o arquivo.

### 5. API

`@fastify/helmet` com CSP `default-src 'none'; frame-ancestors 'none'`, padrão do `hotclone`. A API nunca
serve páginas; a política restritiva garante que, mesmo por engano, nada dela seja interpretado como
página.

## Consequências

### Positivas

- Um script injetado não roda
- O app não pode ser embutido em outro site
- Arquivos da mídia não viram vetor de ataque
- Nenhum recurso de terceiro nas páginas

### Negativas

- **Toda biblioteca nova que carregar recurso externo quebra até a CSP ser ajustada.** É o
  comportamento desejado, mas exige atenção
- Páginas montadas a cada acesso
- Mais uma cópia de imagem no MinIO por conta conectada

## Alternativas consideradas

**CSP fixa sem nonce, com `'unsafe-inline'`**, como no `alivio-crm`. Mais simples, mas `'unsafe-inline'`
em script anula a principal proteção contra XSS.

**Cabeçalhos no `next.config`.** Funciona, mas só cobre respostas do Next. No proxy, valem também para
páginas de erro do próprio proxy.

**Liberar o CDN da Meta na CSP.** Mais simples que copiar a foto, mas abre a política para domínios de
terceiros e faz o navegador do usuário conversar com a Meta.

## Reversibilidade

**Alta.** A CSP fica num arquivo; os cabeçalhos, na configuração versionada do proxy.
