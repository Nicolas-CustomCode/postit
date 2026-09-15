# ADR 0010 — Monorepo com Next como BFF e NestJS como API e worker

**Data:** 2026-09-14 · **Status:** aceito

## Contexto

A primeira versão da arquitetura previa **um único aplicativo Next.js**, com as telas e as rotas de
API juntas, mais um worker separado. Era a opção mais simples para o MVP.

Dois fatos mudaram a avaliação:

- **O backend vai crescer.** Depois do MVP estão planejadas outras redes sociais, respostas a
  comentários, mensagens diretas e webhooks ([ADR 0009](0009-preparacao-multi-rede.md)). É muita
  lógica de servidor para viver em rotas soltas do Next
- **O NestJS já é conhecido.** Ele é usado em `alivio-crm`, `nossobuncker` e
  `agente-evoapi-lupobalneario`

Os dois monorepos existentes resolvem a ligação entre telas e API de formas opostas:

| | `alivio-crm` | `nossobuncker` |
|---|---|---|
| Quem o navegador chama | A API, direto | Só o Next |
| Autenticação | JWT guardado em memória no navegador, refresh em cookie | Sessão em cookie gravado pelo Next |
| CORS | Necessário | Não existe |
| API na internet | Exposta | Presa a `127.0.0.1` |
| Worker | App separado, que duplica o acesso ao banco | Não tem; tarefas agendadas rodam dentro da API |

O `nossobuncker` é o modelo mais novo, e sua documentação o descreve como correção de problemas do
modelo anterior.

## Decisão

**Monorepo com npm workspaces e Turborepo:**

```
apps/web          Next.js — telas e BFF
apps/api          NestJS com Fastify — dois pontos de entrada:
  src/main.ts       processo HTTP      (postit-api)
  src/worker.ts     processo de filas  (postit-worker)
packages/shared   schemas zod, tipos de resposta, enums, especificações de mídia
packages/database schema Prisma, migrations, seed
```

### 1. Next como BFF, API invisível para a internet

BFF significa *backend for frontend*: o Next é o único ponto de contato do navegador, e é ele quem
conversa com a API, por dentro do servidor.

- O navegador **só fala com o Next**
- O Next chama a API em `127.0.0.1`, enviando a sessão do usuário, uma chave interna e o IP e o
  navegador de origem
- O proxy reverso manda **o domínio inteiro** para o Next. A API não tem nome público
- Sem CORS, sem URL de API exposta no navegador

### 2. API e worker compartilham o mesmo código Nest

O mesmo projeto Nest é iniciado de dois jeitos:

- `main.ts` sobe o servidor HTTP que atende o Next
- `worker.ts` sobe um contexto de aplicação sem HTTP (`NestFactory.createApplicationContext`) que
  executa as filas do pg-boss

Os dois reaproveitam os mesmos módulos — banco, integração com o Instagram, regras de domínio — sem
copiar código e sem pacote intermediário.

### 3. Só o processo worker publica

O módulo de publicação e o módulo de filas são importados **apenas** pelo módulo do worker. O
processo HTTP da API não tem acesso a esse código, e as telas muito menos. Um teste de arquitetura
verifica essa fronteira.

### 4. Contrato compartilhado em zod

Schemas de entrada, tipos de resposta e especificações de mídia ficam em `packages/shared`. A API
valida com esses schemas; o Next usa os mesmos para dar retorno imediato nos formulários. As respostas
da API usam tipos do pacote compartilhado, **nunca** tipos gerados pelo Prisma.

## Consequências

### Positivas

- **Fronteiras garantidas pela estrutura.** A tela não consegue chamar a Meta; o processo HTTP não
  consegue publicar
- **Superfície de ataque menor.** A API nunca recebe requisição direta da internet
- **Sem código duplicado** entre API e worker — uma dor registrada no `alivio-crm`
- **Trabalho pesado fora do processo HTTP** — uma dor registrada no `nossobuncker`, onde tarefas
  agendadas dentro da API impedem rodar mais de uma instância
- **Regras escritas uma vez só**, em zod, valendo na tela e na API
- **Backend organizado em módulos**, preparado para crescer

### Negativas

- **Mais peças:** monorepo, Turborepo, três processos no PM2, dois builds
- **Toda leitura e escrita passa por HTTP interno.** Mais código de chamada e de tratamento de erro
  do que rotas no próprio Next
- **Primeira entrega mais lenta.** A fundação (Fase 0) fica maior
- **Worker e API precisam ser implantados juntos**, já que compartilham o código. Aceitável: é um
  deploy só

## Alternativas consideradas

**Next sozinho, com rotas de API.** Era a decisão anterior. Mais rápido para o MVP, mas empurra a
organização do backend para o momento em que ele já estiver grande.

**Navegador chamando a API direto, como no `alivio-crm`.** Exige CORS, token acessível ao JavaScript
do navegador e API exposta na internet. Mais superfície de ataque, sem benefício para um painel que é
o único cliente da API.

**Worker como app separado, como no `alivio-crm`.** Isola mais, porém duplica acesso a banco e
integrações. No `alivio-crm`, o worker contorna isso pedindo à API por HTTP que faça o trabalho —
e uma publicação de vídeo leva minutos, tempo demais para ficar pendurado numa requisição.

**Tarefas agendadas dentro do processo da API, como no `nossobuncker`.** Mais simples, mas mistura
publicação demorada com atendimento de telas, e a regra "só um processo publica" deixaria de ser
garantida pela estrutura.

## Reversibilidade

**Média.** Separar o worker num app próprio no futuro é mecânico: os módulos já são independentes.
Voltar para um Next sozinho exigiria reescrever a camada de API — improvável de fazer sentido.
