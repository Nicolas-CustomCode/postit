-- Banco separado para os testes da API, que recusam rodar em banco sem o sufixo _test.
-- Roda só na primeira subida do volume. Ver docs/15-qualidade-e-fluxo-de-trabalho.md.
CREATE DATABASE postit_test;
