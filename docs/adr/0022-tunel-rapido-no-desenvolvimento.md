# ADR 0022 — Túnel rápido da Cloudflare no desenvolvimento

**Data:** 2026-09-15 · **Status:** aceito · **Substitui parcialmente:** [ADR 0018](0018-ambientes-e-apps-meta-separados.md), seção 2

## Contexto

O [ADR 0018](0018-ambientes-e-apps-meta-separados.md) escolheu o **túnel nomeado** da Cloudflare, com endereços
fixos, para o computador local receber o retorno do OAuth e a Meta baixar a mídia. Ele exige conta na Cloudflare e
um domínio com DNS gerenciado por ela.

O dono prefere o **túnel rápido** (TryCloudflare), já usado no `nossobuncker`: não exige conta nem domínio. O
endereço é aleatório e muda quando o processo do túnel para. A decisão é **deixar o túnel sempre ligado** e, se o
endereço mudar, atualizar à mão o que depende dele.

## Decisão

- **Dois túneis rápidos**, um para o Next e outro para o MinIO local, abertos por `npm run tunnel`. Cada túnel rápido
  aponta para uma porta só, por isso são dois
- O script mostra os dois endereços `https://….trycloudflare.com` e a lista do que atualizar
- **O túnel fica ligado o tempo todo** durante o desenvolvimento. Parar o processo, reiniciar o computador ou perder a
  conexão por muito tempo pode gerar endereços novos

### Quando o endereço mudar

1. No `.env`: `APP_URL`, `IG_REDIRECT_URI` e `MINIO_PUBLIC_URL`
2. No painel da Meta, app **PostIt Dev**: a URI de retorno do Instagram Login
3. `npm run media:setup`, que reaplica o CORS do MinIO com o novo endereço do app
4. Reiniciar `npm run dev`
5. Entrar de novo no PostIt — o cookie de sessão pertence ao endereço antigo
6. No celular: reinstalar o app e reativar as notificações, porque app instalado e inscrição de push também
   pertencem ao endereço

## Limites do túnel rápido

Segundo a [documentação da Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):

| Limite | Efeito no PostIt |
|---|---|
| *"Quick Tunnels are intended for testing and development only"* | Só no computador local. Produção não usa túnel |
| Até 200 requisições em andamento; acima disso, erro 429 | Folgado para uma pessoa desenvolvendo |
| Sem suporte a Server-Sent Events | O PostIt não usa SSE |
| *"We don't guarantee any SLA or uptime"* | Se cair, o endereço pode mudar: seguir a lista acima |

O limite de 100 MB por envio pela Cloudflare continua a validar (item V-24).

## Consequências

### Positivas

- Sem conta na Cloudflare e sem domínio para desenvolver
- Nada a configurar antes do primeiro `npm run tunnel`

### Negativas

- **Endereço muda** quando o túnel para: seis passos manuais para voltar a funcionar
- Enquanto está ligado, o PostIt local fica acessível pela internet o tempo todo. A verificação em duas etapas
  protege; o PostIt Dev só tem a conta de testes
- Dependência de um serviço gratuito sem garantia

## Alternativas consideradas

**Túnel nomeado** ([ADR 0018](0018-ambientes-e-apps-meta-separados.md)). Endereços fixos, sem passos manuais, mas
exige conta e domínio na Cloudflare. Continua sendo a evolução se as trocas de endereço incomodarem.

**Automatizar a troca** — o script reescrever o `.env` sozinho. Resolveria só um dos seis passos; a URI na Meta
continua manual.

## Reversibilidade

**Alta.** Trocar para túnel nomeado é mudar o script e os endereços no `.env` e na Meta.
