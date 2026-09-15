# ADR 0003 — VPS com Docker Compose para serviços e PM2 para processos

**Data:** 2026-09-09 · **Status:** parcialmente substituído pelo [ADR 0020](0020-easypanel-na-validacao.md) em 2026-09-15

> **Vale para a etapa 2, depois da aprovação do projeto.** Durante a validação, o PostIt roda no Easypanel, com
> web, API e worker como serviços construídos de um `Dockerfile`. PM2, Docker Compose e Apache voltam na mudança
> de casa. O texto abaixo descreve esse destino.

## Contexto

O sistema precisa de execução confiável em segundo plano: publicações agendadas, coleta de métricas
e renovação de tokens. Publicar um vídeo pode levar mais de cinco minutos, entre criar o container,
a Meta baixar o arquivo, processar e então publicar.

## Decisão

**VPS própria.** Postgres e MinIO em Docker Compose, com portas deslocadas e presas a
`127.0.0.1`. Três processos PM2 no host — telas (Next), API (Nest) e worker (Nest sem HTTP) — com
`ecosystem.config.cjs`. A divisão em três processos vem do [ADR 0010](0010-monorepo-next-nest-bff.md).

É exatamente o padrão de `vortex`, `hotclone`, `nossobuncker` e `alivio-crm`.

## Consequências

### Positivas

- **Sem tempo limite.** A publicação de vídeo pode levar o tempo que precisar
- **Worker de verdade**, com processo longo consumindo a fila — não simulação por requisição HTTP
- **O MinIO fica ao lado**, servido pelo mesmo proxy, sem custo de banda entre serviços
- **Um servidor só** para operar, monitorar e fazer backup
- **Padrão conhecido.** Os arquivos de deploy são quase iguais aos dos outros projetos

### Negativas

- O servidor é responsabilidade nossa: atualização de sistema, TLS, firewall, disco
- Sem escalonamento automático — irrelevante neste volume
- Deploy é manual, por `git pull` e PM2
- Ponto único de falha. Aceitável para ferramenta interna; inaceitável se virar produto

## Alternativas consideradas

**Vercel com worker externo.** A Vercel não sustenta a publicação de vídeo dentro do tempo limite
de função, o que obrigaria um worker em outro lugar de qualquer jeito — dois ambientes para manter,
resolvendo um problema que a VPS não tem. Nenhum dos seus projetos usa Vercel.

**Aplicação containerizada também.** Adiciona etapa de construção de imagem e registro sem ganho
para um único servidor. Docker aqui serve para isolar serviços com estado, e é só isso que ele faz.

**Kubernetes.** Desproporcional em qualquer leitura.

## Reversibilidade

**Alta.** A aplicação não depende da VPS. Containerizar e mover para outro provedor é trabalho
conhecido. As portas deslocadas e o bind em `127.0.0.1` são convenção, não amarra.
