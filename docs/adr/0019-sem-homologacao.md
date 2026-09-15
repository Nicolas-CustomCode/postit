# ADR 0019 — Sem homologação: só ambiente local e produção

**Data:** 2026-09-15 · **Status:** aceito · **Substitui parcialmente:** [ADR 0018](0018-ambientes-e-apps-meta-separados.md) · **Complementado por:** [ADR 0020](0020-easypanel-na-validacao.md) e [ADR 0021](0021-dump-manual-e-sem-monitoramento-externo.md)

> Na etapa de validação, o deploy é pelo Easypanel, com a branch `producao` apontada para a tag, em vez do
> `scripts/deploy.sh` ([ADR 0020](0020-easypanel-na-validacao.md)). Não há backup diário: só o dump manual
> ([ADR 0021](0021-dump-manual-e-sem-monitoramento-externo.md)).

## Contexto

O [ADR 0018](0018-ambientes-e-apps-meta-separados.md) definiu três ambientes: local com túnel, homologação na
VPS e produção. A homologação servia para:

- rodar o roteiro manual de publicação antes de cada versão;
- ensaiar deploy e migrations no servidor;
- testar o proxy de verdade (cabeçalhos, CSP, `X-Real-IP`, envio ao MinIO, origem das Server Actions).

O custo era manter mais três processos, um banco, um bucket e dois nomes de DNS, e fazer todo deploy duas
vezes. Para uma ferramenta interna começando, isso atrasa mais do que protege.

O túnel já permite testar **tudo** no computador, inclusive publicar de verdade pela Graph API oficial numa
conta de testes.

## Decisão

**Dois ambientes: local e produção.**

| | Local | Produção |
|---|---|---|
| **Onde** | Computador de quem desenvolve | VPS |
| **Processos** | `npm run dev` | `postit-web`, `postit-api`, `postit-worker` |
| **Endereços** | Dois túneis rápidos `….trycloudflare.com` ([ADR 0022](0022-tunel-rapido-no-desenvolvimento.md)) | `app.seudominio` e `midia.seudominio` |
| **Banco e bucket** | Postgres e MinIO em Docker local | `postit` |
| **App da Meta** | **PostIt Dev** | **PostIt** |
| **Conta de Instagram** | Conta de testes | Contas reais |
| **Código** | Qualquer estado | Versão marcada com tag `vX.Y.Z` |

Continuam valendo do ADR 0018:
- o túnel, agora o rápido ([ADR 0022](0022-tunel-rapido-no-desenvolvimento.md));
- os dois apps da Meta;
- a conta de testes;
- a regra "nenhum ambiente além da produção tem credencial de conta real".

### O que substitui a homologação

| A homologação cobria | Agora |
|---|---|
| Roteiro manual de publicação antes de cada versão | Roda **no local**, pelo túnel, com a conta de testes |
| Ensaio de migration no servidor | A CI aplica todas as migrations num Postgres vazio. Antes de liberar uma versão com migration, **dump manual do banco** de produção. |
| Ensaio do deploy | `scripts/deploy.sh` só aceita tag e termina com verificação de fumaça. Voltar atrás é rodar o script com a tag anterior |
| Proxy de verdade | O túnel já cobre https, cookie `__Host-` e origem. O resto vira a **estreia em produção**, feita uma vez, antes de conectar contas reais. Ver [10](../10-infra-deploy.md#estreia-em-produção) |

## Consequências

### Positivas

- Um deploy por versão, não dois
- Menos memória na VPS: 4 GB bastam
- Menos configuração: sem banco, bucket, usuário e nomes de DNS de homologação

### Negativas — riscos aceitos

- **A primeira vez que uma migration roda no servidor é na produção.** Uma migration errada pode deixar o
  sistema fora do ar até restaurar o dump. Por isso o dump manual antes de toda versão com migration
- **O script de deploy e a configuração do proxy só são testados de verdade na produção.** Mitigado pela
  estreia, que acontece antes de haver conta real conectada
- **O dump é manual** e não há backup automático: se for esquecido, a volta atrás depende do último dump baixado
  ([ADR 0021](0021-dump-manual-e-sem-monitoramento-externo.md))
- **Migration não se desfaz com a tag anterior.** Voltar o código não volta o banco. Voltar uma versão com
  migration exige restaurar o dump, perdendo o que foi gravado depois dele; se o erro aparecer dias depois, a
  saída é corrigir numa nova versão

## Alternativas consideradas

**Manter a homologação na mesma VPS** ([ADR 0018](0018-ambientes-e-apps-meta-separados.md)). Mais segura para
migrations, mas dobra o trabalho de deploy e o consumo do servidor.

**Dump automático no `deploy.sh`, ou trava que impede o deploy sem dump.** Descartados por escolha do dono: o
dump é feito manualmente, quando a versão tem migration, sem conferência pelo script.

**Migrations em duas etapas** (criar o novo e gravar nas duas colunas antes de remover o antigo, para a versão
anterior continuar funcionando). Descartado por escolha do dono: exige duas ou três versões por mudança.

**Ensaiar migrations numa cópia dos dados de produção, revisor automático de migrations na CI, backup contínuo
do Postgres.** Não adotados agora. Ficam como evolução se o banco crescer ou uma migration causar incidente.

**Deploy direto da `main`, sem tag.** Mais rápido, mas perde o nome exato do que está rodando e a volta
atrás simples.

## Reversibilidade

**Alta.** A homologação pode voltar a qualquer momento, como descrita no ADR 0018: é configuração de
processos, variáveis e DNS.
