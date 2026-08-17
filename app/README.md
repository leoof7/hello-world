# limonada e sabores

App de vendas da barraca da Milena Gonçalves. Um arquivo HTML, sem servidor, sem
login e sem internet obrigatória — feito pra rodar direto no celular.

A identidade (areia, terracota, mar e a onda de espuma no topo) veio do cardápio
que ela já usa; os quatro sabores e as descrições são os dela.

## Como colocar no celular dela

1. Ative o GitHub Pages no repositório: **Settings › Pages › Branch: `master` /(root)**.
2. Abra no celular: `https://<usuario>.github.io/hello-world/app/`
3. No Chrome (Android): menu **⋮ › Adicionar à tela inicial**.
   No Safari (iPhone): botão de compartilhar **› Adicionar à Tela de Início**.
4. Pronto: abre em tela cheia, com ícone próprio, e funciona sem sinal.

## Como funciona

- **Vender** — toca no sabor pra somar, escolhe Dinheiro / Pix / Fiado. No dinheiro
  aparecem os botões de nota (exato, 10, 20, 50) e o **troco em letra grande**.
  Depois de confirmar, dá pra desfazer por alguns segundos.
- **Cardápio** — os quatro sabores da barraca, com preço, custo por copo e a
  descrição que ela escreveu. Dá pra editar, esconder (acabou o abacaxi hoje) e
  adicionar sabor novo.
- **Caixa** — resumo do dia (vendeu, copos, sobrou), divisão por forma de pagamento,
  lista das vendas, fiado em aberto e botão de copiar o resumo pra mandar no WhatsApp.
  Aqui também ficam a meta do dia e a chave Pix.
- **Compras** — o que os pais compraram de ingrediente, com valor e quem pagou.
  É o que transforma faturamento em lucro de verdade.

Os preços vieram de um chute razoável — é só editar em Cardápio com os valores reais.

## Onde ficam os dados

No próprio celular (`localStorage`), na chave `limonada-milena-v1`. Nada sai do
aparelho e nenhum dado de cliente é guardado. Trocou de celular ou limpou os dados
do navegador, começa do zero — por isso existe o "Copiar resumo do dia".

## Mexer no código

Tudo vive em `index.html` (HTML + CSS + JS, sem dependências). `sw.js` e
`manifest.webmanifest` são só o que faz ele instalar e abrir offline.
