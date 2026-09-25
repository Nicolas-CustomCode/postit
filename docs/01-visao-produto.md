# 01 — Visão de Produto

## O problema

Publicar com constância no Instagram é um trabalho de rotina que não escala na mão. Quem gerencia
mais de uma conta acaba dependendo de alarme no celular, planilha e boa vontade: o conteúdo até
existe pronto, mas alguém precisa estar disponível no horário certo para apertar "publicar".

O aplicativo oficial do Instagram não agenda. O Meta Business Suite agenda, mas exige Página do
Facebook vinculada, tem interface pesada para uso diário e não dá nenhum controle sobre o processo
— quando falha, falha em silêncio.

## O objetivo

Um sistema onde o conteúdo é preparado com antecedência, revisado, agendado e publicado
automaticamente no horário marcado — com registro do que aconteceu em cada tentativa e coleta
automática das métricas depois.

A regra que orienta todas as decisões de projeto: **é melhor não publicar do que publicar errado
ou publicar duas vezes.** Uma postagem duplicada ou publicada fora de hora é um estrago visível
para o público; uma postagem que falhou e avisou é só um contratempo interno.

## Público

Ferramenta interna, de dono único. Uma pessoa (ou uma equipe pequena que compartilha a mesma
instalação) gerenciando várias contas de Instagram. Não é um produto para vender: não tem cadastro
aberto, não tem cobrança, não tem isolamento entre clientes.

**O MVP aceita várias contas do Instagram.** Os primeiros testes usam uma só, mas cada conta tem sua
conexão, seu token, seu fuso horário e seu limite diário de publicações desde o início.

Existe uma condição prática: como a ferramenta não passa pela revisão da Meta, cada conta precisa ser
**cadastrada como testadora no aplicativo Meta** antes de ser conectada. Funciona bem para contas
próprias ou de clientes próximos. Passo a passo em
[08](08-integracao-instagram.md#cada-conta-precisa-ser-cadastrada-no-aplicativo).

## Escopo do MVP

Quatro capacidades, todas necessárias para o sistema ter valor real, e **todas funcionando também no
celular** — inclusive compor, enviar vídeo, marcar pessoas e mexer no calendário. Ver
[13 — Telas e Navegação](13-telas-e-navegacao.md).

### 1. Agendar e publicar
Conectar uma conta profissional do Instagram, subir foto ou vídeo, escrever legenda, escolher o
formato (feed, reels ou stories), marcar pessoas, definir data e hora — e o sistema
publica sozinho.

### 2. Calendário visual
Ver o mês ou a semana com tudo que está agendado, arrastar uma postagem para outro horário, e
pré-visualizar como a grade do perfil vai ficar depois que as postagens saírem.

### 3. Fluxo de aprovação
Uma postagem passa por rascunho → revisão → aprovado antes de poder ser agendada. Comentários
internos por postagem, para o vai e vem de ajuste de legenda sem sair da ferramenta.

### 4. Métricas pós-publicação
Depois que a postagem sai, o sistema busca os números na API da Meta (alcance, curtidas,
comentários, salvamentos, compartilhamentos) e mostra o histórico.

Além das métricas de cada postagem, uma **versão simples das métricas da conta**: seguidores, alcance e
interações dia a dia. A coleta começa assim que a conta é conectada, porque **a Meta só guarda 90 dias** —
guardar no nosso banco é o que cria o histórico. Demografia do público fica para depois.

### E o que sustenta as quatro

- **Avisos** — quando algo precisa de alguém (publicação falhou, postagem esperando aprovação, conexão
  vencendo), a pessoa responsável recebe no sino do sistema e, se ativou, **notificação push** no
  navegador ou no celular. O sistema pode ser instalado na tela inicial como um aplicativo. Ver
  [ADR 0017](adr/0017-pwa-e-notificacoes-push.md).
- **Edição segura em equipe** — se duas pessoas editam a mesma postagem, a segunda a salvar é avisada em vez
  de apagar sem saber o trabalho da primeira.
- **Ambientes separados** — testar nunca encosta nas contas reais. Ver
  [14 — Ambientes e Desenvolvimento](14-ambientes-e-desenvolvimento.md).

## Não-escopo

Três listas diferentes, e a distinção importa: o que está planejado para depois, o que decidimos
não fazer, e o que a Meta não permite.

### Planejado para depois do MVP

Fora da primeira versão, mas com intenção declarada de construir. Por isso algumas decisões de hoje
já levam isso em conta — sem construir nada antes da hora. Ver
[ADR 0009](adr/0009-preparacao-multi-rede.md).

| Funcionalidade | O que já foi considerado agora |
|---|---|
| **Outras redes sociais** (TikTok, LinkedIn, X) | Nomes genéricos no banco (`Conta` com campo `rede`), código e filas separados por rede |
| **Responder comentários** do Instagram | A conversa interna da equipe se chama `ComentarioInterno`, para não confundir. Escopos e riscos mapeados em [08](08-integracao-instagram.md#escopos-futuros-comentários-e-mensagens) |
| **Responder mensagens diretas** | Janela de 24h da Meta e possível exigência de revisão do aplicativo mapeadas em [08](08-integracao-instagram.md#escopos-futuros-comentários-e-mensagens) |

**Um alerta que já vale saber:** receber aviso em tempo real de comentário e mensagem novos pode
exigir a revisão da Meta, que o MVP não precisa. Ainda não está confirmado; precisa ser verificado
antes de começar essa funcionalidade.

### Escolhas de produto (poderiam ser feitas, decidimos não fazer)

| Fora do escopo | Motivo |
|---|---|
| Múltiplos inquilinos / clientes isolados | É ferramenta interna. Ver [ADR 0002](adr/0002-single-tenant.md) |
| Papéis configuráveis pela tela | Permissões por usuário, de um catálogo fixo, bastam para um time pequeno. Ver [ADR 0015](adr/0015-super-admin-e-permissoes.md) |
| Permissões por conta do Instagram | As permissões são globais e todos veem todas as contas. Evolução possível se virar agência com clientes separados |
| Cobrança, planos, assinatura | Não há cliente pagante |
| Edição de imagem e vídeo dentro da ferramenta | O conteúdo chega pronto. Editor é outro produto |
| Geração de legenda por IA | O PostIt não gera texto. **Um assistente externo pode compor rascunhos** — o ChatGPT, por MCP —, e uma pessoa valida pela tela ([ADR 0029](adr/0029-assistente-por-mcp.md)); quem escreve é o assistente que a pessoa já usa |
| Aplicativo nativo (loja da Apple ou do Google) | O sistema web instalável na tela inicial (PWA), com notificação push, atende o uso previsto. Ver [ADR 0017](adr/0017-pwa-e-notificacoes-push.md) |
| Aviso por WhatsApp ou e-mail | O push resolve sem custo nem serviço externo. Evolução possível |
| Demografia do público (idade, cidade, gênero) | A versão simples das métricas da conta basta no MVP |
| Ver quem está editando a mesma postagem agora | O aviso de conflito na hora de salvar protege o trabalho; o indicador em tempo real fica para depois |

### Limitações herdadas da API oficial (não são escolha nossa)

Consequência direta de usar a API oficial da Meta via Instagram Login. Detalhamento e fontes em
[08 — Integração Instagram](08-integracao-instagram.md).

| Limitação | Impacto no produto |
|---|---|
| **Marcação de localização é impossível** | O campo `location_id` não existe nessa via da API, e o endpoint que descobriria o ID do local também não aceita nosso token. Não há contorno. Ver [ADR 0001](adr/0001-instagram-login-em-vez-de-facebook-login.md) |
| **Stories sem figurinhas** | Nada de enquete, link, localização, música ou caixa de perguntas. Só a mídia e menção a usuários sem sticker |
| **Sem marcação de produtos** | Recurso de loja não é acessível |
| **Sem busca de hashtags** | Não dá para pesquisar ou sugerir hashtags pela API |
| **Só contas profissionais** | A conta precisa ser Business ou Creator. Conta pessoal não publica pela API |
| **Só contas cadastradas no aplicativo** | Sem revisão da Meta, cada conta precisa ser adicionada como testadora e aceitar o convite antes de conectar |
| **Cota de 50 publicações por 24h** | Por conta. Suficiente para uso normal, mas o sistema precisa respeitar |
| **Sem edição depois de publicado** | A API não altera legenda de post já publicado. Errou, tem que apagar pelo app |

Essas limitações precisam aparecer **na interface, no momento da composição** — não adianta estar
só na documentação. Quem está montando um Story tem que ver ali que enquete não vai funcionar.

## Métricas de sucesso

O sistema está funcionando se:

1. **Confiabilidade** — 100% das postagens agendadas terminam em `PUBLICADO` ou em `FALHOU` com
   causa registrada e notificação. Nenhuma some, nenhuma duplica.
2. **Pontualidade** — a publicação sai em até 2 minutos do horário agendado, no caminho feliz.
3. **Autonomia** — o token da conta nunca expira por esquecimento; a renovação é automática.
4. **Diagnóstico** — quando falha, a mensagem de erro diz o que fazer, em português, sem exigir
   abrir a documentação da Meta.

## Glossário

Vocabulário do domínio. Estes são os termos usados no código, no banco e na interface — em
português, seguindo a convenção dos demais projetos.

| Termo | Significado |
|---|---|
| **Conta** | Uma conta de rede social conectada ao sistema (`Conta`). No MVP, sempre uma conta profissional do Instagram |
| **Rede** | A rede social de uma conta (`rede`). No MVP, só `INSTAGRAM` |
| **Postagem** | A unidade de trabalho: conteúdo + formato + horário + destino. Existe no nosso banco antes de existir no Instagram |
| **Formato** | Feed, reels ou stories — carrossel é o feed com 2 a 10 mídias (ADR 0024) |
| **Mídia** | Um arquivo (foto ou vídeo) armazenado no MinIO. Uma postagem tem uma ou várias |
| **Container** | Objeto temporário criado na API da Meta que representa a mídia preparada para publicar. Vive 24h. É o passo intermediário obrigatório |
| **Publicação** | O ato de transformar um container em post real. Irreversível |
| **Marcação** | Menção a um usuário posicionada na foto (`user_tags`), com coordenadas x/y |
| **Colaborador** | Perfil convidado a coautorar a postagem. Precisa aceitar. Máximo de 3 |
| **Cota** | O limite de publicações por conta numa janela móvel de 24 horas |
| **Despachante** | A tarefa que, a cada minuto, procura postagens cujo horário chegou e as entrega ao worker. Ver [09](09-motor-agendamento.md) |
| **Telas** ou **web** | O aplicativo Next.js que o usuário acessa. É a única parte que o navegador enxerga |
| **API** | O servidor NestJS com as regras de negócio. Só as telas conversam com ela, por dentro do servidor |
| **BFF** | *Backend for frontend*: o papel do Next de ser a porta de entrada e intermediar tudo entre navegador e API. Ver [ADR 0010](adr/0010-monorepo-next-nest-bff.md) |
| **Worker** | O processo que executa publicações, coleta métricas e renova tokens. Usa o mesmo código da API, mas não atende requisições |
| **Sessão** | O login ativo de um usuário na ferramenta, guardado num cookie seguro. Expira após 7 dias sem uso ou 30 dias de qualquer forma. Não confundir com a conexão de uma conta do Instagram |
| **Verificação em duas etapas** | O código de 6 dígitos do aplicativo autenticador, exigido em todo login, além da senha. Obrigatória para todos |
| **Código de recuperação** | Senha de uso único, entregue no cadastro da verificação em duas etapas, para entrar sem o celular |
| **Permissão** | O que um usuário pode fazer além de ver: editar, aprovar, aprovar a própria postagem, agendar, gerenciar contas. Atribuída usuário a usuário |
| **Super admin** | Usuário com todas as permissões e acesso à área de administração: usuários, permissões, tentativas de acesso, auditoria. Sempre existe ao menos um |
| **Auditoria** | Registro de quem fez cada ação administrativa, sobre quem e quando |
| **Fila** | Lista de tarefas esperando execução, guardada no Postgres pelo pg-boss. Ver [ADR 0008](adr/0008-pg-boss-em-vez-de-bullmq.md) |
| **Comentário interno** | Conversa da equipe sobre uma postagem durante a aprovação. Não é comentário do Instagram |
| **Notificação** | Aviso para uma pessoa sobre algo que precisa dela. Aparece no sino e, se ativado, como push |
| **Push** | Notificação que chega ao aparelho mesmo com o sistema fechado. Não carrega detalhe sensível: só um título genérico e o link |
| **App instalável (PWA)** | O próprio sistema web adicionado à tela inicial do celular ou do computador, abrindo como aplicativo. Não passa por loja |
| **Versão da postagem** | Número que sobe a cada alteração feita por uma pessoa. É como o sistema percebe que alguém salvou antes de você |
| **Métricas da conta** | Números do perfil inteiro, dia a dia (seguidores, alcance, interações), diferentes das métricas de uma postagem |
| **Ambiente** | Uma cópia separada do sistema: **local** (no seu computador, onde tudo é testado) e **produção** (a de verdade, na VPS). Não há homologação. Ver [14](14-ambientes-e-desenvolvimento.md) |
| **Conta de testes** | Conta profissional do Instagram criada só para testar publicação fora da produção |
| **PostIt** | Nome provisório do produto, para uso interno. Ver [ADR 0016](adr/0016-nome-do-produto.md) antes de qualquer uso externo |

## Documentos relacionados

- [02 — Requisitos](02-requisitos.md) — o que exatamente o sistema faz
- [04 — Jornada do Usuário](04-jornada-usuario.md) — como se usa na prática
- [12 — Roadmap](12-roadmap.md) — em que ordem isso é construído
- [13 — Telas e Navegação](13-telas-e-navegacao.md) — o que existe em cada tela, no computador e no celular
