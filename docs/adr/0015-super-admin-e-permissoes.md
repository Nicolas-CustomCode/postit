# ADR 0015 — Super admin e permissões por usuário

**Data:** 2026-09-14 · **Status:** aceito · **Complementa:** [ADR 0002](0002-single-tenant.md) e
[ADR 0013](0013-autenticacao-com-duas-etapas.md)

## Contexto

Até aqui, todo usuário autenticado podia fazer tudo, inclusive aprovar a própria postagem
([ADR 0002](0002-single-tenant.md): "sem papéis"), e toda administração — criar usuário, redefinir senha,
resetar a verificação em duas etapas — acontecia por comando no servidor
([ADR 0013](0013-autenticacao-com-duas-etapas.md)). Não havia tela para ver tentativas de acesso.

Duas necessidades surgiram:

1. **Um super admin** que veja as tentativas de acesso e tenha controle geral, sem precisar de SSH
2. **Permissões por usuário**, para decidir quem aprova e quem agenda

### Viabilidade

Alta, e o custo é baixo nesta arquitetura:

- A API já **nega por padrão**: toda rota declara sua política de acesso. Acrescentar `@RequirePermission(...)` é
  estender um mecanismo que existe
- A sessão é **consultada no banco a cada requisição**. Tirar uma permissão vale na requisição seguinte, sem
  esperar o login expirar — com JWT isso seria difícil
- O custo estimado é uma fase média: duas tabelas novas, telas de administração, testes de permissão por
  rota e trilha de auditoria

### Utilidade

| Cenário | Valor das permissões | Valor do super admin |
|---|---|---|
| Uma pessoa só | Quase nenhum | **Alto**: administração sem SSH, visão das tentativas de acesso |
| Duas ou mais pessoas | **Alto** | Alto |

Com mais de uma pessoa, permissões entregam três proteções:

- **Menor privilégio:** cada um tem só o que precisa. Se a conta de um editor for invadida, o invasor não
  conecta nem desconecta contas do Instagram
- **Separação de funções:** quem escreve não é, necessariamente, quem publica
- **Colaboradores externos:** um cliente ou freelancer pode ter acesso limitado

### Três formas consideradas

| Forma | Como funciona | Avaliação |
|---|---|---|
| Papéis fixos | Editor, Aprovador, Administrador; um papel por usuário | Simples, mas rígido: a primeira exceção vira um papel novo |
| **Permissões por usuário** | Lista fixa de permissões, marcadas usuário a usuário | **Escolhida.** Flexível e simples para times pequenos |
| Papéis configuráveis | Papéis criados na tela, com suas permissões, atribuídos às pessoas — como o `RoleTag` do `vortex` | Excesso para uma ferramenta interna |

## Decisão

### 1. Catálogo fixo de permissões

Definido no código, num enum `Permissao`. Não é configurável pela tela — só a atribuição é.

| Permissão | Libera |
|---|---|
| `POSTAGEM_EDITAR` | Criar e editar rascunhos, enviar **e excluir** mídia, enviar para revisão, descartar rascunho, comentar |
| `POSTAGEM_APROVAR` | Aprovar e reprovar postagens **de outros** |
| `POSTAGEM_APROVAR_PROPRIA` | Aprovar a própria postagem. Só tem efeito junto com `POSTAGEM_APROVAR` |
| `POSTAGEM_AGENDAR` | Agendar, reagendar (inclusive arrastando no calendário), cancelar, publicar agora, decidir sobre postagem em `FALHOU` |
| `CONTA_GERENCIAR` | Conectar e desconectar contas do Instagram, alterar fuso horário |

**Sem permissão nenhuma**, todo usuário autenticado **vê** calendário, postagens, acervo, métricas, contas
conectadas e painel de saúde, e gerencia o próprio perfil — senha, códigos de recuperação, sessões.

**As permissões são globais:** valem para todas as contas do Instagram, e todo usuário enxerga todas as
contas.

**Atalhos na tela**, que só marcam caixas e não são guardados como papel:

| Atalho | Marca |
|---|---|
| Leitura | Nenhuma |
| Editor | `POSTAGEM_EDITAR` |
| Aprovador | `POSTAGEM_EDITAR`, `POSTAGEM_APROVAR` |
| Operador | `POSTAGEM_EDITAR`, `POSTAGEM_APROVAR`, `POSTAGEM_AGENDAR` |

`POSTAGEM_APROVAR_PROPRIA` e `CONTA_GERENCIAR` nunca entram em atalho: são marcadas uma a uma, de
propósito.

### 2. Super admin

Um atributo do usuário (`superAdmin`), **não** uma permissão do catálogo.

- **Tem todas as permissões** do catálogo automaticamente, inclusive aprovar a própria postagem
- **Acessa a área de administração:**

| Área | O que faz |
|---|---|
| Usuários | Criar (a tela mostra o link de cadastro para copiar), desativar, reativar, promover e remover super admin |
| Permissões | Marcar as permissões de cada usuário, com os atalhos |
| Tentativas de acesso | Listar tentativas e bloqueios com filtros por e-mail, IP, resultado e período; liberar um bloqueio manualmente |
| Recuperação | Gerar link de redefinição de senha, resetar a verificação em duas etapas, encerrar as sessões de outro usuário |
| Auditoria | Consultar a trilha de ações administrativas |

- **Pode haver vários super admins**, e **nunca zero**: o sistema recusa desativar ou remover o último super
  admin ativo. Ninguém desativa a si mesmo

### 3. Confirmação recente

Toda ação que **altera** algo na área de administração exige que o último código do aplicativo tenha sido
digitado **há menos de 15 minutos**. Se passou disso, a tela pede o código antes de continuar.

- O momento do último código fica em `Sessao.verificadoEm`, atualizado no login e em cada confirmação
- **Consultas** — listas, tentativas, auditoria — não pedem confirmação
- Códigos errados na confirmação contam na proteção contra tentativas repetidas

**Por quê:** a sessão do super admin é a mais valiosa do sistema. Se alguém sentar num computador esquecido
logado, consegue olhar, mas não consegue criar usuário, dar permissões nem resetar a segurança de ninguém sem
o celular.

### 4. Auditoria

Toda ação administrativa gera um registro em `EventoAuditoria`: quem fez, de onde (`WEB` ou `CLI`), qual ação,
sobre quem ou o quê, os detalhes — por exemplo, as permissões antes e depois —, o IP e quando. **Nunca contém
segredos**: nem links, nem códigos. Retenção de 24 meses.

### 5. Comandos no servidor viram emergência

| Comando | Uso |
|---|---|
| `admin:create --super-admin` | Criar o **primeiro** usuário, que já nasce super admin |
| `admin:promote -- --email` | **Novo.** Tornar alguém super admin quando todos os super admins perderam acesso |
| `admin:reset-password`, `admin:reset-2fa` | Continuam existindo, para quando não há super admin disponível |

No dia a dia, tudo isso é feito pela tela. Ações por comando também vão para a auditoria, com origem `CLI`.

### 6. Regras de comportamento

- **Autorização só na API.** O Next esconde botões conforme as permissões do usuário, mas isso é
  conveniência. Quem decide é sempre a API
- **Mudança de permissão vale na requisição seguinte.** As permissões são carregadas junto com a sessão, a
  cada requisição
- **Remover permissão não desfaz o passado.** Postagem já aprovada continua aprovada; já agendada continua
  agendada. O worker publica como sistema e não confere permissão de usuário
- **Desativar um usuário** revoga todas as sessões dele na hora e recusa novos logins. A mensagem "conta
  desativada" só aparece depois da senha certa, para não revelar a existência da conta
- **Sem permissão, a API responde 403** — "Você não tem permissão para esta ação". Como todo usuário vê todos
  os recursos, não há o que esconder com 404
- **Autoaprovação é regra do serviço de aprovação**, não da rota: depende de quem é o autor daquela postagem

### 7. Na API

Políticas de rota:

| Decorator | Quem passa |
|---|---|
| `@Public` | Qualquer um |
| `@AnyAuthenticated` | Qualquer usuário com sessão |
| `@RequirePermission(...)` | Usuário com a permissão, ou super admin |
| `@SuperAdmin` | Só super admin |
| `@RecentConfirmation` | Combinável com os anteriores: exige código há menos de 15 min |

Toda rota tem exatamente uma política principal. Rota sem política continua **recusada**.

- **Teste de política de rotas** atualizado para os novos decorators
- **Teste de matriz de permissões:** cada rota com `@RequirePermission` recusa usuário que não a tem
- **Teste da invariante do último super admin**
- **Sem biblioteca de autorização** (CASL e similares). Cinco permissões fixas cabem num enum e num guard

## Consequências

### Positivas

- Administração do dia a dia sem SSH
- Tentativas de acesso visíveis para quem precisa agir sobre elas
- Menor privilégio e separação de funções disponíveis quando o time crescer
- Toda mudança de acesso fica registrada
- Invasão da conta de um usuário comum tem alcance limitado

### Negativas

- **O super admin vira o alvo mais valioso.** Mitigado pela confirmação recente, pela verificação em duas
  etapas obrigatória e pela auditoria — mas continua sendo o ponto mais sensível
- **Mais telas e testes** na Fase 4
- **Cinco permissões podem não bastar** um dia. Adicionar uma nova exige código e migração — de propósito
- **Permissões globais não servem para agência** com clientes que não podem ver as contas uns dos outros.
  Restringir contas visíveis por usuário é a evolução natural, se necessária

## Alternativas consideradas

**Papéis fixos.** Rejeitado pela rigidez: a primeira pessoa que precise de "aprovar mas não agendar" força um
papel novo.

**Papéis configuráveis, como no `vortex`.** Rejeitado como excesso: exige telas de criar papéis, matriz de
permissões e regras de herança, para um time pequeno.

**Permissões diferentes por conta do Instagram.** Rejeitado agora: multiplica telas e regras. Registrado como
evolução possível.

**Super admin sem permissões operacionais**, precisando se dar permissões para operar. Rejeitado pela
cerimônia no dia a dia de um time pequeno.

## Reversibilidade

**Alta.** A autorização fica concentrada no guard de política e em `apps/api/src/admin/`. Evoluir para
contas visíveis por usuário acrescenta uma tabela sem desfazer nada.
