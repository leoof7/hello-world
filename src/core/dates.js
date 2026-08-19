// Datas como strings 'YYYY-MM-DD', aritmética sempre em UTC.
// Isso elimina a classe inteira de bugs de fuso horário — o Brasil já teve
// horário de verão e pode ter de novo; não dá pra depender do fuso local.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** 'YYYY-MM-DD' → { y, m, d } com m em base 1 */
export function parts(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function iso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Data de hoje no fuso do aparelho, mas normalizada para string. */
export function today(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const toUTC = (isoStr) => {
  const { y, m, d } = parts(isoStr);
  return Date.UTC(y, m - 1, d);
};

const fromUTC = (ms) => {
  const dt = new Date(ms);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

export function addDays(isoStr, days) {
  return fromUTC(toUTC(isoStr) + days * 86400000);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Soma meses preservando o dia quando possível.
 * 31 de janeiro + 1 mês = 28 (ou 29) de fevereiro, não 3 de março.
 */
export function addMonths(isoStr, months) {
  const { y, m, d } = parts(isoStr);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

/** Constrói uma data pedindo um dia que pode não existir no mês (dia 31 em fevereiro → 28). */
export function clampedDay(y, m, day) {
  return iso(y, m, Math.min(day, lastDayOfMonth(y, m)));
}

export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const isBefore = (a, b) => a < b;
export const isAfter = (a, b) => a > b;
export const min = (a, b) => (a <= b ? a : b);
export const max = (a, b) => (a >= b ? a : b);

/** '2026-08' — chave de competência mensal */
export const monthKey = (isoStr) => String(isoStr).slice(0, 7);
export const monthStart = (key) => `${key}-01`;
export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return iso(y, m, lastDayOfMonth(y, m));
}
export function addMonthKey(key, months) {
  const [y, m] = key.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// ---- formatação em português ----

export function formatShort(isoStr) {
  const { m, d } = parts(isoStr);
  return `${d} ${MESES_CURTO[m - 1]}`;
}

export function formatLong(isoStr) {
  const { y, m, d } = parts(isoStr);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

export function formatWeekday(isoStr) {
  const dt = new Date(toUTC(isoStr));
  const nome = DIAS[dt.getUTCDay()];
  const { m, d } = parts(isoStr);
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${d} de ${MESES[m - 1]}`;
}

/** '2026-08' → 'ago/2026' */
export function formatMonthKey(key, { long = false } = {}) {
  const [y, m] = key.split('-').map(Number);
  return long ? `${MESES[m - 1]} de ${y}` : `${MESES_CURTO[m - 1]}/${y}`;
}

/** '2026-08' → 'AGO' */
export const monthAbbr = (key) => MESES_CURTO[Number(key.split('-')[1]) - 1].toUpperCase();

export { MESES, MESES_CURTO };
