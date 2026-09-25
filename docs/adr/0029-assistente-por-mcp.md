# ADR 0029 — O assistente compõe rascunhos por MCP, com OAuth, e uma pessoa valida

**Data:** 2026-09-25 · **Status:** aceito — a construir na parte 1f ([12](../12-roadmap.md))

## Contexto

Compor uma postagem é a parte que mais toma tempo de quem usa o PostIt: legenda, hashtags, texto alternativo de
cada foto, escolher as imagens. Um assistente de IA faz bem esse rascunho — e o usuário quer usá-lo **de dentro do
ChatGPT**, conversando, sem copiar e colar entre as duas telas.

O caminho padrão para isso é um servidor **MCP** (Model Context Protocol): o PostIt expõe ferramentas — "listar o
acervo", "criar rascunho" —, e o assistente as chama em nome de quem está conversando.

**Três coisas do projeto esbarram nisso**, e é por elas que existe este ADR:

- **A API não tem nome público** (AGENTS.md, regra 4; [ADR 0010](0010-monorepo-next-nest-bff.md), "o Next é o único
  cliente da API"). O ChatGPT precisa de um endereço na internet.
- **Nenhuma escrita no Next fora de Server Action** (regra 13). O MCP e o OAuth são pedidos `POST` de máquina, sem
  formulário nem cookie.
- **Nenhum acesso sem as duas etapas** (regra 11). O ChatGPT não digita código: alguém precisa autorizá-lo.

**O que o ChatGPT exige** (pesquisado em 25/09/2026; detalhes e fontes em [16](../16-assistente-mcp.md)): MCP remoto
por HTTP e autenticação **OAuth** — descoberta pelos endereços `/.well-known`, PKCE, e o cliente se apresentando por
documento de metadados (CIMD) ou registro dinâmico. Token fixo colado à mão não é aceito para conectores.

## Decisão

### 1. O assistente só compõe

As ferramentas criam e editam **rascunhos**, e mais nada: nenhuma envia para revisão, aprova, agenda, publica,
descarta ou mexe em conta. A validação humana **é o fluxo que já existe** — a pessoa abre o rascunho na tela, confere
e segue ([ADR 0026](0026-postagem-em-duas-etapas.md)).

É também a defesa contra *prompt injection*: um assistente enganado por um texto malicioso consegue, no pior caso,
escrever um rascunho ruim — que ninguém publica sem ler.

**O assistente edita só os rascunhos que ele mesmo criou**, e só os da pessoa dona do acesso. O rascunho composto na
tela é de quem o compôs.

### 2. O rascunho diz de onde veio

`Postagem.origem` (`TELA | ASSISTENTE`). A tela mostra **"Composta pelo assistente"** na lista e na composição. O
autor é a pessoa dona do acesso — a autoaprovação vale igual ([ADR 0015](0015-super-admin-e-permissoes.md)). Criar
rascunho pelo assistente **não gera aviso no sino**: quem pediu é a própria pessoa, conversando com ele.

### 3. Uma porta pública só

A lógica mora na **API**, num módulo `mcp/` do processo HTTP, que reaproveita os serviços de postagem e de mídia —
as mesmas regras, as mesmas permissões, a mesma trava de versão (regra 20).

O **Next** expõe `/mcp`, `/oauth/*` e os `/.well-known` do OAuth como **route handlers que só repassam** à API, com a
chave interna. A internet continua vendo um serviço só; a API continua sem nome público.

- **Regra 4** passa a dizer "o navegador **e os clientes MCP** só falam com o Next".
- **Regra 13** ganha uma **exceção fechada**, conferida por teste: os route handlers de máquina — `/mcp` e o OAuth.
  Eles **não leem cookie** (só `Authorization: Bearer`), então não há CSRF a proteger, e não fazem nada além de
  repassar.

### 4. O PostIt é servidor de autorização OAuth 2.1

- **Autorizar** abre uma tela do PostIt que exige **login com as duas etapas** (regra 11, sem atalho) e pergunta:
  *"Permitir que o ChatGPT componha rascunhos em seu nome?"*.
- **Escopo único**, `postagens:compor`. Quem não tem `POSTAGEM_EDITAR` não consegue autorizar, e a API confere a
  permissão a cada chamada, como na tela.
- **Acesso de 1 hora**, renovado sozinho por **token de renovação com rotação**, até **30 dias**; **7 dias sem uso**
  também vencem — os prazos da sessão ([ADR 0013](0013-autenticacao-com-duas-etapas.md)).
- Tudo guardado **só como hash**, como a sessão, e **revogável**: a pessoa no Perfil ("Aplicativos conectados"), o
  super admin na Administração. Conceder e revogar gravam `EventoAuditoria`, sem token.
- **PKCE obrigatório.** O cliente se apresenta por **CIMD** ou **registro dinâmico** (RFC 7591), e o token sai
  restrito ao PostIt (indicador de recurso).
- A biblioteca do servidor de autorização é escolhida no spike (M-4): **a recomendação é `oidc-provider`**, que é
  certificado e traz tudo acima, em vez de escrever OAuth à mão.

### 5. Imagens pelo mesmo caminho validado

- **Do acervo:** o assistente lista e escolhe.
- **Imagem nova:** pelo arquivo anexado no ChatGPT (`openai/fileParams`) ou por uma URL https. **A API baixa**, com
  proteção contra SSRF — só https, nunca IP privado ou de loopback, teto de 8 MB, tempo limite —, e a imagem segue o
  mesmo caminho do envio: `recebidos/` → conferência → `publicas/` (regra 10; [ADR 0012](0012-upload-direto-minio.md)).
- **Só JPEG dentro da especificação.** Converter PNG e reduzir são do navegador ([ADR 0027](0027-normalizar-imagem-no-navegador.md)),
  e a API não tem biblioteca de imagem ([06](../06-stack.md)). Fora disso, a ferramenta devolve o motivo.
- **Proporção que não serve ao formato não é recusa.** A imagem entra no rascunho **marcada para ajuste** — a mesma
  tarja "Não serve ao Feed — Ajustar" da troca de formato ([ADR 0025](0025-ajustar-imagem-ao-formato.md)) —, e a
  resposta da ferramenta diz isso ao assistente. **Recortar continua sendo decisão humana** (regra 10), e a
  conferência de prontidão barra o envio para revisão até o ajuste.

### 6. Nome e limites

- O servidor e o app no ChatGPT se chamam **PostIt** — nunca "Insta", "gram" ou "IG" ([ADR 0016](0016-nome-do-produto.md)).
- Corpo de até 1 MB (regra 10): imagem nunca vai em base64 no JSON.
- Teto de chamadas por acesso.
- O log nunca leva token, código de autorização nem URL de download (regra 3).

## Alternativas descartadas

**Token pessoal gerado no Perfil, sem OAuth.** Mais simples, e o Claude Code aceita — mas **o ChatGPT não aceita
token fixo para conectores**. Fica como possível complemento, não como caminho principal.

**Um quarto processo, com domínio público próprio** (`mcp.dominio`). Quebraria a porta única: mais um serviço exposto,
com cabeçalhos, TLS e proxy próprios. Repassar pelo Next custa uma rota e mantém a superfície como está.

**Provedor de identidade externo** (Auth0, Stytch e similares). Terceiro guardando a autorização de uma ferramenta
interna, com custo e mais um lugar para vazar — o contrário do resto do projeto, que é hospedado por nós.

**O PostIt gerar o texto.** Continua fora do escopo ([01](../01-visao-produto.md)): quem escreve é o assistente que a
pessoa já usa. O PostIt só dá as ferramentas.

**Deixar o assistente enviar para revisão ou agendar.** Tiraria a pessoa do meio justamente onde ela é a garantia.

## Consequências

- **A regra 13 ganha a exceção fechada, e a regra 4 ganha os clientes MCP** — nos dois lugares, no AGENTS.md, com
  teste que confere a lista de route handlers de máquina.
- **O ADR 0010 continua valendo** no que decide — a API escondida, o Next na frente —; a frase "o Next é o único
  cliente" passa a ler "o único **caminho** até a API".
- **Aparece um conjunto novo de segredos** (tokens e códigos OAuth), tratado como a sessão: hash no banco, nunca em
  log, revogação imediata ([11](../11-seguranca.md)).
- **O custo maior é o servidor OAuth**, não o MCP. O mesmo servidor serve depois os conectores do claude.ai e do
  Claude Desktop, que também usam OAuth.
- **Definir o horário fica para depois** (RF-K07): quando vier, o assistente **sugere** dia e hora, que chegam
  preenchidos na Revisão, e a pessoa com `POSTAGEM_AGENDAR` confirma — agendar continua sendo decisão humana, como
  todo o resto deste ADR.
