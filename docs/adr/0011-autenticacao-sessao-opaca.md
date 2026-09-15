# ADR 0011 — Autenticação por sessão opaca, com cookie no Next

**Data:** 2026-09-14 · **Status:** substituído pelo [ADR 0013](0013-autenticacao-com-duas-etapas.md) em 2026-09-14

> Uma revisão de segurança, antes de qualquer código, acrescentou verificação em duas etapas
> obrigatória, expiração por inatividade, proteção detalhada contra tentativas repetidas, recuperação de
> acesso sem e-mail, e corrigiu o nome do cookie em desenvolvimento. O texto abaixo é mantido como
> registro histórico.

## Contexto

Com a arquitetura de [ADR 0010](0010-monorepo-next-nest-bff.md), o navegador fala só com o Next e o
Next fala com a API. A autenticação da ferramenta precisa funcionar nesse arranjo.

A decisão anterior era usar NextAuth dentro do Next. Com uma API separada, o NextAuth resolveria só
metade do problema: a API também precisa saber quem é o usuário, em toda requisição.

A API atende **só o painel web** — não há app de celular nem integração externa previstos.

**Importante não confundir:** isto trata do login **na ferramenta**. A conexão com contas do
Instagram é outro assunto, em [08](../08-integracao-instagram.md).

## Decisão

Seguir o modelo do `nossobuncker`:

### Senha e sessão

- Senha guardada com **argon2id**
- No login, a API gera um **token opaco aleatório de 32 bytes** e guarda no banco **só o hash sha256**
  dele, na tabela `Sessao`
- A sessão vale 30 dias e se renova com o uso
- Sair da conta apaga a sessão no banco

"Opaco" quer dizer que o token não carrega informação nenhuma dentro dele, ao contrário de um JWT. Ele
só é um identificador que a API confere no banco. Isso permite **encerrar uma sessão na hora**, o que
um JWT não permite.

### Cookie

O Next grava o token num cookie:

| Atributo | Valor | Por quê |
|---|---|---|
| Nome | `__Host-sessao` | O prefixo `__Host-` obriga o navegador a só aceitar o cookie com `Secure`, sem domínio e com caminho `/` |
| `httpOnly` | sim | JavaScript da página não consegue ler o token |
| `SameSite` | `lax` | O navegador não envia o cookie em requisições disparadas por outros sites |
| `Secure` | quando `APP_URL` é https | Decidido pela URL, **não** por `NODE_ENV` — dor registrada no `nossobuncker` |

### Como a API sabe quem é o usuário

O Next repassa o token no cabeçalho `Authorization: Bearer`, junto com uma chave interna
(`x-internal-key`) e o IP e navegador de origem.

Na API, três guardas globais, nesta ordem:

1. **`InternalKeyGuard`** — recusa qualquer requisição sem a chave interna correta. Compara em tempo
   constante e falha fechado se a chave não estiver configurada
2. **`SessaoGuard`** — confere o token no banco e anexa o usuário à requisição
3. **Autorização "negar por padrão"** — toda rota precisa declarar `@Public` ou `@AnyAuthenticated`.
   Rota sem declaração é **recusada**. Não há papéis de usuário no MVP ([ADR 0002](0002-single-tenant.md))

### Proteção das páginas no Next

- O `proxy.ts` do Next só confere **se o cookie existe** e redireciona para o login se não existir
- A proteção de verdade é uma função `requireSession()` chamada **em cada página e em cada Server
  Action**, que confirma a sessão com a API

Essa separação existe porque verificar só no `proxy.ts` é uma falsa segurança — dor registrada no
`alivio-crm`, onde o middleware não protegia nada.

### CSRF

Ataque em que outro site faz o navegador do usuário enviar uma ação sem ele querer. Coberto por dois
mecanismos juntos: `SameSite=lax` no cookie e a verificação de origem que as Server Actions do Next
já fazem.

## Consequências

### Positivas

- Nenhum token acessível ao JavaScript do navegador
- Sessão pode ser encerrada imediatamente — útil se uma senha vazar
- Sem refresh token, sem rotação, sem lógica de renovação no navegador
- Uma rota esquecida sem declaração de acesso fica **fechada**, não aberta
- Padrão já implementado e testado no `nossobuncker`

### Negativas

- Uma consulta ao banco por requisição para validar a sessão. Irrelevante no volume previsto
- Código de autenticação próprio para manter, em vez de uma biblioteca pronta
- Se um dia houver outro cliente da API, será preciso um segundo mecanismo de autenticação

## Alternativas consideradas

**NextAuth no Next.** Resolve o login das telas, mas a API ficaria sem saber quem é o usuário sem uma
ponte adicional.

**JWT emitido pela API, como no `alivio-crm`.** Exige refresh token, rotação e detecção de reuso, e
um JWT não pode ser revogado antes de expirar. Complexidade que só se paga com vários clientes da API.

**Login social.** Dependência externa para um problema que não existe: poucos usuários conhecidos,
semeados.

## Reversibilidade

**Alta.** A autenticação fica concentrada no módulo `auth` da API e em `lib/auth` do Next. Adicionar
outro mecanismo — por exemplo, chaves de API para automações — não exige desfazer este.
