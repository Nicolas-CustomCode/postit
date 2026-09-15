# ADR 0021 — Dump manual do banco, sem backup de mídias e sem monitoramento externo

**Data:** 2026-09-15 · **Status:** aceito

## Contexto

A documentação previa:
- um dump diário automático do banco na própria VPS, com 30 dias de retenção;
- uma cópia periódica das mídias para fora do servidor;
- um monitoramento externo ainda não decidido.

O dono decidiu manter a operação mínima e **não usar ferramentas ou serviços externos** para isso.

## Decisão

### 1. Banco: só dump manual, guardado na máquina do dono

- **Antes de toda versão com migration**, o dono faz o dump e o baixa para a própria máquina. Comandos em
  [10](../10-infra-deploy.md#dump-e-restauração)
- Pode fazer dumps extras quando quiser, pelo mesmo comando
- **Não há dump automático**, nem no servidor nem fora dele

Cuidados com o arquivo na máquina do dono:
- fica **fora da pasta do repositório**;
- nunca é restaurado no ambiente local sem antes apagar tokens, sessões e segredos de duas etapas
  ([ADR 0018](0018-ambientes-e-apps-meta-separados.md));
- a `ENCRYPTION_KEY` de produção **não** fica guardada junto dele em texto aberto.

### 2. Mídias: sem backup

As fotos e vídeos em `publicas/`, no MinIO, **não têm cópia**.

### 3. Sem monitoramento externo

Nenhum serviço de fora confere se o sistema está no ar. Continua valendo o aviso por push de tudo que o worker
percebe ([ADR 0017](0017-pwa-e-notificacoes-push.md)).

## Consequências — riscos aceitos

| Se acontecer | Resultado |
|---|---|
| Erro que estraga dados (migration ruim, exclusão por engano) | Volta até o **último dump baixado**. Tudo depois dele se perde |
| Disco da VPS morre ou a VPS é perdida | Banco: volta até o último dump baixado. **Mídias: perdidas.** Postagens publicadas continuam no Instagram; agendadas precisam do arquivo enviado de novo; o acervo some |
| Servidor inteiro cai | **Ninguém é avisado.** Descobre-se ao abrir o sistema ou quando uma postagem não sair. Com a regra de 15 minutos de atraso, as postagens que venceram vão para `FALHOU` quando o sistema volta, em vez de saírem atrasadas |
| Worker trava sem cair | O painel de saúde mostra; sem push, porque quem envia o push é o próprio worker |

**Frequência dos dumps extras** é escolha do dono: quanto maior o intervalo, mais se perde num incidente.

## Alternativas consideradas

**Dump diário automático no servidor.** Recupera erros do dia anterior sem depender de lembrar, mas não protege
contra perda da VPS. Descartado por escolha do dono.

**Backup fora do servidor** (Cloudflare R2, Backblaze B2, Google Drive, outro servidor). Protege contra perda da
VPS. Descartado: exige ferramenta externa.

**Backups do próprio Easypanel.** Exigem armazenamento compatível com S3 externo
([docs](https://easypanel.io/docs/backups/database)). Descartado pelo mesmo motivo.

**Monitoramento externo** (serviço que olha o site, Healthchecks.io recebendo sinal de vida). Descartado:
serviço externo.

## Reversibilidade

**Alta.** Qualquer uma das alternativas pode ser adicionada depois, sem mudar o código da aplicação.
