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
  const media = valores.length ? Math.round(sum(valores) / valores.length) : 0;

  // O que você JÁ SABE que sai todo mês é piso, não plano B.
  //
  // Antes o histórico vencia sempre que existisse — e bastava um lançamento
  // solto de R$ 100 numa categoria essencial para o app abandonar os R$ 1.170
  // de aluguel e contas já cadastrados e anunciar que seu custo de vida mínimo
  // era R$ 100. Ninguém vive por menos que o próprio aluguel: o piso vale
  // mesmo quando há histórico, porque histórico curto mente para baixo.
  const piso = Math.max(fixedEssentialCents, manualCents);

  if (media >= piso && valores.length) {
    return {
      cents: media,
      months: valores.length,
      confident: valores.length >= 3,
      source: 'histórico',
      byMonth: [...porMes.entries()].sort(),
    };
  }

  if (piso <= 0) return { cents: 0, months: 0, confident: false, source: 'histórico' };

  return {
    cents: piso,
    months: valores.length,
    confident: false,
    source: fixedEssentialCents >= manualCents ? 'fixos' : 'manual',
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

/**
 * Patrimônio líquido: o que é seu menos o que você deve.
 *
 * Patrimônio não é só o saldo em conta — carro, moto e casa também são seus.
 * `bens` carrega esse valor à parte, e o retorno separa quanto é conta
 * (líquido, sacável hoje) de quanto é bem (não é dinheiro na mão).
 *
 * Conta negativa com cheque especial cadastrado como dívida (accountId) já
 * conta o saldo negativo por lá, com juro e tudo — somar de novo aqui contaria
 * a mesma dívida duas vezes.
 */
export function netWorth(accounts, debts, bens = []) {
  const contasComDivida = new Set(debts.filter((d) => d.accountId).map((d) => d.accountId));
  const contasCents = sum(accounts.filter((a) => a.balanceCents > 0).map((a) => a.balanceCents));
  const bensCents = sum(bens.map((b) => Math.max(0, b.valueCents || 0)));
  const ativos = contasCents + bensCents;
  const passivos = totalBalance(debts) + sum(
    accounts.filter((a) => a.balanceCents < 0 && !contasComDivida.has(a.id)).map((a) => Math.abs(a.balanceCents))
  );
  return {
    assetsCents: ativos,
    liabilitiesCents: passivos,
    netCents: ativos - passivos,
    contasCents,
    bensCents,
    porConta: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.balanceCents })),
  };
}

/**
 * Monta o diagnóstico completo. Cada item carrega a explicação de como foi
 * calculado, porque indicador que não se explica não muda comportamento.
 */
export function diagnose({ transactions, categories, accounts, debts, incomeCents, savedCents, todayISO, minimumCostManualCents = 0, minimumCostFixedCents = 0, bens = [] }) {
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
    netWorth: netWorth(accounts, debts, bens),
    monthlyInterestCents: jurosMes,
    interestRatio: incomeCents ? jurosMes / incomeCents : 0,
  };
}
