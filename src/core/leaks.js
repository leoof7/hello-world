// Caça-vazamentos: dinheiro saindo sem você perceber.
//
// Tudo aqui é determinístico — nenhuma IA, nenhum custo. E costuma pagar o
// app no primeiro mês: assinatura esquecida, preço que subiu em silêncio,
// cobrança duplicada.

import { sum } from './money.js';
import { daysBetween, monthKey, addMonthKey, formatMonthKey } from './dates.js';
import { norm, cleanDescription } from './categorize.js';

const chave = (tx) => norm(cleanDescription(tx.description));

/**
 * Detecta cobranças recorrentes: mesma contraparte, intervalo regular,
 * valor parecido. Três ocorrências já bastam para ter certeza.
 */
export function findRecurring(transactions, { minOccurrences = 3, tolerance = 0.25 } = {}) {
  const grupos = new Map();
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if (t.installment) continue; // parcela não é assinatura
    const k = chave(t);
    if (!k) continue;
    grupos.set(k, [...(grupos.get(k) || []), t]);
  }

  const recorrentes = [];
  for (const [k, lista] of grupos) {
    if (lista.length < minOccurrences) continue;
    const ordenada = [...lista].sort((a, b) => (a.date < b.date ? -1 : 1));

    const intervalos = [];
    for (let i = 1; i < ordenada.length; i++) {
      intervalos.push(daysBetween(ordenada[i - 1].date, ordenada[i].date));
    }
    const medio = intervalos.reduce((a, b) => a + b, 0) / intervalos.length;
    // mensal fica entre 25 e 35 dias; anual entre 350 e 380
    const mensal = medio >= 25 && medio <= 35;
    const anual = medio >= 350 && medio <= 380;
    if (!mensal && !anual) continue;

    const valores = ordenada.map((t) => Math.abs(t.amountCents));
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    const regular = valores.every((v) => Math.abs(v - media) / media <= tolerance);
    if (!regular) continue;

    recorrentes.push({
      key: k,
      name: cleanDescription(ordenada[ordenada.length - 1].description),
      period: mensal ? 'mensal' : 'anual',
      occurrences: ordenada.length,
      lastDate: ordenada[ordenada.length - 1].date,
      lastAmountCents: valores[valores.length - 1],
      averageCents: Math.round(media),
      yearlyCents: mensal ? valores[valores.length - 1] * 12 : valores[valores.length - 1],
      history: ordenada,
    });
  }

  return recorrentes.sort((a, b) => b.yearlyCents - a.yearlyCents);
}

/**
 * Aumento silencioso: a assinatura subiu e ninguém avisou.
 * Compara a última cobrança com a anterior.
 */
export function priceIncreases(recurring, { minCents = 100 } = {}) {
  const achados = [];
  for (const r of recurring) {
    if (r.history.length < 2) continue;
    const atual = Math.abs(r.history[r.history.length - 1].amountCents);
    const anterior = Math.abs(r.history[r.history.length - 2].amountCents);
    const delta = atual - anterior;
    if (delta < minCents) continue;
    achados.push({
      type: 'aumento',
      name: r.name,
      fromCents: anterior,
      toCents: atual,
      deltaCents: delta,
      yearlyCents: r.period === 'mensal' ? delta * 12 : delta,
      since: r.history[r.history.length - 1].date,
    });
  }
  return achados.sort((a, b) => b.yearlyCents - a.yearlyCents);
}

/**
 * Cobrança duplicada: mesmo valor, mesma contraparte, poucos dias de distância.
 */
export function duplicates(transactions, { windowDays = 5 } = {}) {
  const achados = [];
  const porChave = new Map();
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    const k = `${chave(t)}|${t.amountCents}`;
    porChave.set(k, [...(porChave.get(k) || []), t]);
  }
  for (const lista of porChave.values()) {
    if (lista.length < 2) continue;
    const ordenada = [...lista].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < ordenada.length; i++) {
      const dias = daysBetween(ordenada[i - 1].date, ordenada[i].date);
      if (dias <= windowDays) {
        achados.push({
          type: 'duplicada',
          name: cleanDescription(ordenada[i].description),
          amountCents: Math.abs(ordenada[i].amountCents),
          dates: [ordenada[i - 1].date, ordenada[i].date],
          daysApart: dias,
        });
      }
    }
  }
  return achados;
}

/** Assinatura que você paga e não usa — só dá para inferir por tempo sem alteração. */
export function dormant(recurring, todayISO, { months = 6 } = {}) {
  return recurring
    .filter((r) => r.period === 'mensal' && r.occurrences >= months)
    .map((r) => ({
      type: 'antiga',
      name: r.name,
      monthlyCents: r.lastAmountCents,
      yearlyCents: r.yearlyCents,
      since: r.history[0].date,
      months: r.occurrences,
    }));
}

/** Roda tudo e devolve os achados ordenados pelo que custa mais no ano. */
export function scan(transactions, todayISO) {
  const recorrentes = findRecurring(transactions);
  const aumentos = priceIncreases(recorrentes);
  const dupes = duplicates(transactions);
  const achados = [
    ...aumentos,
    ...dupes.map((d) => ({ ...d, yearlyCents: d.amountCents })),
  ].sort((a, b) => (b.yearlyCents || 0) - (a.yearlyCents || 0));

  return {
    recurring: recorrentes,
    findings: achados,
    totalYearlyCents: sum(achados.map((a) => a.yearlyCents || 0)),
    monthlySubscriptionsCents: sum(
      recorrentes.filter((r) => r.period === 'mensal').map((r) => r.lastAmountCents)
    ),
  };
}

/** Próximas cobranças recorrentes nos próximos N dias. */
export function upcoming(recurring, todayISO, days = 30) {
  const out = [];
  for (const r of recurring) {
    if (r.period !== 'mensal') continue;
    const dia = Number(r.lastDate.slice(8, 10));
    for (let i = 0; i <= 1; i++) {
      const mes = addMonthKey(monthKey(todayISO), i);
      const data = `${mes}-${String(dia).padStart(2, '0')}`;
      if (data > todayISO && daysBetween(todayISO, data) <= days) {
        out.push({ name: r.name, date: data, amountCents: r.lastAmountCents, key: r.key });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export { formatMonthKey };
