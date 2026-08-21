// Dinheiro em centavos inteiros. Nunca float.
// 0.1 + 0.2 !== 0.3 — num app financeiro isso é bug de confiança.

/** Converte "1.234,56", "1234,56", "R$ 45,90" ou 1234.56 em centavos inteiros. */
export function toCents(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  if (typeof input !== 'string') return 0;

  let s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, '');

  // Se tem vírgula, ela é o separador decimal e o ponto é milhar (padrão pt-BR).
  // Se só tem ponto, ele é decimal quando sobram 1-2 casas ("45.9"), senão é milhar ("1.234").
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  }

  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

/** 123456 → "1.234,56" */
export function formatCents(cents, { sign = false } = {}) {
  const n = Math.trunc(cents);
  const abs = Math.abs(n);
  const reais = Math.trunc(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = n < 0 ? '−' : sign ? '+' : '';
  return `${prefix}${inteiro},${centavos}`;
}

/** 123456 → "R$ 1.234,56" */
export function brl(cents, options) {
  const s = formatCents(cents, options);
  return s.startsWith('−') || s.startsWith('+')
    ? `${s[0]}R$ ${s.slice(1)}`
    : `R$ ${s}`;
}

/**
 * 470000 → "R$ 4.700" — versão curta, para KPI e herói.
 *
 * Só esconde o centavo quando o centavo de fato não importa. Abaixo de mil
 * reais ele importa muito: com R$ 21,73 na conta, mostrar "R$ 22" some com
 * 27 centavos, que é mais de 1% de tudo que a pessoa tem — e ela abre o app,
 * vê R$ 22 no topo e R$ 21,73 na conta logo abaixo, dois números para o mesmo
 * dinheiro. Number redondo é conforto de layout; conferir com o extrato é o
 * que faz alguém confiar no app.
 */
export const LIMITE_CENTAVO = 100000; // R$ 1.000,00

export function brlShort(cents) {
  const n = Math.trunc(cents);
  if (Math.abs(n) < LIMITE_CENTAVO) return brl(n);

  const reais = Math.round(Math.abs(n) / 100);
  const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '−' : ''}R$ ${inteiro}`;
}

/**
 * Divide um total em N parcelas de centavos inteiros que somam EXATAMENTE o total.
 *
 * O resto vai na PRIMEIRA parcela, que é como os emissores brasileiros fazem:
 * R$ 100,00 em 3x vira 33,34 + 33,33 + 33,33.
 * Passe { remainder: 'last' } se precisar do resto no fim.
 */
export function splitInstallments(totalCents, count, { remainder = 'first' } = {}) {
  const total = Math.trunc(totalCents);
  const n = Math.trunc(count);
  if (n <= 0) return [];
  if (n === 1) return [total];

  const negative = total < 0;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rest = abs - base * n;

  const parts = new Array(n).fill(base);
  if (remainder === 'last') parts[n - 1] += rest;
  else parts[0] += rest;

  return negative ? parts.map((p) => -p) : parts;
}

export const sum = (list) => list.reduce((acc, n) => acc + Math.trunc(n || 0), 0);

/** Percentual com uma casa: 0.1834 → "18,3%" */
export function percent(ratio, decimals = 1) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals).replace('.', ',')}%`;
}

/** Juros compostos: taxa mensal → taxa anual equivalente. 0.149 → 4.359 (435,9%) */
export function monthlyToYearly(monthlyRate) {
  return Math.pow(1 + monthlyRate, 12) - 1;
}
