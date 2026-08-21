# Redesign de agosto/2026

Origem: projeto **App de gestão financeira** no Claude Design
(`f0dbbb7c-dbe6-43c2-a218-9454c4903650`), arquivo `Zero App Redesign.dc.html`.

O arquivo de lá é um protótipo estático com valores fixos e um seletor de aba
próprio. Ele **não** foi copiado para dentro do app — as telas do Zero são
funções que montam HTML a partir dos dados, com `data-act` ligando cada botão
numa ação. Colar marcação por cima quebraria essa fiação sem erro no console,
que é o pior tipo de quebra: o botão simplesmente para de funcionar.

O que foi trazido:

- **paleta** — areia no claro, e uma versão quente derivada para o escuro.
  Entrou como o PADRÃO em `app.css`, não cravado nas telas, para o seletor de
  cor continuar valendo.
- **tipografia** — Lora nas frases-herói, Inter no resto. A monoespaçada saiu:
  a Inter tem algarismos tabulares de verdade, então `tabular-nums` alinha a
  coluna de dinheiro sem uma segunda fonte.
- **ordem do Painel** — saudação primeiro, dívida depois do primeiro respiro.
- **sub-abas na Saúde** — Geral, Compromissos, Tendência.
- **barra de abas** — branca e colada embaixo, sem a pílula flutuante.

O que NÃO foi trazido, de propósito:

- Os gráficos do protótipo são barras simples. Os do app (anéis, rosca, barra
  empilhada, termômetro) são melhores e ficaram, recolorados na paleta nova.
- O rótulo "Dívidas" da terceira aba virou "Compromissos": o conteúdo do
  protótipo ali é fixos + mínimos + livre, que é compromisso, não dívida.
