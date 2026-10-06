# ADR 0032 — `main` protegida, tudo por pull request, e o repositório público endurecido

**Data:** 2026-10-06 · **Status:** aceito · **Substitui:** o fluxo "direto na `main`" do [15](../15-qualidade-e-fluxo-de-trabalho.md)
e do AGENTS.md

## Contexto

Até a estreia, os commits iam direto na `main`: a CI avisava quando algo quebrava, mas não impedia nada de entrar, e
a proteção era só a tag — produção recebia apenas versão marcada. Com a v1.0.0 no ar em 06/10/2026, isso mudou de
peso:

- **A tag `v*` publica a imagem de produção** ([ADR 0030](0030-compose-de-producao.md)). Sem regra nenhuma, qualquer
  um com escrita criaria ou moveria uma tag.
- **A `main` aceitava push forçado e podia ser apagada.**
- **O repositório é público** — conferido em 06/10/2026 — e a varredura de segredos, o bloqueio de push com segredo e
  as correções de segurança do Dependabot estavam desligados.

## Decisão

### 1. O repositório continua público

Decisão do usuário. Assim, proteção de branch, rulesets, varredura de segredos e bloqueio de push são gratuitos —
numa conta pessoal, em repositório privado, eles exigem plano pago. O que torna isso seguro é o que já valia: nenhum
segredo entra no git, e a CI usa valores falsos. A imagem no GHCR é um pacote à parte, e fica privada.

### 2. Tudo por pull request

- **Ruleset da `main`, sem exceção para ninguém**: só por PR, com o job `verify` da CI verde e o branch atualizado;
  histórico linear; sem push forçado nem exclusão.
- **Merge só por squash**: o título e a descrição do PR viram o commit — o título segue o padrão
  `tipo(escopo): resumo` em português. Branch apagado depois do merge.
- **Sem aprovação obrigatória**: o projeto tem uma pessoa, e o GitHub não deixa o autor aprovar o próprio PR —
  exigir aprovação travaria tudo. O portão é a CI.
- **Emergência**: o admin desliga o ruleset no painel, corrige e liga de novo. Fica no log de auditoria do GitHub; não
  há atalho permanente.

### 3. Tags de versão

- **Só o admin cria** tag `v*`.
- **Ninguém move nem apaga** tag `v*` — sem exceção, nem para o admin. São dois rulesets porque, no GitHub, a exceção
  de um ruleset vale para todas as regras dele.

### 4. Segurança do GitHub

Ligados em 06/10/2026: varredura de segredos, bloqueio de push com segredo, alertas e correções de segurança do
Dependabot, relato privado de vulnerabilidade (com o `SECURITY.md`). A varredura por padrões genéricos e a checagem de
validade dos segredos são pagas mesmo em repositório público, e ficaram de fora.

### 5. Actions

- Só as do GitHub, as de criadores verificados e `docker/*`.
- **Fixadas por hash de commit**, com a versão em comentário: uma tag de action pode ser movida pelo dono dela, o hash
  não. O Dependabot atualiza o hash e o comentário.
- PR vindo de fork só roda a CI com aprovação do admin.
- Permissão padrão das Actions: só leitura.

## Consequências

- **Trabalhar fica um passo mais lento**: branch, PR, esperar a CI, merge. É o preço de nada entrar na `main` sem a
  CI ter passado.
- **Um PR por vez**: o pre-commit sobe a versão a cada commit, e dois PRs abertos juntos conflitam no número. O
  segundo resolve com "Update branch".
- **A tag é criada na `main` depois do merge**, na máquina do admin.
- O roteiro está no [15](../15-qualidade-e-fluxo-de-trabalho.md#git).
