# 02 — Requisitos

Requisitos funcionais (`RF`) e não-funcionais (`RNF`), cada um com critério de aceite verificável.
A numeração é estável: uma vez atribuída, não se reaproveita. Requisito removido fica riscado com
a justificativa, nunca desaparece.

Convenções de prioridade:
- **[MVP]** — obrigatório para a primeira versão utilizável
- **[Depois]** — planejado, fora do MVP

---

## Módulo A — Contas

### RF-A01 — Conectar conta do Instagram **[MVP]**
O usuário inicia a conexão de uma conta profissional do Instagram pelo fluxo OAuth do Instagram
Login, autoriza os escopos solicitados e a conta passa a constar no sistema. **Várias contas podem
ser conectadas.**

**Aceite:** ao concluir o fluxo, existe um registro `Conta` com `rede` igual a `INSTAGRAM`,
`idExterno`, `username`, token de longa duração cifrado e data de expiração preenchida. A conta
aparece na listagem. Conectar uma segunda conta não afeta a primeira.

### RF-A02 — Recusar conta não profissional **[MVP]**
Se a conta autorizada não for Business ou Creator, o sistema recusa a conexão com mensagem
explicando o motivo e como converter a conta.

**Aceite:** conta pessoal não é persistida; a tela mostra orientação em português, não um erro cru
da Meta.

### RF-A03 — Renovar token automaticamente **[MVP]**
O sistema renova o token de longa duração antes da expiração, sem intervenção humana.

**Aceite:** um token com mais de 30 dias de idade e ainda válido é renovado pela tarefa
`renovar-tokens-instagram`; o novo `tokenExpiraEm` é gravado.

### RF-A04 — Alertar token em risco **[MVP]**
Se a renovação falhar e o token estiver a menos de 7 dias da expiração, o sistema sinaliza a conta
como em risco no painel de saúde.

**Aceite:** a conta aparece destacada; postagens agendadas para depois da expiração exibem aviso.

### RF-A05 — Desconectar conta **[MVP]**
O usuário remove uma conta do sistema.

**Aceite:** o token é apagado do banco, não apenas marcado como inativo. Postagens já publicadas
mantêm o histórico; postagens agendadas para aquela conta são canceladas com motivo registrado.

### RF-A06 — Definir fuso horário da conta **[MVP]**
Cada conta tem um fuso horário próprio, usado para exibir e interpretar horários de agendamento.

**Aceite:** agendar "10:00" numa conta em `America/Sao_Paulo` e noutra em `Europe/Lisbon` produz
instantes UTC diferentes.

### RF-A07 — Exibir cota restante **[MVP]**
O sistema mostra quantas publicações ainda cabem na janela de 24h de cada conta.

**Aceite:** o painel exibe consumo e total. Se a fonte oficial não estiver disponível, o sistema
usa a própria contagem interna das últimas 24h e sinaliza que é estimativa.

### RF-A08 — Orientar o cadastro da conta no aplicativo Meta **[MVP]**
Antes de conectar, cada conta precisa estar cadastrada como Instagram Tester no aplicativo Meta e ter
aceitado o convite. O sistema explica esse passo e reconhece quando ele não foi feito.

**Aceite:** a tela de conectar conta mostra os dois passos prévios com link para o passo a passo de
[08](08-integracao-instagram.md#cada-conta-precisa-ser-cadastrada-no-aplicativo). Quando a
autorização falha por conta não cadastrada, a mensagem orienta o cadastro em vez de exibir o erro
cru da Meta.

### RF-A09 — Trabalhar numa conta ativa **[MVP]**
O usuário escolhe, num seletor na barra lateral (no celular, no topo da tela), a conta do Instagram em que vai
trabalhar. Calendário, postagens, composição e métricas passam a mostrar e criar **só dessa conta**, sem pedir a
conta de novo a cada ação.

**Aceite:** (1) trocar a conta no seletor troca calendário, lista de postagens e métricas, sem outra escolha;
(2) uma postagem criada nasce na conta ativa, e a tela de composição mostra qual é; (3) ao entrar de novo, o
sistema abre na última conta usada; (4) duas abas podem ficar em contas diferentes sem que uma interfira na
outra; (5) um link para postagem de outra conta abre com essa outra conta ativa, nunca misturando as duas;
(6) sem nenhuma conta conectada, as telas da conta orientam a conectar a primeira. Ver
[13 — Conta ativa](13-telas-e-navegacao.md#conta-ativa).

---

## Módulo B — Mídia

### RF-B01 — Enviar arquivo **[MVP]**
O usuário envia foto ou vídeo, que é armazenado e fica disponível para uso em postagens. O arquivo vai
direto do navegador ao armazenamento, com permissão assinada pela API
([ADR 0012](adr/0012-upload-direto-minio.md)).

**Aceite:** o envio mostra progresso real; um vídeo de 300 MB é enviado sem passar pelo Next nem pela
API. Depois de validado, o arquivo está em `publicas/` com nome imprevisível e existe registro `Midia`
com dimensões, duração (se vídeo), tamanho, mime e hash. Envio sem permissão assinada, ou acima do
tamanho autorizado, é recusado pelo armazenamento.

### RF-B02 — Validar a mídia no envio **[MVP]**
No momento do envio, o sistema verifica formato, tamanho, proporção, duração e codec contra as
especificações da Meta e recusa o que não passa.

**Aceite:** um PNG, um JPEG de 12 MB, uma imagem 2:1 ou um vídeo de 2 segundos são recusados **no
envio**, com mensagem dizendo qual regra foi violada e qual é o limite. Nenhuma cota é consumida. O que
dá para conferir sem abrir o arquivo — tipo e tamanho — a tela confere antes de enviar; o resto a API
confere logo após o envio. **Arquivo recusado é apagado do armazenamento e nunca fica acessível
publicamente.**

### RF-B03 — Validar por formato de destino **[MVP]**
A mesma mídia pode ser válida para um formato e inválida para outro. A validação final considera o
formato escolhido na postagem.

**Aceite:** um vídeo de 5 minutos é aceito para Reels e recusado para Stories (limite de 60s), com
a mensagem certa em cada caso.

### RF-B04 — Reaproveitar mídia **[MVP]**
Uma mídia já enviada pode ser usada em mais de uma postagem.

**Aceite:** apagar uma postagem não apaga a mídia se outra postagem ainda a referencia.

### RF-B05 — Texto alternativo **[MVP]**
O usuário informa texto alternativo para imagens, por acessibilidade.

**Aceite:** o campo aceita até 1000 caracteres e é enviado à Meta na criação do container de imagem.

### RF-B06 — Normalizar mídia automaticamente **[Depois]**
Converter arquivos fora da especificação em vez de recusar: PNG para JPEG, recodificar vídeo,
mover o átomo `moov` para o início.

**Aceite:** um PNG enviado é convertido e aceito, com aviso de que houve conversão.

---

## Módulo C — Composição

### RF-C01 — Criar postagem **[MVP]**
O usuário cria uma postagem na conta ativa (RF-A09), escolhendo formato, mídia e legenda.

**Aceite:** a postagem nasce em `RASCUNHO`. Nenhuma chamada à Meta acontece nesse momento.

### RF-C02 — Formatos suportados **[MVP]**
Feed imagem, feed vídeo, carrossel, reels e stories.

**Aceite:** cada formato oferece exatamente os campos que a API aceita para ele, conforme a matriz
de parâmetros em [08](08-integracao-instagram.md).

### RF-C03 — Legenda com limites visíveis **[MVP]**
O editor mostra contagem de caracteres, de hashtags e de menções, com os limites da plataforma.

**Aceite:** o contador alerta ao passar de 2200 caracteres, 30 hashtags ou 20 menções, e impede o
agendamento enquanto estiver fora do limite.

### RF-C04 — Ordenar carrossel **[MVP]**
**Aceite:** a ordem é persistida e respeitada na publicação. Mínimo 2, máximo 10 itens, validado
antes de agendar.

### RF-C05 — Marcar pessoas na imagem **[MVP]**
O usuário marca perfis posicionando a marcação sobre a imagem.

**Aceite:** a marcação guarda `username` e coordenadas x/y entre 0.0 e 1.0. Em Stories as
coordenadas são opcionais.

### RF-C06 — Convidar colaboradores **[MVP]**
**Aceite:** o campo limita a 3 perfis e fica indisponível nos formatos que não aceitam.

### RF-C07 — Capa do Reels **[MVP]**
**Aceite:** define-se ou uma imagem de capa ou um instante do vídeo em milissegundos, nunca os
dois ao mesmo tempo na interface.

### RF-C08 — Escolher se o Reels aparece no feed **[MVP]**
**Aceite:** alternar entre "feed e aba Reels" ou "só aba Reels"; o valor vai no container.

### RF-C09 — Sinalizar conteúdo gerado por IA **[MVP]**
**Aceite:** a marcação é enviada à Meta na criação do container.

### RF-C10 — Pré-visualizar a postagem **[MVP]**
**Aceite:** a prévia mostra o recorte correto por formato e as marcações nas posições definidas.

### RF-C11 — Avisar sobre recursos indisponíveis **[MVP]**
**Aceite:** ao compor um Story, a tela informa que figurinhas, enquetes, links e música não são
publicáveis pela API. O aviso fica visível na composição, não escondido em ajuda.

### RF-C12 — Conflito de edição **[MVP]**
Duas pessoas podem abrir a mesma postagem ao mesmo tempo. Quem salvar por último não pode apagar, sem saber,
o que a outra salvou.

**Aceite:** cada postagem tem um número de versão. Toda alteração feita por usuário — conteúdo, agendamento,
aprovação — envia a versão que a tela carregou; se a postagem mudou nesse meio-tempo, a API recusa com "Esta
postagem foi alterada por Fulano às 14h32". A tela **mantém o que a pessoa digitou** e oferece "ver a versão
atual" e "descartar minhas alterações". Mudanças feitas pelo worker não geram conflito. Ver
[05](05-arquitetura.md#8-edição-simultânea).

---

## Módulo D — Agendamento

### RF-D01 — Agendar para data e hora **[MVP]**
**Aceite:** a postagem vai para `AGENDADO` com `publicarEm` gravado em UTC. Só é possível agendar
uma postagem `APROVADO`.

### RF-D02 — Publicar imediatamente **[MVP]**
**Aceite:** passa pelo mesmo caminho do worker, nunca por um atalho síncrono, garantindo o mesmo
tratamento de erro e idempotência.

### RF-D03 — Recusar horário no passado **[MVP]**
**Aceite:** agendamento para instante já passado é recusado na validação.

### RF-D04 — Reagendar **[MVP]**
**Aceite:** permitido apenas enquanto o status é `AGENDADO`. Em `PROCESSANDO` o campo fica
bloqueado — não se muda o horário de algo que já está sendo publicado.

### RF-D05 — Cancelar **[MVP]**
**Aceite:** postagem em `AGENDADO` ou `FALHOU` vai para `CANCELADO`. Postagem em `PUBLICADO` não
pode ser cancelada pelo sistema, porque a API não apaga posts.

### RF-D06 — Calendário visual **[MVP]**
**Aceite:** visão mensal e semanal, por conta, com cor por status e miniatura da mídia.

### RF-D07 — Arrastar para reagendar **[MVP]**
**Aceite:** o arraste respeita as regras do RF-D04; soltar num horário passado é recusado e o item
volta à posição original.

### RF-D08 — Prévia da grade do perfil **[MVP]**
**Aceite:** mostra feed e carrosséis em ordem cronológica de publicação. Stories e Reels marcados
como "só aba Reels" não entram na grade.

### RF-D09 — Adiar por cota **[MVP]**
**Aceite:** sem cota disponível, a postagem permanece em `AGENDADO`, o adiamento é registrado e o
usuário vê o motivo. Nova tentativa quando houver cota.

### RF-D10 — Sugestão de melhor horário **[Depois]**
Sugerir horários com base no histórico de desempenho.

---

## Módulo E — Aprovação

### RF-E01 — Enviar para revisão **[MVP]**
**Aceite:** `RASCUNHO` para `EM_REVISAO`. Postagem em revisão não pode ser agendada.

### RF-E02 — Aprovar **[MVP]**
**Aceite:** `EM_REVISAO` para `APROVADO`, registrando quem aprovou e quando. Exige `POSTAGEM_APROVAR`; se
quem aprova é o autor da postagem, exige também `POSTAGEM_APROVAR_PROPRIA` (RF-I04).

### RF-E03 — Rejeitar com motivo **[MVP]**
**Aceite:** volta para `RASCUNHO` com comentário obrigatório explicando o ajuste necessário.

### RF-E04 — Comentários internos **[MVP]**
**Aceite:** conversa por postagem, ordenada por data, com autor identificado, que sobrevive às
mudanças de status.

### RF-E05 — Invalidar aprovação ao editar **[MVP]**
**Aceite:** alterar legenda, mídia, marcações ou formato de uma postagem `APROVADO` ou `AGENDADO`
devolve o status para `RASCUNHO` e registra o motivo. Impede aprovar uma coisa e publicar outra.

### RF-E06 — Fila de pendências **[MVP]**
**Aceite:** existe uma visão do que aguarda revisão, ordenada pelo horário de publicação previsto,
o mais urgente primeiro.

---

## Módulo F — Publicação

### RF-F01 — Publicar no horário **[MVP]**
**Aceite:** no caminho feliz, a publicação ocorre em até 2 minutos do horário marcado.

### RF-F02 — Publicar em duas etapas **[MVP]**
Criar o container, aguardar ficar pronto, então publicar.

**Aceite:** o container é consultado no máximo 1 vez por minuto, por no máximo 5 minutos, conforme
a orientação da Meta. A publicação só ocorre com o container em estado final de pronto.

### RF-F03 — Registrar o resultado **[MVP]**
**Aceite:** ao publicar, grava-se o identificador da mídia no Instagram e o permalink; a postagem
vai para `PUBLICADO`.

### RF-F04 — Nunca publicar duas vezes **[MVP]**
**Aceite:** uma postagem com identificador de mídia já gravado jamais é publicada de novo, mesmo
que o job execute outra vez.

### RF-F05 — Repetir tentativa em erro recuperável **[MVP]**
**Aceite:** erros transitórios — limite momentâneo, indisponibilidade da Meta, container ainda
processando — geram nova tentativa com espera progressiva.

### RF-F06 — Parar em erro fatal **[MVP]**
**Aceite:** token inválido, mídia rejeitada ou conta restrita levam direto a `FALHOU`, sem gastar
tentativas em algo que não muda sozinho.

### RF-F07 — Falha exige decisão humana **[MVP]**
**Aceite:** esgotadas as tentativas, a postagem fica em `FALHOU` e não é publicada depois
automaticamente. Aparece destacada, com a causa em português e as ações disponíveis: reagendar,
corrigir ou cancelar.

### RF-F08 — Notificar falha **[MVP]**
**Aceite:** a falha gera uma notificação `PUBLICACAO_FALHOU`, que aparece no sino e chega por push a quem
ativou notificações — com o sistema fechado. Detalhes no Módulo J.

### RF-F09 — Trilha de auditoria **[MVP]**
**Aceite:** é possível reconstruir o histórico completo de uma publicação, incluindo o erro cru da
Meta, com o token omitido.

### RF-F10 — Upload resumível para vídeos grandes **[MVP]**
**Aceite:** vídeos são enviados pelo caminho de upload resumível quando o tamanho justifica.

### RF-F11 — Não começar a publicar com mais de 15 minutos de atraso **[MVP]**
Se o sistema estava fora do ar no horário marcado, a postagem não é publicada sozinha depois.

**Aceite:** uma postagem cujo horário passou há mais de 15 minutos, sem ter começado a ser
publicada, vai para `FALHOU` com a causa "sistema indisponível no horário" e espera decisão humana.
Retentativas de uma publicação que começou no horário não entram nessa regra. Ver
[09 — Atraso por indisponibilidade](09-motor-agendamento.md#atraso-por-indisponibilidade).

---

## Módulo G — Métricas

### RF-G01 — Coletar métricas automaticamente **[MVP]**
**Aceite:** após a publicação, as métricas são coletadas em T+1h, T+24h e T+7d.

### RF-G02 — Coletar Stories dentro da janela **[MVP]**
Métricas de Stories só existem por 24 horas.

**Aceite:** a coleta de um Story ocorre antes de 24h da publicação. Perder a janela significa
perder o dado para sempre, então esse job tem prioridade sobre os demais.

### RF-G03 — Métricas por formato **[MVP]**
**Aceite:** cada formato coleta o conjunto que a API oferece para ele, sem pedir métrica
inexistente, o que geraria erro.

### RF-G04 — Histórico de evolução **[MVP]**
**Aceite:** as coletas são guardadas como série temporal, não sobrescritas: dá para ver a evolução
entre T+1h e T+7d.

### RF-G05 — Painel de desempenho **[Depois]**
Comparação entre postagens por formato, horário e dia da semana.

### RF-G06 — Coletar métricas da conta **[MVP]**
Além das métricas por postagem, o sistema acompanha a conta como um todo.

**Aceite:** uma vez por dia, para cada conta conectada, o sistema coleta seguidores, contas seguidas e total
de mídias, e, por dia, alcance, visualizações, contas com interação, interações totais, novos seguidores e
deixaram de seguir, e toques em links do perfil. Coleta os últimos 3 dias a cada execução, porque a Meta pode
atrasar os números em até 48 horas. Guarda uma linha por conta e por dia, **indefinidamente** — a Meta só
guarda 90 dias, então coletar é o que cria o histórico. Ver
[08 — Métricas da conta](08-integracao-instagram.md#métricas-da-conta).

### RF-G07 — Ver a evolução da conta **[MVP]**
**Aceite:** a tela de métricas mostra a evolução diária da conta em gráfico, com filtro de período. Métrica
que a Meta não fornece — por exemplo, em contas com menos de 100 seguidores — aparece como indisponível, com a
explicação, e nunca como zero. Um aviso informa desde quando há dados coletados.

---

## Módulo H — Administração

### RF-H01 — Autenticação **[MVP]**
**Aceite:** o acesso exige login com senha **e** verificação em duas etapas (RF-H04). Não há cadastro
aberto; usuários são criados por comando no servidor (RF-H06). Sair da conta encerra a sessão
imediatamente — reusar o cookie antigo não funciona. A sessão expira após 7 dias sem uso e, de qualquer
forma, 30 dias depois de criada. Toda página e toda ação conferem a sessão no servidor, não só na
navegação. Depois de entrar, o usuário volta para onde estava, mas nunca para um endereço externo. Ver
[ADR 0013](adr/0013-autenticacao-com-duas-etapas.md).

### RF-H02 — Painel de saúde **[MVP]**
**Aceite:** uma tela mostra cota restante por conta, tokens perto de expirar, jobs falhos e
quantidade de tarefas com falha nas filas.

### RF-H03 — Reprocessar job falho **[MVP]**
**Aceite:** o administrador reenfileira manualmente uma publicação que falhou, após corrigir a
causa.

### RF-H04 — Verificação em duas etapas obrigatória **[MVP]**
Todo usuário entra com senha e código de 6 dígitos de um aplicativo autenticador.

**Aceite:** senha certa sem código **não** cria sessão. No primeiro login, o usuário cadastra o
aplicativo lendo um QR code, confirma com um código e recebe 10 códigos de recuperação, mostrados uma
única vez. O mesmo código não é aceito duas vezes. Um código de recuperação substitui o do aplicativo e
só vale uma vez. Gerar novos códigos de recuperação exige código do aplicativo e invalida os anteriores.

### RF-H05 — Bloqueio de tentativas repetidas **[MVP]**
Tentativas seguidas de senha ou código errados são freadas temporariamente.

**Aceite:** 10 falhas na mesma conta em 30 minutos bloqueiam a conta por 15 minutos; 20 falhas do mesmo
IP em 30 minutos bloqueiam o IP por 30 minutos; reincidência em 24 horas eleva o bloqueio para 60
minutos. A tela mostra até que horas. E-mail inexistente e senha errada recebem a mesma mensagem, no
mesmo tempo de resposta. Um login certo zera a contagem. Nenhum bloqueio é permanente.

### RF-H06 — Criação de usuário e redefinição de senha sem e-mail **[MVP]**
Como o sistema não envia e-mail, usuários e redefinições nascem de links de uso único. No dia a dia, quem
gera os links é o super admin, pela tela (RF-I02, RF-I06). Os comandos no servidor existem para
emergência e para criar o primeiro usuário.

**Aceite:** link de cadastro vale 7 dias; link de redefinição vale 24 horas e, ao ser usado, encerra todas
as sessões do usuário; resetar a verificação em duas etapas apaga o segredo e os códigos e encerra todas
as sessões. Link usado ou vencido não funciona. `admin:create --super-admin` cria o primeiro usuário já como
super admin. Trocar a senha pela tela exige a senha atual e um código do aplicativo, e encerra as outras
sessões.

### RF-H07 — Sessões ativas **[MVP]**
O usuário vê onde está logado e pode encerrar as outras sessões.

**Aceite:** a tela lista as sessões ativas com último uso, IP e navegador, destacando a atual. "Sair dos
outros dispositivos" encerra todas, menos a atual, imediatamente.

---

## Módulo I — Administração e permissões

Decisão completa em [ADR 0015](adr/0015-super-admin-e-permissoes.md).

### Permissões exigidas por requisito

Todo usuário autenticado **vê** calendário, postagens, acervo, métricas, contas conectadas e painel de
saúde, e gerencia o próprio perfil. **Agir** exige permissão:

| Permissão | Requisitos que ela libera |
|---|---|
| `POSTAGEM_EDITAR` | RF-B01 a RF-B05, RF-C01 a RF-C12, RF-E01, RF-E04 |
| `POSTAGEM_APROVAR` | RF-E02, RF-E03 — postagens de outros |
| `POSTAGEM_APROVAR_PROPRIA` | RF-E02 — a própria postagem, junto com `POSTAGEM_APROVAR` |
| `POSTAGEM_AGENDAR` | RF-D01, RF-D02, RF-D04, RF-D05, RF-D07, e as decisões de RF-F07 |
| `CONTA_GERENCIAR` | RF-A01, RF-A05, RF-A06 |
| Só super admin | RF-I02 a RF-I09 |

O super admin tem todas as permissões da tabela.

### RF-I01 — Super admin **[MVP]**
Existe um tipo de usuário com controle geral do projeto.

**Aceite:** o super admin tem todas as permissões do catálogo e é o único que acessa a área de
administração. O primeiro usuário é criado por `admin:create --super-admin`. Pode haver mais de um super
admin.

### RF-I02 — Gerenciar usuários pela tela **[MVP]**
**Aceite:** o super admin cria usuário informando nome e e-mail, e a tela mostra o link de cadastro para
copiar, uma única vez. Consegue desativar e reativar usuários, e promover ou remover super admin.
Desativar revoga todas as sessões do usuário na hora e impede novos logins.

### RF-I03 — Atribuir permissões por usuário **[MVP]**
**Aceite:** a tela mostra as cinco permissões como caixas marcáveis, com atalhos "Leitura", "Editor",
"Aprovador" e "Operador". `POSTAGEM_APROVAR_PROPRIA` e `CONTA_GERENCIAR` nunca são marcadas por atalho. A
mudança vale na próxima ação do usuário afetado, sem ele precisar sair e entrar. Tirar uma permissão não
desfaz aprovações nem agendamentos já feitos.

### RF-I04 — Recusar ação sem permissão **[MVP]**
**Aceite:** uma ação sem a permissão necessária é recusada pela API com "Você não tem permissão para esta
ação", mesmo que alguém chame a API sem passar pelos botões da tela. Os botões de ações não permitidas não
aparecem. Aprovar a própria postagem sem `POSTAGEM_APROVAR_PROPRIA` é recusado mesmo com
`POSTAGEM_APROVAR`.

### RF-I05 — Ver tentativas de acesso e bloqueios **[MVP]**
**Aceite:** o super admin vê a lista de tentativas de acesso com e-mail digitado, IP, resultado e horário,
filtrável por e-mail, IP, resultado e período; e vê os bloqueios ativos, com até quando valem. Pode liberar
um bloqueio manualmente, e a liberação registra quem liberou. A lista nunca mostra senhas nem códigos
digitados.

### RF-I06 — Recuperação de acesso pela tela **[MVP]**
**Aceite:** o super admin gera link de redefinição de senha para um usuário, reseta a verificação em duas
etapas de um usuário e encerra todas as sessões de um usuário. Cada ação tem o mesmo efeito do comando
equivalente no servidor.

### RF-I07 — Trilha de auditoria **[MVP]**
**Aceite:** toda ação administrativa — pela tela ou por comando — gera um registro com autor, origem, ação,
alvo, detalhes (como as permissões antes e depois), IP e horário. O super admin consulta a trilha com
filtros. Registros não contêm links, códigos, senhas nem tokens, e são guardados por 24 meses.

### RF-I08 — Confirmação recente para ações administrativas **[MVP]**
**Aceite:** qualquer ação que altera algo na área de administração exige que o último código do aplicativo
tenha sido digitado há menos de 15 minutos; se passou disso, a tela pede o código e só então executa.
Consultas não pedem. Códigos errados contam na proteção contra tentativas repetidas.

### RF-I09 — Nunca ficar sem super admin **[MVP]**
**Aceite:** desativar ou remover o último super admin ativo é recusado com explicação. Nenhum usuário
desativa a si mesmo. Se todos os super admins perderem o acesso, `admin:promote` no servidor torna alguém
super admin.

---

## Módulo J — Notificações

Decisão completa em [ADR 0017](adr/0017-pwa-e-notificacoes-push.md).

### RF-J01 — Sino de notificações **[MVP]**
**Aceite:** toda notificação aparece no sino dentro do sistema, para todos os destinatários, com ou sem push.
O sino mostra o número de não lidas; abrir uma notificação leva à tela correspondente e a marca como lida.

### RF-J02 — Notificação push **[MVP]**
**Aceite:** quem ativou notificações num aparelho recebe push com o sistema fechado. O push contém só um
título genérico e o link — **nunca** nome de conta, legenda, e-mail ou outro dado. Uma inscrição que o serviço
de push informa como inválida é removida. Push só é pedido por botão explícito no Perfil, nunca ao abrir o
sistema.

### RF-J03 — Destinatários por responsabilidade **[MVP]**
**Aceite:** cada tipo de notificação vai para quem é responsável por agir:

| Tipo | Recebe |
|---|---|
| `PUBLICACAO_FALHOU` | Quem agendou a postagem e quem tem `POSTAGEM_AGENDAR` |
| `AGUARDANDO_APROVACAO` | Quem tem `POSTAGEM_APROVAR` — o autor só se também tiver `POSTAGEM_APROVAR_PROPRIA` |
| `TOKEN_EXPIRANDO` | Quem tem `CONTA_GERENCIAR` e super admins |
| `CONTA_SEM_ACESSO` | Quem tem `CONTA_GERENCIAR` e super admins |
| `PROCESSAMENTO_TRAVADO` | Super admins |
| `CONTA_BLOQUEADA` | Super admins — o texto do push não inclui o e-mail bloqueado |

Os destinatários são calculados com as permissões do momento do envio. Super admins recebem tudo por padrão.

### RF-J04 — Preferências de notificação **[MVP]**
**Aceite:** no Perfil, cada pessoa liga ou desliga push por tipo de notificação. O sino continua recebendo
todas. As preferências valem para todos os aparelhos da pessoa.

### RF-J05 — Instalar como aplicativo **[MVP]**
**Aceite:** o PostIt pode ser instalado no celular e no computador, abrindo em tela própria, sem barra do
navegador. A tela de Perfil explica como instalar em cada sistema. Nenhum dado pessoal fica guardado no
aparelho: sem conexão, aparece só a página "sem conexão".

---

## Requisitos não-funcionais

### RNF-01 — Pontualidade
A publicação sai em até 2 minutos do horário agendado no caminho feliz. O despachante varre
postagens vencidas a cada minuto; a criação e o processamento do container consomem o resto.

**Verificação:** medir a diferença entre `publicarEm` e o instante da publicação numa amostra.

### RNF-02 — Idempotência
Nenhuma postagem é publicada duas vezes, sob nenhuma circunstância: reinício do worker, job
duplicado, timeout com sucesso do outro lado, ou operador clicando duas vezes.

**Verificação:** executar o job da mesma postagem duas vezes em paralelo produz uma única
publicação.

### RNF-03 — Durabilidade do agendamento
Uma postagem agendada não se perde se o worker morrer, o servidor reiniciar ou o banco for
restaurado de um backup. Postagens e filas vivem no mesmo Postgres, então nunca ficam
dessincronizadas.

**Verificação:** (1) matar o processo do worker com uma tarefa de publicação pendente, religar, e
confirmar que ela é executada uma única vez; (2) restaurar um backup com postagens agendadas e
confirmar que elas seguem a regra normal — publicadas no horário se ainda for futuro, ou `FALHOU`
pela regra de atraso do RF-F11.

### RNF-04 — Respeito à cota
O sistema nunca queima cota à toa e nunca ultrapassa o limite da conta.

**Verificação:** agendar mais postagens do que a cota permite resulta em adiamento ordenado, não
numa rajada de falhas.

### RNF-05 — Sobrevivência do token
Nenhuma conta para de funcionar por token expirado sem aviso prévio.

**Verificação:** o job de renovação roda diariamente; conta com token a menos de 7 dias da
expiração e sem renovação bem-sucedida aparece no painel de saúde.

### RNF-06 — Segredo nunca vaza
Tokens são cifrados em repouso e jamais aparecem em log, mensagem de erro, resposta de API ou tela.

**Verificação:** buscar por fragmento de token nos logs de uma execução completa não retorna nada.

### RNF-07 — Erro compreensível
Todo erro exibido ao usuário está em português e diz o que fazer. O erro cru da Meta fica na
auditoria, não na tela.

**Verificação:** cada código da tabela de erros de [08](08-integracao-instagram.md) tem tradução e
ação definida.

### RNF-08 — Correção de fuso horário
Horários são guardados em UTC e exibidos no fuso da conta. Transições de horário de verão não
deslocam agendamentos.

**Verificação:** agendar para uma data após uma transição e confirmar que o horário local exibido
é o esperado.

### RNF-09 — Disponibilidade da mídia
A URL da mídia permanece acessível publicamente desde a criação do container até a conclusão da
publicação.

**Verificação:** a política de expiração do objeto no MinIO é maior que a vida do container, que é
de 24 horas.

### RNF-10 — Observabilidade
Toda publicação deixa rastro suficiente para diagnóstico sem reproduzir o problema.

**Verificação:** dado o identificador de uma postagem, listar todas as tentativas, tempos e erros
sem recorrer a log não estruturado.

### RNF-11 — Dump e restauração
O banco pode ser copiado e restaurado por um procedimento testado, não apenas escrito. O dump é manual, feito antes
de toda versão com migration e guardado fora do servidor ([ADR 0021](adr/0021-dump-manual-e-sem-monitoramento-externo.md)).

**Verificação:** fazer um dump, restaurá-lo e confirmar integridade — item 8 da
[estreia em produção](10-infra-deploy.md#estreia-em-produção).

### RNF-12 — Retenção
Mídias de postagens publicadas há mais de 12 meses e sem outra referência podem ser removidas do
armazenamento; metadados e métricas permanecem.

### RNF-13 — Superfície mínima e acesso negado por padrão
A API não é alcançável pela internet, e nenhuma rota dela fica acessível sem uma decisão explícita de
acesso.

**Verificação:** (1) de fora do servidor, nenhum endereço responde como a API — na etapa 1, o serviço da API não
tem domínio nem porta publicada; (2) de dentro do
servidor, chamada à API sem a chave interna é recusada; (3) um teste automatizado percorre todas as
rotas da API e falha se alguma não declarar `@Public` ou `@AnyAuthenticated`. Ver
[ADR 0010](adr/0010-monorepo-next-nest-bff.md) e [ADR 0013](adr/0013-autenticacao-com-duas-etapas.md).

### RNF-14 — Proteção do navegador
As páginas dizem ao navegador o que ele pode executar e carregar, e o app não pode ser embutido em outro
site.

**Verificação:** (1) toda página responde com CSP contendo nonce, e o nonce muda a cada carregamento;
(2) um script inserido numa legenda não executa; (3) o app não abre dentro de um `<iframe>` em outro site;
(4) os cabeçalhos de segurança aparecem inclusive nas páginas de erro do Next; (5) as páginas não carregam nenhum
recurso de domínios da Meta. Ver [ADR 0014](adr/0014-csp-e-cabecalhos-de-seguranca.md).


### RNF-15 — Uso completo no celular
Tudo que se faz no computador se faz no celular: compor, enviar vídeo, marcar pessoas, reagendar, aprovar,
administrar.

**Verificação:** os testes de tela do Playwright rodam também em tamanho de celular; toda ação por gesto tem
alternativa por botão ou menu; áreas de toque têm no mínimo 44 × 44 px. Ver
[13 — Telas e navegação](13-telas-e-navegacao.md).

### RNF-16 — Isolamento de ambientes
Nenhum teste alcança uma conta real do Instagram.

**Verificação:** o ambiente local usa o app **PostIt Dev**, que só tem a conta de testes como
testadora; nenhum arquivo de ambiente fora da produção contém o segredo do app **PostIt**; a CI usa uma Meta
falsa e nunca a real. Ver [ADR 0018](adr/0018-ambientes-e-apps-meta-separados.md) e [ADR 0019](adr/0019-sem-homologacao.md).

---

## Rastreabilidade

Cada requisito funcional aparece em ao menos uma jornada de [04](04-jornada-usuario.md) e tem
entidade correspondente em [07](07-modelo-dados.md). A cobertura por fase está em
[12 — Roadmap](12-roadmap.md), onde cada fase declara quais requisitos entrega.
