// Motor de saída de dívidas.
//
// A ordem de pagamento segue o JURO, não o tamanho do saldo. É contraintuitivo
// e é onde a maioria das pessoas perde dinheiro: o rotativo do cartão a 14,9%
// ao mês custa três vezes mais que o cheque especial a 8%, mesmo que o saldo do
// cheque pareça mais assustador.
//
// Parcelamento já contratado tem juro embutido no valor — antecipar não
// economiza nada, então ele nunca disputa a fila.

import { sum } from './money.js';
import { addMonthKey, monthKey, formatMonthKey } from './dates.js';

export const KIND = {
  REVOLVING: 'revolving',   // rotativo do cartão
  OVERDRAFT: 'overdraft',   // cheque especial
  LOAN: 'loan',             // empréstimo pessoal, consignado
  INSTALLMENT: 'installment', // parcelamento já contratado, sem juro novo
};

/** Quanto essa dívida custa por dia parada. */
export function dailyInterest(debt) {
  if (debt.kind === KIND.INSTALLMENT) return 0;
  return Math.round(Math.abs(debt.balanceCents) * (debt.monthlyRate || 0) / 30);
}

/** Juros de um mês inteiro. */
export function monthlyInterest(debt) {
  if (debt.kind === KIND.INSTALLMENT) return 0;
  return Math.round(Math.abs(debt.balanceCents) * (debt.monthlyRate || 0));
}

export const totalBalance = (debts) => sum(debts.map((d) => Math.abs(d.balanceCents)));
export const totalDailyInterest = (debts) => sum(debts.map(dailyInterest));
export const totalMonthlyInterest = (debts) => sum(debts.map(monthlyInterest));

/**
 * Ordem de ataque.
 *  'avalanche' — maior juro primeiro. Economiza mais dinheiro. É o padrão.
 *  'snowball'  — menor saldo primeiro. Economiza menos, mas dá vitórias rápidas.
 * Parcelamentos ficam sempre no fim, porque antecipá-los não muda nada.
 */
export function order(debts, method = 'avalanche') {
  const juros = debts.filter((d) => d.kind !== KIND.INSTALLMENT);
  const parcelas = debts.filter((d) => d.kind === KIND.INSTALLMENT);

  const ordenadas = [...juros].sort((a, b) =>
    method === 'snowball'
      ? Math.abs(a.balanceCents) - Math.abs(b.balanceCents) || b.monthlyRate - a.monthlyRate
      : b.monthlyRate - a.monthlyRate || Math.abs(a.balanceCents) - Math.abs(b.balanceCents)
  );

  return [...ordenadas, ...parcelas];
}

/**
 * Simula a quitação mês a mês.
 *
 * Método bola de neve de pagamento: paga o mínimo de todas e joga tudo que
 * sobra na primeira da fila. Quando ela morre, o valor inteiro migra para a
 * próxima — por isso o ritmo acelera com o tempo.
 *
 * budgetCents é quanto você consegue destinar por mês, no total.
 */
export function payoffPlan(debts, budgetCents, { method = 'avalanche', fromMonth, maxMonths = 360 } = {}) {
  const start = fromMonth || monthKey(new Date().toISOString());
  let saldos = order(debts, method).map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    rate: d.kind === KIND.INSTALLMENT ? 0 : (d.monthlyRate || 0),
    balance: Math.abs(d.balanceCents),
    minFixed: Math.abs(d.minPaymentCents || 0),
    // Fatura de cartão cobra mínimo como percentual do saldo — ele encolhe
    // junto com a dívida. Parcelamento tem valor fixo. Suportamos os dois.
    minRate: d.minPaymentRate || 0,
    paidOffMonth: null,
  }));

  const minimumOf = (s) =>
    Math.min(s.balance, Math.max(s.minFixed, Math.round(s.balance * s.minRate)));

  const months = [];
  let totalInterest = 0;
  let m = 0;

  const minimumsTotal = sum(saldos.map(minimumOf));
  const viable = budgetCents >= minimumsTotal;

  while (saldos.some((s) => s.balance > 0) && m < maxMonths) {
    const month = addMonthKey(start, m);

    // 1. juros do mês incidem antes do pagamento
    let jurosDoMes = 0;
    for (const s of saldos) {
      if (s.balance <= 0 || !s.rate) continue;
      const j = Math.round(s.balance * s.rate);
      s.balance += j;
      jurosDoMes += j;
    }
    totalInterest += jurosDoMes;

    // 2. paga o mínimo de cada uma
    let disponivel = budgetCents;
    const pagamentos = [];
    for (const s of saldos) {
      if (s.balance <= 0) continue;
      const pago = Math.min(minimumOf(s), s.balance, disponivel);
      s.balance -= pago;
      disponivel -= pago;
      if (pago > 0) pagamentos.push({ id: s.id, cents: pago, kind: 'mínimo' });
    }

    // 3. tudo que sobrou vai para a primeira da fila que ainda vive
    for (const s of saldos) {
      if (disponivel <= 0) break;
      if (s.balance <= 0) continue;
      const extra = Math.min(disponivel, s.balance);
      s.balance -= extra;
      disponivel -= extra;
      if (extra > 0) pagamentos.push({ id: s.id, cents: extra, kind: 'extra' });
    }

    for (const s of saldos) {
      if (s.balance <= 0 && !s.paidOffMonth) s.paidOffMonth = month;
    }

    months.push({
      month,
      interestCents: jurosDoMes,
      paidCents: budgetCents - disponivel,
      balances: saldos.map((s) => ({ id: s.id, name: s.name, kind: s.kind, cents: Math.max(0, s.balance) })),
      totalCents: sum(saldos.map((s) => Math.max(0, s.balance))),
    });

    m++;
  }

  const done = saldos.every((s) => s.balance <= 0);

  return {
    method,
    viable,
    done,
    months,
    monthsCount: months.length,
    freeMonth: done ? months[months.length - 1].month : null,
    totalInterestCents: totalInterest,
    totalPaidCents: totalBalance(debts) + totalInterest,
    payoffByDebt: saldos.map((s) => ({ id: s.id, name: s.name, month: s.paidOffMonth })),
    minimumsTotalCents: minimumsTotal,
  };
}

/** Compara dois planos e devolve o que se ganha trocando de um para o outro. */
export function comparePlans(planA, planB) {
  return {
    savedInterestCents: planA.totalInterestCents - planB.totalInterestCents,
    savedMonths: planA.monthsCount - planB.monthsCount,
  };
}

/**
 * O cenário "pagando só o mínimo": nenhum extra, só os mínimos.
 * Serve para mostrar o custo de não ter plano.
 */
export function minimumOnlyPlan(debts, options = {}) {
  const minimos = sum(debts.map((d) =>
    Math.max(Math.abs(d.minPaymentCents || 0), Math.round(Math.abs(d.balanceCents) * (d.minPaymentRate || 0)))
  ));
  return payoffPlan(debts, minimos, options);
}

/** O mínimo que o mês exige. Se o orçamento não cobre isso, não existe plano. */
export function minimumsToday(debts) {
  return sum(debts.map((d) =>
    Math.max(Math.abs(d.minPaymentCents || 0), Math.round(Math.abs(d.balanceCents) * (d.minPaymentRate || 0)))
  ));
}

/**
 * Trocar uma dívida cara por um empréstimo mais barato.
 * Devolve o plano novo já com a dívida substituída.
 */
export function refinance(debts, debtId, newMonthlyRate, { name = 'Empréstimo pessoal' } = {}) {
  return debts.map((d) =>
    d.id === debtId
      ? { ...d, kind: KIND.LOAN, name, monthlyRate: newMonthlyRate }
      : d
  );
}

/** Rótulo legível do prazo: 14 → "14 meses · out/2027" */
export function horizon(plan) {
  if (!plan.done) return 'não quita com esse valor';
  return `${plan.monthsCount} ${plan.monthsCount === 1 ? 'mês' : 'meses'} · ${formatMonthKey(plan.freeMonth)}`;
}
