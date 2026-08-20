// Ciclos de fatura de cartão de crédito.
//
// A regra que quase todo app brasileiro erra: uma compra feita NO DIA do
// fechamento entra na fatura SEGUINTE. A fatura que fecha dia 20/ago cobre
// as compras de 20/jul até 19/ago.
//
// Vencimento: cai no mesmo mês do fechamento quando o dia do vencimento é
// maior que o do fechamento (fecha 20, vence 27); cai no mês seguinte quando
// é menor (fecha 28, vence 5).

import { parts, iso, clampedDay, addMonths, addDays, monthKey, lastDayOfMonth } from './dates.js';

/** Data de fechamento do ciclo do mês (ano, mês), respeitando meses curtos. */
export function closeDateOf(card, y, m) {
  return clampedDay(y, m, card.closingDay);
}

/** Vencimento da fatura que fechou em closeDate. */
export function dueDateOf(card, closeDate) {
  const { y, m } = parts(closeDate);
  const sameMonth = card.dueDay > card.closingDay;
  if (sameMonth) return clampedDay(y, m, card.dueDay);
  const next = addMonths(iso(y, m, 1), 1);
  const p = parts(next);
  return clampedDay(p.y, p.m, card.dueDay);
}

/**
 * Em qual fatura uma compra cai.
 * Devolve { id, closeDate, dueDate, start, end, month } — `id` é a data de
 * fechamento, que serve de chave estável para a fatura.
 */
export function cycleFor(card, purchaseDate) {
  const { y, m } = parts(purchaseDate);

  // Candidato natural: o fechamento do próprio mês da compra.
  let closeDate = closeDateOf(card, y, m);

  // Compra no dia do fechamento ou depois → vai para o ciclo seguinte.
  if (purchaseDate >= closeDate) {
    const nextMonth = addMonths(iso(y, m, 1), 1);
    const p = parts(nextMonth);
    closeDate = closeDateOf(card, p.y, p.m);
  }

  return buildCycle(card, closeDate);
}

function buildCycle(card, closeDate) {
  const { y, m } = parts(closeDate);
  const prevMonth = addMonths(iso(y, m, 1), -1);
  const pp = parts(prevMonth);
  const start = closeDateOf(card, pp.y, pp.m);
  return {
    id: closeDate,
    cardId: card.id,
    closeDate,
    dueDate: dueDateOf(card, closeDate),
    start,
    end: addDays(closeDate, -1),
    month: monthKey(closeDate),
  };
}

/** O ciclo que está aberto agora (ainda não fechou). */
export function openCycle(card, todayISO) {
  return cycleFor(card, todayISO);
}

/** Ciclo imediatamente anterior a um dado ciclo. */
export function previousCycle(card, cycle) {
  const { y, m } = parts(cycle.closeDate);
  const prev = addMonths(iso(y, m, 1), -1);
  const p = parts(prev);
  return buildCycle(card, closeDateOf(card, p.y, p.m));
}

/** Ciclo seguinte. */
export function nextCycle(card, cycle) {
  const { y, m } = parts(cycle.closeDate);
  const nxt = addMonths(iso(y, m, 1), 1);
  const p = parts(nxt);
  return buildCycle(card, closeDateOf(card, p.y, p.m));
}

/** Sequência de ciclos cujo fechamento cai entre duas datas (inclusive). */
export function cyclesBetween(card, fromISO, toISO) {
  const out = [];
  let cycle = cycleFor(card, fromISO);
  // Recua enquanto o fechamento anterior ainda estiver dentro da janela.
  let guard = 0;
  while (previousCycle(card, cycle).closeDate >= fromISO && guard++ < 240) {
    cycle = previousCycle(card, cycle);
  }
  guard = 0;
  while (cycle.closeDate <= toISO && guard++ < 240) {
    out.push(cycle);
    cycle = nextCycle(card, cycle);
  }
  return out;
}

/**
 * Monta a fatura: agrupa as transações do cartão que caem no ciclo.
 * Cada transação precisa de { date, amountCents, cardId }.
 */
export function buildStatement(card, cycle, transactions) {
  const items = transactions.filter(
    (t) => t.cardId === card.id && t.date >= cycle.start && t.date <= cycle.end
  );
  const totalCents = items.reduce((acc, t) => acc + t.amountCents, 0);
  const installmentCents = items
    .filter((t) => t.installment)
    .reduce((acc, t) => acc + t.amountCents, 0);

  return { ...cycle, items, totalCents, installmentCents, count: items.length };
}

/** Quanto do limite está comprometido: faturas em aberto + atrasadas. */
export function availableLimit(card, statements = [], overdueCents = 0) {
  const used = statements.reduce((acc, s) => acc + Math.abs(s.totalCents), 0) + Math.abs(overdueCents);
  return Math.max(0, (card.limitCents || 0) - used);
}

export { lastDayOfMonth };
