// Orçamento com marca de ritmo.
//
// Uma barra de progresso comum só diz quanto você já gastou. A marca de ritmo
// diz onde você DEVERIA estar hoje — é o que transforma a barra em ferramenta:
// 75% gasto no dia 19 de 31 é problema, 75% no dia 28 não é.

import { sum } from './money.js';
import { parts, lastDayOfMonth, iso, monthKey } from './dates.js';

/**
 * Situação de uma categoria no mês.
 *
 * Devolve, além dos números, a data prevista de estouro — que é a informação
 * acionável: "no seu ritmo, Alimentação estoura dia 24".
 */
export function pace(spentCents, limitCents, todayISO) {
  const { y, m, d } = parts(todayISO);
  const diasNoMes = lastDayOfMonth(y, m);
  const gasto = Math.abs(spentCents);
  const teto = Math.abs(limitCents);

  const ratio = teto > 0 ? gasto / teto : 0;
  const esperado = d / diasNoMes;
  const porDia = d > 0 ? gasto / d : 0;
  const restante = Math.max(0, teto - gasto);
  const diasRestantes = diasNoMes - d;

  let breakDay = null;
  if (porDia > 0 && teto > 0) {
    const diaEstouro = Math.ceil(teto / porDia);
    if (diaEstouro <= diasNoMes) breakDay = Math.max(d, diaEstouro);
  }

  return {
    spentCents: gasto,
    limitCents: teto,
    remainingCents: restante,
    ratio,
    expectedRatio: esperado,
    overPace: ratio > esperado,
    perDayCents: Math.round(porDia),
    daysLeft: diasRestantes,
    safePerDayCents: diasRestantes > 0 ? Math.round(restante / diasRestantes) : 0,
    breakDay,
    breakDate: breakDay ? iso(y, m, Math.min(breakDay, diasNoMes)) : null,
    exceeded: gasto > teto,
  };
}

/** Aplica pace() em todas as categorias com teto. */
export function monthStatus(categories, transactions, todayISO) {
  const mes = monthKey(todayISO);
  const gastoPorCategoria = new Map();

  for (const t of transactions) {
    const comp = t.competence || monthKey(t.date);
    if (comp !== mes) continue;
    if (t.amountCents >= 0) continue; // só despesa
    const key = t.categoryId || 'sem-categoria';
    gastoPorCategoria.set(key, (gastoPorCategoria.get(key) || 0) + Math.abs(t.amountCents));
  }

  return categories
    .filter((c) => c.limitCents > 0)
    .map((c) => ({
      ...c,
      ...pace(gastoPorCategoria.get(c.id) || 0, c.limitCents, todayISO),
    }))
    .sort((a, b) => b.ratio - a.ratio);
}

/** Consolidado do mês: quanto do orçamento variável já foi. */
export function overall(status, todayISO) {
  const gasto = sum(status.map((s) => s.spentCents));
  const teto = sum(status.map((s) => s.limitCents));
  return { ...pace(gasto, teto, todayISO), categories: status.length };
}

/** Separa fixo de variável — cortar fixo dói uma vez, variável dói todo mês. */
export function fixedVsVariable(transactions, categories, monthKeyStr) {
  const fixas = new Set(categories.filter((c) => c.fixed).map((c) => c.id));
  let fixo = 0;
  let variavel = 0;
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if ((t.competence || monthKey(t.date)) !== monthKeyStr) continue;
    if (fixas.has(t.categoryId)) fixo += Math.abs(t.amountCents);
    else variavel += Math.abs(t.amountCents);
  }
  const total = fixo + variavel;
  return {
    fixedCents: fixo,
    variableCents: variavel,
    totalCents: total,
    fixedRatio: total > 0 ? fixo / total : 0,
  };
}

/** A categoria que mais precisa de atenção agora. */
export function worst(status) {
  const emRisco = status.filter((s) => s.overPace || s.exceeded);
  return emRisco.length ? emRisco[0] : null;
}
