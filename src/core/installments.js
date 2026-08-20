// Parcelamento — o buraco que faz a projeção de qualquer app mentir.
//
// Uma compra de R$ 1.200 em 12x no cartão NÃO é R$ 1.200 hoje. São R$ 100 por
// mês durante doze meses, cada parcela caindo na sua própria fatura, com sua
// própria competência de orçamento.
//
// Regra do resto: os emissores brasileiros põem a diferença na PRIMEIRA
// parcela (R$ 100,00 em 3x = 33,34 + 33,33 + 33,33).

import { splitInstallments, sum } from './money.js';
import { cycleFor, nextCycle } from './statements.js';
import { monthKey, addMonthKey } from './dates.js';

/**
 * Expande uma compra parcelada em N lançamentos.
 *
 * purchase: { id, cardId, date, totalCents, count, description, categoryId }
 * card: { id, closingDay, dueDay }
 *
 * Devolve lançamentos com:
 *   installment: { n, of, groupId }
 *   date        — data de competência da parcela (para orçamento)
 *   cycleId     — fatura em que a parcela aparece
 *   dueDate     — quando o dinheiro sai da conta
 */
export function expand(purchase, card, { remainder = 'first' } = {}) {
  const count = Math.max(1, Math.trunc(purchase.count || 1));
  const groupId = purchase.groupId || purchase.id;
  const values = splitInstallments(purchase.totalCents, count, { remainder });

  let cycle = cycleFor(card, purchase.date);
  const out = [];

  for (let i = 0; i < count; i++) {
    out.push({
      id: `${groupId}#${i + 1}`,
      groupId,
      cardId: card.id,
      description: purchase.description,
      categoryId: purchase.categoryId,
      // Só emite `projectId` quando existe: chave com `undefined` desaparece no
      // JSON, e aí o documento salvo deixa de ser igual ao que está na memória.
      ...(purchase.projectId ? { projectId: purchase.projectId } : {}),
      amountCents: values[i],
      // A primeira parcela tem a data real da compra; as seguintes usam o
      // fechamento do ciclo, que é quando elas de fato existem.
      date: i === 0 ? purchase.date : cycle.end,
      competence: monthKey(i === 0 ? purchase.date : cycle.end),
      cycleId: cycle.id,
      dueDate: cycle.dueDate,
      installment: { n: i + 1, of: count, groupId },
      method: 'credit',
    });
    cycle = nextCycle(card, cycle);
  }

  return out;
}

/** Confere que a soma das parcelas bate exatamente com o total da compra. */
export function totalOf(entries) {
  return sum(entries.map((e) => e.amountCents));
}

/** Parcelas que ainda vão cair depois de uma data. */
export function remaining(entries, fromISO) {
  return entries.filter((e) => e.dueDate > fromISO);
}

/**
 * O muro de parcelas: quanto de cada mês futuro já está comprometido.
 * Devolve [{ month, cents, items }] ordenado.
 */
export function wall(entries, fromMonth, months = 12) {
  const buckets = new Map();
  for (let i = 0; i < months; i++) buckets.set(addMonthKey(fromMonth, i), []);

  for (const e of entries) {
    if (!e.installment) continue;
    const key = monthKey(e.dueDate);
    if (buckets.has(key)) buckets.get(key).push(e);
  }

  return [...buckets.entries()].map(([month, items]) => ({
    month,
    cents: sum(items.map((i) => i.amountCents)),
    items,
  }));
}

/** Total já comprometido daqui pra frente — o número que quase nenhum app mostra. */
export function committed(entries, fromISO) {
  return sum(remaining(entries, fromISO).map((e) => Math.abs(e.amountCents)));
}

/** Agrupa parcelas por compra, para listar "Notebook 3/12". */
export function byPurchase(entries, todayISO) {
  const groups = new Map();
  for (const e of entries) {
    if (!e.installment) continue;
    const g = groups.get(e.groupId) || {
      groupId: e.groupId,
      description: e.description,
      of: e.installment.of,
      totalCents: 0,
      paidCents: 0,
      remainingCents: 0,
      current: 0,
      lastDueDate: '',
      monthlyCents: 0,
    };
    g.totalCents += Math.abs(e.amountCents);
    if (e.dueDate <= todayISO) {
      g.paidCents += Math.abs(e.amountCents);
      g.current = Math.max(g.current, e.installment.n);
    } else {
      g.remainingCents += Math.abs(e.amountCents);
      if (!g.monthlyCents) g.monthlyCents = Math.abs(e.amountCents);
    }
    g.lastDueDate = e.dueDate > g.lastDueDate ? e.dueDate : g.lastDueDate;
    groups.set(e.groupId, g);
  }
  return [...groups.values()].sort((a, b) => b.remainingCents - a.remainingCents);
}

/**
 * Antecipar parcela não economiza nada: o juro já está embutido no valor.
 * Esta função existe para o app poder dizer isso com números.
 */
export function prepaymentSaving() {
  return { savingCents: 0, reason: 'juros já embutidos no valor da parcela' };
}
