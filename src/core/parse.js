// "gastei oitenta e cinco reais no mercado ontem" → lançamento pronto.
//
// Tudo por regra e dicionário, sem IA e sem custo. A transcrição vem do
// próprio navegador (Web Speech API) ou do teclado — para o parser dá no mesmo.

import { toCents } from './money.js';
import { today, addDays, parts, iso, clampedDay } from './dates.js';

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
 */
export function parseEntry(text, { todayISO = today(), merchants = [], categories = [] } = {}) {
  const amountCents = extractAmount(text);
  const direction = extractDirection(text);
  const method = extractMethod(text);
  const count = extractInstallments(text);
  const date = extractDate(text, todayISO);
  const description = extractDescription(text, merchants);

  // categoria pelo dicionário, se o comércio foi reconhecido
  let categoryId = null;
  const t = norm(text);
  for (const m of merchants) {
    if (m.match && t.includes(norm(m.match))) { categoryId = m.categoryId; break; }
  }

  return {
    raw: text,
    amountCents: amountCents == null ? null : (direction === 'in' ? amountCents : -amountCents),
    date,
    method: method || (count > 1 ? 'credit' : null),
    installmentCount: count,
    description,
    categoryId,
    direction,
    needs: [
      amountCents == null ? 'valor' : null,
      description == null ? 'descrição' : null,
    ].filter(Boolean),
  };
}
