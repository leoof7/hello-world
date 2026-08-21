// "gastei oitenta e cinco reais no mercado ontem" → lançamento pronto.
//
// Tudo por regra e dicionário, sem IA e sem custo. A transcrição vem do
// próprio navegador (Web Speech API) ou do teclado — para o parser dá no mesmo.

import { toCents } from './money.js';
import { today, addDays, parts, iso, clampedDay } from './dates.js';
import { categorize } from './categorize.js';

const UNIDADES = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800,
  novecentos: 900,
};

const norm = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "oitenta e cinco" → 85. Devolve null se não achar número por extenso. */
export function wordsToNumber(text) {
  const palavras = norm(text).split(/\s+/).filter((w) => w in UNIDADES || w === 'e' || w === 'mil');
  if (!palavras.length) return null;

  let total = 0;
  let atual = 0;
  let achou = false;

  for (const p of palavras) {
    if (p === 'e') continue;
    if (p === 'mil') {
      atual = (atual || 1) * 1000;
      total += atual;
      atual = 0;
      achou = true;
      continue;
    }
    if (p in UNIDADES) {
      atual += UNIDADES[p];
      achou = true;
    }
  }
  return achou ? total + atual : null;
}

/** Acha o valor: dígitos vencem palavras. */
export function extractAmount(text) {
  const t = norm(text);

  // 1) formato com centavos: "45,90" ou "45.90" ou "1.234,56"
  const comCentavos = t.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/);
  if (comCentavos) return toCents(comCentavos[1]);

  // 2) "85 reais e 50 centavos"
  const reaisCentavos = t.match(/(\d+)\s*(?:reais|real|conto|pila)\s*e\s*(\d+)\s*centavos?/);
  if (reaisCentavos) return Number(reaisCentavos[1]) * 100 + Number(reaisCentavos[2]);

  // 3) inteiro simples: "85", "1200", "r$ 85"
  const inteiro = t.match(/(?:r\$\s*)?\b(\d{1,7})\b(?!\s*[x×])/);
  if (inteiro) return Number(inteiro[1]) * 100;

  // 4) por extenso
  const extenso = wordsToNumber(t);
  if (extenso) return extenso * 100;

  return null;
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** Acha a data: "ontem", "anteontem", "sexta", "dia 12", "12/08". */
export function extractDate(text, todayISO = today()) {
  const t = norm(text);

  if (/\bhoje\b/.test(t)) return todayISO;
  if (/\bontem\b/.test(t)) return addDays(todayISO, -1);
  if (/\banteontem\b/.test(t)) return addDays(todayISO, -2);

  const dm = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dm) {
    const { y } = parts(todayISO);
    const ano = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : y;
    return clampedDay(ano, Number(dm[2]), Number(dm[1]));
  }

  const diaDoMes = t.match(/\bdia\s+(\d{1,2})\b/);
  if (diaDoMes) {
    const { y, m } = parts(todayISO);
    const alvo = clampedDay(y, m, Number(diaDoMes[1]));
    return alvo <= todayISO ? alvo : clampedDay(y, m - 1 || 12, Number(diaDoMes[1]));
  }

  for (let i = 0; i < DIAS_SEMANA.length; i++) {
    if (new RegExp(`\\b${DIAS_SEMANA[i]}(?:-feira)?\\b`).test(t)) {
      const atual = new Date(Date.UTC(...isoToArgs(todayISO))).getUTCDay();
      let volta = atual - i;
      if (volta <= 0) volta += 7;
      return addDays(todayISO, -volta);
    }
  }

  return todayISO;
}

const isoToArgs = (s) => {
  const { y, m, d } = parts(s);
  return [y, m - 1, d];
};

/**
 * Apaga os trechos de data do texto.
 *
 * Cada extrator lê a frase inteira por conta própria, e o de valor pega o
 * PRIMEIRO número que encontra. Sem isto, "dia 12 gastei 50" virava R$ 12,00
 * e "12/08 paguei 200" virava R$ 12,00 — errado por quatro vezes, calado, num
 * app cuja função é dizer quanto você deve. A data é lida antes e apagada
 * daqui para a frente, para que só sobre número que é dinheiro.
 */
export function maskDates(text) {
  return String(text || '')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\bdia\s+\d{1,2}\b/gi, ' ');
}

/** Forma de pagamento. */
export function extractMethod(text) {
  const t = norm(text);
  if (/\bpix\b/.test(t)) return 'pix';
  if (/\b(credito|cartao de credito|no cartao)\b/.test(t)) return 'credit';
  if (/\b(debito|no debito)\b/.test(t)) return 'debit';
  if (/\b(dinheiro|especie|em cash)\b/.test(t)) return 'cash';
  if (/\b(boleto)\b/.test(t)) return 'boleto';
  return null;
}

/** Parcelamento: "em 3x", "em três vezes", "parcelado em 10". */
export function extractInstallments(text) {
  const t = norm(text);
  const digito = t.match(/\bem\s+(\d{1,2})\s*(?:x|vezes)\b/) || t.match(/\b(\d{1,2})\s*x\b/);
  if (digito) return Number(digito[1]);
  const extenso = t.match(/\bem\s+([a-z]+)\s+vezes\b/);
  if (extenso) {
    const n = wordsToNumber(extenso[1]);
    if (n && n <= 36) return n;
  }
  return 1;
}

/** Entrada ou saída. */
export function extractDirection(text) {
  const t = norm(text);
  if (/\b(recebi|entrou|caiu|ganhei|salario|reembolso|devolveram)\b/.test(t)) return 'in';
  return 'out';
}

/**
 * De onde saiu: acha o nome de uma conta ou cartão dentro da frase.
 *
 * Os nomes vêm do que a pessoa cadastrou, então isto já nasce personalizado —
 * "no nubank" só resolve para quem tem um Nubank. Nome com até dois caracteres
 * é ignorado de propósito: "PP" ou "Nu" casariam com meia frase.
 *
 * Cartão vence conta quando os dois batem, porque dizer o nome do banco numa
 * compra quase sempre quer dizer o cartão. A exceção é falar "débito": aí o
 * dinheiro sai da conta ligada àquele cartão, não da fatura.
 */
export function extractOrigin(text, { accounts = [], cards = [], method = null } = {}) {
  const t = norm(text);
  const achar = (lista) => lista.find((x) => {
    const nome = norm(x.name);
    return nome.length > 2 && t.includes(nome);
  });

  const cartao = achar(cards);
  if (cartao) {
    if (method === 'debit' && cartao.accountId) {
      return { accountId: cartao.accountId, cardId: null, matched: cartao.name };
    }
    return { accountId: null, cardId: cartao.id, matched: cartao.name };
  }

  const conta = achar(accounts);
  if (conta) return { accountId: conta.id, cardId: null, matched: conta.name };
  return null;
}

/**
 * "gastei 50 no mercado e 30 na farmácia" → duas frases.
 *
 * Divide só quando sobram DOIS valores de verdade. Sem essa trava, "50 no
 * mercado e farmácia" (uma compra) viraria dois lançamentos errados — e dois
 * lançamentos errados são piores que um.
 *
 * "oitenta e cinco" e "85 reais e 50 centavos" são um número só: o "e" deles é
 * protegido antes da divisão, senão o próprio valor seria partido ao meio.
 */
export function splitEntries(text) {
  const original = String(text || '');
  const numeros = Object.keys(UNIDADES).join('|');

  // Divide no "e" — menos quando o que vem depois é a segunda metade de um
  // número ("oitenta E cinco", "85 reais E 50 centavos"). Na dúvida não
  // divide: uma frase inteira mal lida é melhor que duas frases erradas.
  const separador = new RegExp(
    '\\s+e\\s+(?!(?:' + numeros + ')\\b|\\d+\\s*centavos?\\b)|\\s*;\\s*',
    'i',
  );

  const partes = original.split(separador).map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return [original];

  const comValor = partes.filter((p) => extractAmount(maskDates(p)) != null);
  return comValor.length >= 2 ? comValor : [original];
}

/** Sobra do texto depois de tirar valor, data e forma — vira a descrição. */
export function extractDescription(text, merchants = []) {
  const t = norm(text);
  for (const m of merchants) {
    const alvo = norm(m.match);
    if (alvo && t.includes(alvo)) return m.label || m.match;
  }

  let s = ' ' + t + ' ';
  s = s.replace(/\b(gastei|paguei|comprei|recebi|entrou|caiu|ganhei|foi|no|na|em|de|do|da|com|por|reais?|conto|pila|centavos?)\b/g, ' ');
  s = s.replace(/\b(hoje|ontem|anteontem|dia)\b/g, ' ');
  s = s.replace(new RegExp(`\\b(${DIAS_SEMANA.join('|')})(-feira)?\\b`, 'g'), ' ');
  s = s.replace(/\b(pix|credito|debito|dinheiro|boleto|cartao)\b/g, ' ');
  s = s.replace(/\d+[\d.,]*\s*(x|vezes)?/g, ' ');
  s = s.replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|e)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return null;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Interpreta a frase inteira.
 * Devolve null em amountCents quando não achou valor — aí a UI pergunta.
 *
 * A categoria NÃO é decidida aqui: quem decide é `categorize`, o mesmo caminho
 * que o extrato importado usa. Antes esta função tinha a própria busca no
 * dicionário, pior e paralela — só olhava o dicionário embutido e ignorava
 * regra e memória. Resultado: você podia corrigir "Zaffari → Mercado" na
 * Revisão cinquenta vezes que a frase falada continuava sem saber. Agora o que
 * você ensina uma vez vale para os dois caminhos.
 */
export function parseEntry(text, { todayISO = today(), merchants = [], rules = [], memory = {}, accounts = [], cards = [] } = {}) {
  const date = extractDate(text, todayISO);
  // A data sai de cena antes do valor: senão "dia 12 gastei 50" vira R$ 12.
  const semData = maskDates(text);

  const amountCents = extractAmount(semData);
  const direction = extractDirection(text);
  const method = extractMethod(text);
  const count = extractInstallments(text);
  const origem = extractOrigin(text, { accounts, cards, method });

  // O nome do banco não é descrição: "no nubank no mercado" é compra no
  // Mercado, paga no Nubank — não uma compra chamada "Nubank Mercado".
  const semOrigem = origem ? apagarTrecho(semData, origem.matched) : semData;
  const description = extractDescription(semOrigem, merchants);

  const cat = description
    ? categorize({ description, method }, { rules, memory, merchants })
    : { categoryId: null, source: null, confidence: 0 };

  return {
    raw: text,
    amountCents: amountCents == null ? null : (direction === 'in' ? amountCents : -amountCents),
    date,
    method: method || (count > 1 ? 'credit' : null),
    installmentCount: count,
    description,
    categoryId: cat.categoryId,
    categorySource: cat.source,
    confidence: cat.confidence,
    accountId: origem?.accountId || null,
    cardId: origem?.cardId || null,
    direction,
    needs: [
      amountCents == null ? 'valor' : null,
      description == null ? 'descrição' : null,
    ].filter(Boolean),
  };
}

/** Tira um trecho do texto sem depender de acento ou caixa. */
function apagarTrecho(text, trecho) {
  if (!trecho) return text;
  const alvo = norm(trecho);
  const palavras = String(text).split(/(\s+)/);
  let restante = alvo.split(/\s+/).length;
  return palavras
    .filter((p) => {
      if (restante <= 0 || !p.trim()) return true;
      if (alvo.includes(norm(p))) { restante--; return false; }
      return true;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
