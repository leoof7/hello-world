// Ler texto de uma imagem, no aparelho.
//
// Existe para um fluxo só: você tira um print da central de notificações do
// celular, com as compras do dia, e o app transforma aquilo em lançamentos.
// Digitar gasto a gasto é o motivo número um de largar um app de finanças —
// não porque é difícil, mas porque é toda vez.
//
// Três decisões que valem ficar escritas:
//
// 1. O motor é baixado só quando alguém usa, nunca no pré-cache. São 9 MB.
//    No `ARQUIVOS` do service worker, toda instalação pagaria isso antes da
//    primeira tela, e o app que abre em 267 ms passaria minutos numa rede
//    ruim. Aqui, quem nunca tira print nunca baixa nada.
//
// 2. Os arquivos moram em `vendor/`, não num CDN. O Tesseract busca de um CDN
//    por padrão, e isso entregaria a um servidor de terceiro o seu IP e a hora
//    em que você foi lançar um gasto. A imagem nunca sairia do aparelho de
//    qualquer jeito — mas o Zero promete que nada sai, e "nada" não tem
//    asterisco.
//
// 3. A imagem é reduzida e binarizada antes de entrar. Print de celular vem
//    com 3x de densidade e fundo escuro; o Tesseract lê muito melhor um preto
//    no branco em ~1600px de largura do que o original enorme e cinzento.

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;

/** Tamanho aproximado do download, para a tela poder avisar antes. */
export const TAMANHO_MB = 9;

let motor = null;      // Promise do worker, uma vez só por sessão
let jaBaixou = null;   // Promise<boolean> — o cache já tem tudo?

/**
 * O motor já está no cache do aparelho?
 *
 * Serve para a tela decidir entre "Ler print" e "Baixar leitor (9 MB)". Não
 * pergunta à rede: `caches.match` responde do cache do service worker, então
 * a resposta é instantânea e vale offline.
 */
export async function jaBaixado() {
  if (jaBaixou) return jaBaixou;
  jaBaixou = (async () => {
    if (!('caches' in self)) return false;
    try {
      const achado = await caches.match(`${BASE}lang/por.traineddata.gz`);
      return !!achado;
    } catch {
      return false;
    }
  })();
  return jaBaixou;
}

/**
 * Lê o texto de uma imagem.
 *
 * `aoAndar` recebe um número de 0 a 1 — baixar 9 MB numa rede de celular leva
 * tempo, e barra parada é indistinguível de app travado.
 *
 * Devolve o texto puro. Quem interpreta é `core/notificacao.js`; aqui só se lê.
 */
export async function lerImagem(arquivoOuBlob, aoAndar = () => {}) {
  const worker = await ligarMotor(aoAndar);
  const imagem = await preparar(arquivoOuBlob);
  aoAndar(0.9);
  const { data } = await worker.recognize(imagem);
  aoAndar(1);
  return data?.text || '';
}

/** Solta o motor da memória. O worker segura dezenas de MB. */
export async function desligarMotor() {
  if (!motor) return;
  try {
    const worker = await motor;
    await worker.terminate();
  } catch { /* já morreu, tudo bem */ }
  motor = null;
}

async function ligarMotor(aoAndar) {
  if (motor) return motor;

  motor = (async () => {
    // O build ESM do Tesseract exporta um default só — o objeto inteiro — e
    // não named exports. Desestruturar `createWorker` direto do módulo dá
    // "não é uma função" na primeira chamada, e só ali.
    const mod = await import(`${BASE}tesseract.esm.min.js`);
    const { createWorker } = mod.default || mod;

    const worker = await createWorker('por', 1, {
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}core/`,
      langPath: `${BASE}lang/`,
      // O modelo já vem descompactado do nosso servidor? Não: o arquivo é .gz
      // e o Tesseract descompacta sozinho. Dizer o contrário faz ele procurar
      // um `.traineddata` que não existe aqui.
      gzip: true,
      logger: (m) => {
        // O andamento vem em duas fases — baixar e reconhecer. A primeira é a
        // longa, então ela fica com a maior parte da barra.
        if (typeof m?.progress !== 'number') return;
        if (m.status === 'recognizing text') aoAndar(0.9 + m.progress * 0.1);
        else aoAndar(Math.min(0.88, m.progress * 0.88));
      },
    });

    // Notificação de banco é uma linha por vez, com valor e estabelecimento.
    // O modo padrão procura blocos de parágrafo e junta linhas que não têm
    // nada a ver uma com a outra — e aí "R$ 45,90" gruda no nome do app da
    // notificação de baixo. PSM 6 lê como bloco de linhas uniformes.
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    return worker;
  })();

  try {
    return await motor;
  } catch (e) {
    motor = null;  // deixa tentar de novo; rede cai, e não é culpa de ninguém
    throw e;
  }
}

/**
 * Prepara o print para leitura.
 *
 * Reduz para 1600px de largura, tira a cor e joga o contraste no talo. Print
 * de iPhone no tema escuro é texto branco em fundo quase preto, com sombra e
 * transparência por cima do papel de parede — o Tesseract erra bastante nisso
 * e acerta quase tudo depois de virar preto no branco.
 *
 * O limiar é a média da imagem, não um número fixo: fixo funciona no tema
 * escuro e apaga o texto inteiro no tema claro.
 */
async function preparar(arquivo) {
  const bitmap = await paraBitmap(arquivo);
  const largura = Math.min(1600, bitmap.width);
  const escala = largura / bitmap.width;
  const altura = Math.round(bitmap.height * escala);

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();

  const dados = ctx.getImageData(0, 0, largura, altura);
  const px = dados.data;

  let soma = 0;
  const cinzas = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    // Pesos de luminância: o olho não vê os três canais igual, e média simples
    // some com texto azul sobre fundo cinza.
    const c = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) | 0;
    cinzas[j] = c;
    soma += c;
  }
  const media = soma / cinzas.length;
  // Tema escuro: o fundo é a maior parte da imagem e é escuro, então a média
  // fica baixa e o texto claro precisa virar preto. Tema claro, o contrário.
  const inverter = media < 128;

  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const claro = cinzas[j] > media;
    const preto = inverter ? claro : !claro;
    const v = preto ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(dados, 0, 0);

  return tela;
}

async function paraBitmap(arquivo) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(arquivo);
  // Safari antigo não tem createImageBitmap para Blob. O caminho pela <img>
  // funciona em todo lugar e custa um objeto de URL.
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = () => erro(new Error('não consegui abrir essa imagem'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
