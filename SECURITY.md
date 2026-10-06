# Segurança

O PostIt é uma ferramenta interna, mas o código é público. Se você encontrou uma vulnerabilidade, obrigado por avisar
— e por fazer isso **em particular**.

## Como relatar

**Não abra uma issue pública.** Use o relato privado do GitHub:

1. Aba **Security** deste repositório
2. **Report a vulnerability**

Descreva o que encontrou, como reproduzir e o impacto que você enxerga. O relato fica visível só para quem mantém o
projeto.

## O que esperar

- Confirmação de recebimento em até alguns dias úteis
- Uma avaliação do impacto e, se for o caso, a correção numa versão nova
- Crédito pela descoberta, se você quiser

## Escopo

- O código deste repositório: as telas (`apps/web`), a API e o worker (`apps/api`), os pacotes e a configuração de
  deploy
- A instalação em produção da empresa, só quando a falha está no código daqui

Fora do escopo: ataques de negação de serviço por volume, engenharia social, e falhas em serviços de terceiros — Meta,
GitHub, Easypanel — que devem ser relatadas a eles.

## Como o projeto se protege

As decisões de segurança estão em [docs/11-seguranca.md](docs/11-seguranca.md) e nos ADRs de [docs/adr](docs/adr).
Nenhum segredo entra no repositório; o `.env` fica só nos servidores.
