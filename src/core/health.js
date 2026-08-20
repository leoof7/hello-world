// Diagnóstico financeiro — quatro indicadores explicáveis, nenhum score opaco.
//
// "Score" no Brasil colide com score de crédito e cria expectativa errada.
// E um número de 0 a 100 não ensina nada: a pessoa não sabe o que fazer com
// ele. Cada indicador aqui diz de onde veio e o que significa.

import { sum } from './money.js';
import { monthKey, addMonthKey } from './dates.js';
import { totalBalance, totalMonthlyInterest } from './debts.js';

/**
 * Custo de vida mínimo: a média do que você NÃO consegue cortar.
 * É a base de tudo — reserva de emergência, quanto dá pra gastar sem culpa,
 * e quanto tempo você aguentaria sem renda.
 */
export function minimumCostOfLiving(transactions, categories, todayISO, { months = 6, manualCents = 0, fixedEssentialCents = 0 } = {}) {
  const essenciais = new Set(categories.filter((c) => c.essential).map((c) => c.id));
  const desde = addMonthKey(monthKey(todayISO), -months);
  const porMes = new Map();

  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    const comp = t.competence || monthKey(t.date);
    if (comp < desde || comp >= monthKey(todayISO)) continue; // mês corrente ainda incompleto
    if (!essenciais.has(t.categoryId)) continue;
    porMes.set(comp, (porMes.get(comp) || 0) + Math.abs(t.amountCents));
  }

  const valores = [...porMes.values()];
  // Sem histórico ainda, o app não pode inventar "R$ 0". Prefere somar os
  // gastos fixos essenciais já cadastrados (moradia, contas) — isso já existe
  // no app e atualiza sozinho quando a pessoa cadastra um gasto fixo. Só cai
  // pro número digitado no Perfil se não houver nem isso.
  if (!valores.length) {
    if (fixedEssentialCents > 0) return { cents: fixedEssentialCents, months: 0, confident: false, source: 'fixos' };
    return manualCents > 0
      ? { cents: manualCents, months: 0, confident: false, source: 'manual' }
      : { cents: 0, months: 0, confident: false, source: 'histórico' };
  }

  return {
    cents: Math.round(sum(valores) / valores.length),
    months: valores.length,
    confident: valores.length >= 3,
    source: 'histórico',
    byMonth: [...porMes.entries()].sort(),
  };
}

/** Taxa de poupança: quanto do que entrou você conseguiu guardar. */
export function savingsRate(incomeCents, spentCents) {
  if (!incomeCents) return { ratio: 0, savedCents: 0 };
  const guardado = incomeCents - spentCents;
  return { ratio: guardado / incomeCents, savedCents: guardado };
}

/**
 * Comprometimento da renda: quanto sai antes de você decidir qualquer coisa.
 * Fixos + parcelas + mínimos de dívida. Acima de 30% aperta.
 */
export function commitment(incomeCents, { fixedCents = 0, installmentCents = 0, debtMinimumsCents = 0 }) {
  const total = fixedCents + installmentCents + debtMinimumsCents;
  return {
    cents: total,
    ratio: incomeCents ? total / incomeCents : 0,
    fixedCents,
    installmentCents,
    debtMinimumsCents,
    healthy: incomeCents ? total / incomeCents <= 0.3 : false,
  };
}

/** Reserva de emergência medida em meses de custo de vida mínimo. */
export function emergencyFund(savedCents, minimumCostCents, { targetMonths = 6 } = {}) {
  const meses = minimumCostCents > 0 ? savedCents / minimumCostCents : 0;
  const alvo = minimumCostCents * targetMonths;
  return {
    savedCents,
    months: meses,
    targetMonths,
    targetCents: alvo,
    missingCents: Math.max(0, alvo - savedCents),
    ratio: alvo > 0 ? Math.min(1, savedCents / alvo) : 0,
  };
}

/** Para onde vai cada real: essencial, supérfluo, investido. */
export function allocation(transactions, categories, monthKeyStr, savedCents = 0) {
  const essenciais = new Set(categories.filter((c) => c.essential).map((c) => c.id));
  let essencial = 0;
  let superfluo = 0;

  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if ((t.competence || monthKey(t.date)) !== monthKeyStr) continue;
    if (essenciais.has(t.categoryId)) essencial += Math.abs(t.amountCents);
    else superfluo += Math.abs(t.amountCents);
  }

  const total = essencial + superfluo + Math.max(0, savedCents);
  const pct = (v) => (total > 0 ? v / total : 0);
  return {
    essentialCents: essencial,
    discretionaryCents: superfluo,
    investedCents: Math.max(0, savedCents),
    totalCents: total,
    essentialRatio: pct(essencial),
    discretionaryRatio: pct(superfluo),
    investedRatio: pct(Math.max(0, savedCents)),
  };
}

/** Patrimônio líquido: o que é seu menos o que você deve. */
export function netWorth(accounts, debts) {
  const ativos = sum(accounts.filter((a) => a.balanceCents > 0).map((a) => a.balanceCents));
  const passivos = totalBalance(debts) + sum(accounts.filter((a) => a.balanceCents < 0).map((a) => Math.abs(a.balanceCents)));
  return { assetsCents: ativos, liabilitiesCents: passivos, netCents: ativos - passivos };
}

/**
 * Monta o diagnóstico completo. Cada item carrega a explicação de como foi
 * calculado, porque indicador que não se explica não muda comportamento.
 */
export function diagnose({ transactions, categories, accounts, debts, incomeCents, savedCents, todayISO, minimumCostManualCents = 0, minimumCostFixedCents = 0 }) {
  const mes = monthKey(todayISO);
  const custoMinimo = minimumCostOfLiving(transactions, categories, todayISO,
    { manualCents: minimumCostManualCents, fixedEssentialCents: minimumCostFixedCents });
  const gastoMes = sum(
    transactions
      .filter((t) => t.amountCents < 0 && (t.competence || monthKey(t.date)) === mes)
      .map((t) => Math.abs(t.amountCents))
  );

  const poupanca = savingsRate(incomeCents, gastoMes);
  const reserva = emergencyFund(savedCents, custoMinimo.cents);
  const jurosMes = totalMonthlyInterest(debts);

  return {
    minimumCost: custoMinimo,
    savings: poupanca,
    emergency: reserva,
    allocation: allocation(transactions, categories, mes, poupanca.savedCents),
    netWorth: netWorth(accounts, debts),
    monthlyInterestCents: jurosMes,
    interestRatio: incomeCents ? jurosMes / incomeCents : 0,
  };
}
