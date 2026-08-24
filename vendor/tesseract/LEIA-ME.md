# Tesseract, empacotado aqui dentro

Estes arquivos não são meus. São o Tesseract.js 5.1.1 e o modelo de português,
copiados para dentro do repositório de propósito.

## Por que copiados, e não buscados de um CDN

O Tesseract.js, por padrão, baixa o núcleo e o modelo de idioma de um CDN na
primeira vez que roda. Isso quebraria duas promessas do Zero de uma vez:

1. **Offline.** O app abre e funciona sem rede. Um leitor que só funciona
   online seria a única parte do app que exige internet — e justo a que a
   pessoa usa na fila do mercado, onde o sinal é pior.
2. **Ninguém olhando.** Buscar um arquivo num CDN entrega o seu IP e a hora
   em que você foi lançar um gasto para um servidor que não é seu. O Zero não
   tem servidor por decisão de projeto; abrir uma exceção para o OCR seria
   dizer uma coisa na tela de privacidade e fazer outra.

A imagem em si nunca sai do aparelho em nenhum dos casos — o Tesseract roda
inteiro no navegador. O que estaria vazando é o fato de você estar usando.

## Por que estes arquivos, e não os outros

O pacote traz oito variantes do núcleo. Aqui ficam duas:

- `core/tesseract-core-simd-lstm.wasm.js` — para aparelhos com SIMD, que é
  todo iPhone em iOS 16.4 ou mais novo. É a rápida.
- `core/tesseract-core-lstm.wasm.js` — a reserva, para aparelho mais velho.
  Sem ela o app quebraria justamente no iPhone antigo, que é onde o Zero mais
  precisa funcionar.

O Tesseract escolhe sozinho qual das duas carregar; por isso as duas moram
aqui. As variantes `legacy` (sem `-lstm`) ficaram de fora: o modelo de idioma
que usamos é LSTM puro e elas nunca seriam carregadas.

`lang/por.traineddata.gz` é o modelo `4.0.0_best_int` — o melhor modelo, com
os pesos em inteiro. São 1,3 MB contra 6,4 MB do `best` em ponto flutuante,
com diferença de precisão que não aparece em notificação de banco: texto
limpo, alto contraste, fonte de sistema.

## O que NÃO fazer com estes arquivos

Não coloque nenhum deles em `ARQUIVOS`, no `sw.js`. São 9 MB: entrando no
pré-cache, toda instalação do app baixaria 9 MB antes de abrir pela primeira
vez, e a abertura em 267 ms viraria minutos no 3G. Eles são baixados na
primeira vez que alguém usa "ler print" e ficam no cache a partir dali — o
`fetch` do service worker guarda o que passa por ele.

## Licença

Tesseract.js e o núcleo são Apache-2.0. Ver `LICENSE-tesseract-core`.
Os modelos de idioma do projeto Tesseract também são Apache-2.0.

## Como atualizar

    npm pack tesseract.js@5
    npm pack tesseract.js-core@5
    npm pack @tesseract.js-data/por

e copiar de novo os seis arquivos listados acima. Depois `npm run versionar`,
porque o service worker carimba a versão pelo conteúdo.
