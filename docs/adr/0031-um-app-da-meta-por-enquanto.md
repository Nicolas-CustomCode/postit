# ADR 0031 — Um app da Meta só, por enquanto

**Data:** 2026-10-05 · **Status:** aceito, provisório · **Substitui parcialmente:**
[ADR 0018](0018-ambientes-e-apps-meta-separados.md) (seção 3, "Aplicativos da Meta separados", e o trecho da seção 5
sobre o segredo do app)

## Contexto

O [ADR 0018](0018-ambientes-e-apps-meta-separados.md) decidiu **dois apps** no painel da Meta: o **PostIt Dev**, só
com a conta de testes, para o computador local, e o **PostIt**, com as contas reais, para a produção. O segundo
nunca foi criado.

Na estreia ([ADR 0030](0030-compose-de-producao.md)), o usuário decidiu usar **o mesmo app** nos dois ambientes por
enquanto: menos configuração a manter enquanto o projeto amadurece.

## Decisão

- **Um app só**, o que já existe, com as **duas** URIs de retorno: a do túnel do computador local e a da produção
  (`https://postit-app.kwlyqm.easypanel.host/contas/conectar/retorno`).
- As contas reais entram como testadoras **nesse** app, ao lado da conta de testes.
- **Continua valendo o essencial da regra 21**: os **tokens** das contas reais só existem no banco de produção. O
  computador local só conecta a conta de testes, e nenhum banco, dump ou `.env` de produção vai para lá.
- O que deixa de valer: "o segredo do app de produção nunca sai do servidor" — o `IG_APP_SECRET` é o mesmo nos dois
  `.env`.

## Riscos aceitos

- **Quem tiver o `.env` do desenvolvimento tem o segredo do app que atende as contas reais.** Sozinho ele não publica
  em conta nenhuma — publicar exige o token de cada conta, que só está no banco de produção —, mas serve para trocar
  código de autorização por token, se alguém interceptar um.
- **Um engano no local alcança conta real**: conectar pelo túnel uma conta que é testadora do mesmo app funciona. A
  defesa é procedimento — no local, só a conta de testes.
- **A tela de autorização da Meta mostra o nome do app.** Se ele se chama "PostIt Dev", é isso que a pessoa vê ao
  conectar a conta real; renomear o app no painel resolve.
- **Trocar o túnel mexe no app da produção** (a URI de retorno do túnel muda a cada `npm run tunnel`).

## Quando revisar

Ao primeiro sinal de uso mais amplo — mais gente além da equipe interna, ou a mudança para a VPS definitiva —, criar
o app **PostIt** de produção como o ADR 0018 previa: é configuração no painel, sem mudança de código, e só troca
`IG_APP_ID` e `IG_APP_SECRET` no `.env` de produção. As contas reais reconectam uma vez.
