# Documentação do PostIt

Agendador de postagens para Instagram. Ferramenta interna que conecta contas profissionais, guarda
o conteúdo preparado com antecedência, publica automaticamente no horário marcado e coleta as
métricas depois.

**Estado:** arquitetura definida, implementação não iniciada.

**Forma:** monorepo com três processos — telas em Next.js, API em NestJS escondida atrás do Next, e um
worker que usa o mesmo código da API para publicar. Ver [05 — Arquitetura](05-arquitetura.md).

**Escopo:** o MVP publica no Instagram, com várias contas. Outras redes sociais e respostas a
comentários e mensagens estão planejadas para depois — ver [ADR 0009](adr/0009-preparacao-multi-rede.md).
Tudo funciona também no celular, com avisos por notificação push.

**Nome:** PostIt é nome provisório, para uso interno — ver [ADR 0016](adr/0016-nome-do-produto.md) antes de
qualquer uso externo.

---

## Ordem de leitura

### Para entender o produto
1. [01 — Visão de Produto](01-visao-produto.md) — o problema, o escopo e, principalmente, o
   **não-escopo**
2. [03 — Mapa Mental](03-mapa-mental.md) — o território inteiro numa página
3. [04 — Jornada do Usuário](04-jornada-usuario.md) — como se usa, incluindo quando dá errado
4. [13 — Telas e Navegação](13-telas-e-navegacao.md) — cada tela, quem vê o quê e como fica no celular

### Para implementar
5. [02 — Requisitos](02-requisitos.md) — o contrato, com critério de aceite por item
6. [05 — Arquitetura](05-arquitetura.md) — os três processos, máquina de estados, invariantes e
   organização do monorepo
7. [06 — Stack](06-stack.md) — cada tecnologia e por quê
8. [07 — Modelo de Dados](07-modelo-dados.md) — entidades, restrições e índices
9. [08 — Integração com o Instagram](08-integracao-instagram.md) — **a referência da API da Meta**
10. [09 — Motor de Agendamento](09-motor-agendamento.md) — como publicar sem duplicar e sem sumir
11. [14 — Ambientes e Desenvolvimento](14-ambientes-e-desenvolvimento.md) — local com túnel, produção
    e os dois apps da Meta. **Leia antes de rodar o projeto pela primeira vez**
12. [15 — Qualidade e Fluxo de Trabalho](15-qualidade-e-fluxo-de-trabalho.md) — commits, versão, CI e
    testes

### Para operar
13. [10 — Infraestrutura e Deploy](10-infra-deploy.md) — Easypanel agora, PM2 e Apache depois, dump manual, estreia em produção
14. [11 — Segurança](11-seguranca.md) — **começa explicando cada conceito em linguagem simples**; depois
    login, duas etapas, sessão, CSRF, CORS, CSP, tokens, bucket, push e o que fazer em incidentes
15. [12 — Roadmap](12-roadmap.md) — as seis fases, com marco verificável em cada uma

### Decisões registradas
- [ADR 0001](adr/0001-instagram-login-em-vez-de-facebook-login.md) — Instagram Login em vez de
  Facebook Login
- [ADR 0002](adr/0002-single-tenant.md) — Ferramenta single-tenant
- [ADR 0003](adr/0003-vps-docker-pm2.md) — VPS com Docker e PM2 *(parcialmente substituído pelo 0020: vale para
  a etapa 2)*
- [ADR 0004](adr/0004-despachante-bullmq.md) — Despachante periódico em vez de jobs com atraso
  *(substituído pelo 0008)*
- [ADR 0005](adr/0005-minio-midia-publica.md) — MinIO com bucket público
- [ADR 0006](adr/0006-fuso-horario-utc.md) — Horário em UTC, fuso IANA por conta
- [ADR 0007](adr/0007-falha-exige-decisao-humana.md) — Falha definitiva exige decisão humana
- [ADR 0008](adr/0008-pg-boss-em-vez-de-bullmq.md) — pg-boss em vez de BullMQ com Redis
- [ADR 0009](adr/0009-preparacao-multi-rede.md) — Preparação para múltiplas redes sociais
- [ADR 0010](adr/0010-monorepo-next-nest-bff.md) — Monorepo com Next como BFF e NestJS como API e
  worker
- [ADR 0011](adr/0011-autenticacao-sessao-opaca.md) — Autenticação por sessão opaca, com cookie no Next
  *(substituído pelo 0013)*
- [ADR 0012](adr/0012-upload-direto-minio.md) — Envio de mídia direto ao MinIO, com validação antes de
  publicar
- [ADR 0013](adr/0013-autenticacao-com-duas-etapas.md) — Autenticação por sessão opaca com verificação em
  duas etapas obrigatória
- [ADR 0014](adr/0014-csp-e-cabecalhos-de-seguranca.md) — CSP com nonce e cabeçalhos de segurança
- [ADR 0015](adr/0015-super-admin-e-permissoes.md) — Super admin e permissões por usuário
- [ADR 0016](adr/0016-nome-do-produto.md) — Nome do produto: PostIt, provisório e interno
- [ADR 0017](adr/0017-pwa-e-notificacoes-push.md) — App instalável (PWA) e notificações push
- [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md) — Três ambientes, túnel no desenvolvimento e apps da Meta separados
  *(parcialmente substituído pelo 0019)*
- [ADR 0019](adr/0019-sem-homologacao.md) — Sem homologação: só ambiente local e produção
- [ADR 0020](adr/0020-easypanel-na-validacao.md) — Easypanel na validação; PM2 e Apache depois da aprovação
- [ADR 0021](adr/0021-dump-manual-e-sem-monitoramento-externo.md) — Dump manual, sem backup de mídias e sem
  monitoramento externo
- [ADR 0022](adr/0022-tunel-rapido-no-desenvolvimento.md) — Túnel rápido da Cloudflare no desenvolvimento, sempre ligado
- [ADR 0023](adr/0023-codigo-em-ingles.md) — Código em inglês; banco, textos e documentação em português
- [ADR 0024](adr/0024-carrossel-e-quantidade-nao-formato.md) — Carrossel é quantidade, não formato
- [ADR 0025](adr/0025-ajustar-imagem-ao-formato.md) — Ajustar a imagem ao formato: recortar ou emoldurar,
  nunca à força
- [ADR 0026](adr/0026-postagem-em-duas-etapas.md) — A postagem em duas etapas: Composição e Revisão, com o
  núcleo da aprovação e comentários de qualquer logado
- [ADR 0027](adr/0027-normalizar-imagem-no-navegador.md) — Converter e reduzir a imagem no navegador, antes
  do envio; a API continua só com JPEG de até 8 MB

---

## Se você só vai ler três coisas

**[08 — Integração com o Instagram](08-integracao-instagram.md)** é o documento que economiza mais
tempo. Toda afirmação sobre a API tem link para a documentação oficial, e o que a Meta não confirma
está isolado numa seção de pendências, não misturado com o que é certo.

**[09 — Motor de Agendamento](09-motor-agendamento.md)** explica as quatro camadas que impedem uma
postagem de ser publicada duas vezes, e o que fazer no único caso genuinamente ambíguo — quando a
chamada de publicação dá timeout e não se sabe se a Meta publicou.

**[12 — Roadmap](12-roadmap.md)** tem o roteiro de testes da Fase 1. Se aqueles dezesseis testes
passarem, o projeto está de pé.

---

## As decisões que moldam tudo

| Decisão | Escolha | Onde |
|---|---|---|
| Como publicar | API oficial da Meta via Instagram Login | [ADR 0001](adr/0001-instagram-login-em-vez-de-facebook-login.md) |
| Para quem | Ferramenta interna, single-tenant; vários usuários, todos veem todas as contas | [ADR 0002](adr/0002-single-tenant.md) |
| Como o código se organiza | Monorepo: Next como porta de entrada, API Nest escondida, worker no mesmo código da API | [ADR 0010](adr/0010-monorepo-next-nest-bff.md) |
| Como o usuário entra | Senha + verificação em duas etapas obrigatória, sessão em cookie seguro, acesso negado por padrão | [ADR 0013](adr/0013-autenticacao-com-duas-etapas.md) |
| Como o navegador é protegido | CSP com nonce e cabeçalhos de segurança gerados pelo Next | [ADR 0014](adr/0014-csp-e-cabecalhos-de-seguranca.md) |
| Quem pode fazer o quê | Permissões por usuário de um catálogo fixo; super admin administra pela tela, com auditoria | [ADR 0015](adr/0015-super-admin-e-permissoes.md) |
| Onde roda | Easypanel na validação; PM2, Docker Compose e Apache depois da aprovação | [ADR 0020](adr/0020-easypanel-na-validacao.md), [ADR 0003](adr/0003-vps-docker-pm2.md) |
| Backup e monitoramento | Só dump manual guardado na máquina do dono; sem backup de mídias; sem monitoramento externo — riscos aceitos | [ADR 0021](adr/0021-dump-manual-e-sem-monitoramento-externo.md) |
| Como agenda | Despachante lendo do Postgres, filas pg-boss no mesmo banco | [ADR 0008](adr/0008-pg-boss-em-vez-de-bullmq.md) |
| Onde ficam as mídias | MinIO público só depois de validar; envio direto do navegador | [ADR 0005](adr/0005-minio-midia-publica.md), [ADR 0012](adr/0012-upload-direto-minio.md) |
| Como trata horário | UTC no banco, fuso IANA por conta | [ADR 0006](adr/0006-fuso-horario-utc.md) |
| O que fazer ao falhar | Parar e esperar decisão humana | [ADR 0007](adr/0007-falha-exige-decisao-humana.md) |
| Como crescer para outras redes | Nomes genéricos e código por rede, sem abstração antecipada | [ADR 0009](adr/0009-preparacao-multi-rede.md) |
| Como avisa | Sino no sistema + push no navegador e no celular, por responsabilidade, sem dado sensível | [ADR 0017](adr/0017-pwa-e-notificacoes-push.md) |
| Onde se testa | Tudo no computador local, com túnel e conta de testes; produção só por tag, com dump manual antes de migration | [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md), [ADR 0019](adr/0019-sem-homologacao.md) |
| Como se trabalha no código | Direto na `main`, CI avisa quando quebra, Playwright com Meta falsa | [15](15-qualidade-e-fluxo-de-trabalho.md) |
| Duas pessoas na mesma postagem | Controle por versão: quem salva depois é avisado e não perde o que digitou | [05](05-arquitetura.md#8-edição-simultânea) |
| Como se chama | PostIt, provisório; nunca "Insta" ou "gram" no nome | [ADR 0016](adr/0016-nome-do-produto.md) |

---

## Três coisas que costumam surpreender

**A Meta baixa o arquivo, nós não enviamos.** A API recebe uma URL e vai buscar o arquivo nos
servidores dela. É por isso que o bucket de mídia precisa ser público — não é descuido, é exigência.
Ver [ADR 0005](adr/0005-minio-midia-publica.md).

**Marcação de localização é impossível.** Não é "não faremos por enquanto": pela via de API
escolhida, não há como escrever a localização nem como descobrir o identificador dela. Os dois lados
estão fechados. Ver [ADR 0001](adr/0001-instagram-login-em-vez-de-facebook-login.md).

**Não é preciso App Review da Meta — no MVP.** Sendo ferramenta para contas do próprio dono, o
Standard Access basta. A contrapartida é que cada conta precisa ser cadastrada como testadora no
aplicativo antes de conectar. E atenção: responder comentários e mensagens em tempo real, planejado
para depois, pode trazer a revisão de volta. Ver
[08 — Níveis de acesso](08-integracao-instagram.md#níveis-de-acesso-e-app-review).

---

## Convenções

**Idioma:** código em inglês; comentários, banco, telas, documentação e commits em pt-BR, com a tabela de tradução
do vocabulário no [ADR 0023](adr/0023-codigo-em-ingles.md). A exceção são os nomes que vêm da API da Meta (`media_type`, `creation_id`, `user_tags`, `status_code`), mantidos
como a Meta os define para não criar dicionário mental na hora de depurar.

**Numeração:** identificadores de requisito (`RF-A01`, `RNF-03`) e de ADR são estáveis. Uma vez
atribuídos, não se reaproveitam. Item removido fica registrado com a justificativa.

**Fontes:** afirmações sobre a API da Meta trazem link para a documentação oficial. O que não for
confirmável fica em
[08 — A validar em desenvolvimento](08-integracao-instagram.md#a-validar-em-desenvolvimento).

**Manutenção:** a documentação da Meta muda sem aviso. Ao encontrar divergência, atualize
[08](08-integracao-instagram.md) e a data de verificação no topo dele.
