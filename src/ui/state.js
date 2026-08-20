// A camada que transforma o documento guardado no que as telas leem.
//
// Toda conta vive no núcleo (src/core). Aqui só se junta: quais faturas
// existem, que eventos de caixa elas geram, e o que cada tela precisa saber.
// As telas não calculam nada — elas desenham o que este arquivo devolve.

import { sum } from '../core/money.js';
import { today, monthKey, addMonthKey, addDays } from '../core/dates.js';
import { cycleFor, openCycle, nextCycle, dueDateOf } from '../core/statements.js';
import { byPurchase, wall, committed } from '../core/installments.js';
import { buildEvents, daily, monthly, freeToSpend, nextIncomeDate } from '../core/projection.js';
import { totalBalance, totalDailyInterest, totalMonthlyInterest, payoffPlan, minimumOnlyPlan, minimumsToday, minimumOf, order } from '../core/debts.js';
import { monthStatus, overall, fixedVsVariable, worst } from '../core/budget.js';
import { scan } from '../core/leaks.js';
import { diagnose } from '../core/health.js';
import { categorizeAll } from '../core/categorize.js';
import { MERCHANTS } from '../seed/categories.js';
import { PADROES } from '../config.js';

/** Documento → tudo que as telas precisam. Função pura: mesma entrada, mesma saída. */
export function derive(doc, todayISO = today()) {
  const mes = monthKey(todayISO);
  const categorias = doc.categories?.length ? doc.categories : [];
  const catById = Object.fromEntries(categorias.map((c) => [c.id, c]));

  // ---- faturas ----
  const faturas = statementsOf(doc, todayISO);
  const cartoes = doc.cards.map((card) => cardView(card, doc, faturas, todayISO));

  // ---- parcelas ----
  const parcelas = doc.transactions.filter((t) => t.installment);
  const compras = byPurchase(parcelas, todayISO);
  const muro = wall(parcelas, mes, PADROES.muroMeses);
  const comprometidoCents = committed(parcelas, todayISO);

  // ---- dívidas ----
  const dividas = order(doc.debts, doc.settings?.debtMethod || PADROES.metodoDivida);
  const dividaTotalCents = totalBalance(doc.debts);
  const jurosDiaCents = totalDailyInterest(doc.debts);
  const jurosMesCents = totalMonthlyInterest(doc.debts);
  const minimosCents = minimumsToday(doc.debts);

  // ---- caixa ----
  const saldoCents = sum(doc.accounts.filter((a) => a.type !== 'savings').map((a) => a.balanceCents));
  const guardadoCents = sum(doc.accounts.filter((a) => a.type === 'savings').map((a) => a.balanceCents));

  const eventos = buildEvents(
    {
      recurring: doc.recurring || [],
      statements: faturas.futuras,
      scheduled: minimosAgendados(doc.debts, todayISO),
    },
    todayISO,
    addDays(todayISO, PADROES.projecaoDias)
  );

  const projecao = daily(saldoCents, eventos, todayISO, PADROES.projecaoDias);
  const porMes = monthly(projecao);
  const proximaEntrada = nextIncomeDate(eventos, todayISO);
  const livre = freeToSpend(saldoCents, eventos, todayISO, proximaEntrada || addDays(todayISO, 30));

  // ---- renda e sobra ----
  const rendaFixaCents = sum(
    (doc.recurring || []).filter((r) => r.kind === 'income').map((r) => Math.abs(r.amountCents))
  );
  const extrasMesCents = sum(
    doc.transactions
      .filter((t) => t.amountCents > 0 && t.extraordinary && (t.competence || monthKey(t.date)) === mes)
      .map((t) => t.amountCents)
  );
  const fixosCents = sum(
    (doc.recurring || []).filter((r) => r.kind === 'expense').map((r) => Math.abs(r.amountCents))
  );
  // Só os gastos fixos que são essenciais — moradia, contas — servem de base
  // para o custo mínimo enquanto não há 3 meses de histórico. Assinatura e
  // outros fixos não essenciais não entram: custo mínimo é só o que não dá
  // pra cortar.
  const fixosEssenciaisCents = sum(
    (doc.recurring || [])
      .filter((r) => r.kind === 'expense' && catById[r.categoryId]?.essential)
      .map((r) => Math.abs(r.amountCents))
  );
  const parcelasDoMesCents = muro[0]?.cents || 0;

  // Quanto realmente sobra. Somar só os fixos cadastrados mente para cima:
  // mercado, combustível e farmácia não estão lá e saem todo mês do mesmo
  // jeito. Por isso o custo de vida vem do histórico quando existe histórico,
  // e só cai para os fixos cadastrados quando o app ainda é novo.
  const custo = custoDeVida(doc, mes, fixosCents);
  const sobraCents = rendaFixaCents - custo.cents - parcelasDoMesCents;

  // ---- plano de saída ----
  const orcamentoDivida = doc.settings?.debtBudgetCents ?? Math.max(0, sobraCents);
  const plano = doc.debts.length
    ? payoffPlan(doc.debts, orcamentoDivida, {
        method: doc.settings?.debtMethod || PADROES.metodoDivida,
        fromMonth: mes,
      })
    : null;
  const planoMinimo = doc.debts.length ? minimumOnlyPlan(doc.debts, { fromMonth: mes }) : null;

  // ---- orçamento ----
  const comTeto = categorias.map((c) => ({ ...c, limitCents: doc.budgets?.[c.id] || 0 }));
  const orcamento = monthStatus(comTeto, doc.transactions, todayISO);
  const orcamentoGeral = orcamento.length ? overall(orcamento, todayISO) : null;
  // Teto numa categoria fixa nunca sai de zero: o gasto fixo é recorrente e não
  // passa por lançamento categorizado. A tela avisa em vez de deixar a barra
  // parada para sempre sem explicação.
  const tetoEmFixa = orcamento.filter((c) => c.fixed && c.limitCents > 0);
  const fixoVariavel = fixedVsVariable(doc.transactions, categorias, mes);

  // ---- vazamentos e diagnóstico ----
  const vazamentos = scan(doc.transactions, todayISO);
  const saude = diagnose({
    transactions: doc.transactions,
    categories: categorias,
    accounts: doc.accounts,
    debts: doc.debts,
    incomeCents: rendaFixaCents + extrasMesCents,
    savedCents: guardadoCents,
    todayISO,
    minimumCostManualCents: doc.profile?.minimumCostCents || 0,
    minimumCostFixedCents: fixosEssenciaisCents,
  });

  // ---- fila de revisão ----
  const semCategoria = doc.transactions.filter((t) => !t.categoryId && !t.installment);
  const { transactions: sugeridas, toReview } = categorizeAll(semCategoria, {
    rules: doc.rules || [],
    memory: doc.memory || {},
    merchants: MERCHANTS,
  });
  // A fila mostra primeiro o que o app não soube resolver sozinho.
  const revisao = [...toReview, ...sugeridas.filter((t) => t.categoryId)].slice(0, 40);

  // ---- progresso da saída ----
  const picoCents = Math.max(doc.profile?.debtPeakCents || 0, dividaTotalCents);
  const progresso = picoCents > 0 ? 1 - dividaTotalCents / picoCents : 0;

  // Um app sem nada dentro não tem número para mostrar — quem desenha decide o
  // que fazer com isso, mas quem decide se está vazio é aqui.
  const vazio = !doc.transactions.length && !doc.cards.length
    && !doc.debts.length && !(doc.recurring || []).length;

  return {
    todayISO,
    mes,
    vazio,
    doc,
    catById,
    categorias,
    cartoes,
    faturas,
    parcelas,
    compras,
    muro,
    comprometidoCents,
    dividas,
    dividaTotalCents,
    jurosDiaCents,
    jurosMesCents,
    minimosCents,
    picoCents,
    progresso,
    saldoCents,
    guardadoCents,
    eventos,
    projecao,
    porMes,
    proximaEntrada,
    livre,
    rendaFixaCents,
    extrasMesCents,
    fixosCents,
    parcelasDoMesCents,
    custoVida: custo,
    sobraCents,
    orcamentoDivida,
    plano,
    planoMinimo,
    orcamento,
    orcamentoGeral,
    tetoEmFixa,
    piorCategoria: orcamento.length ? worst(orcamento) : null,
    fixoVariavel,
    vazamentos,
    saude,
    revisao,
    lancamentos: [...doc.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12),
    guia: guiaStatus(doc),
  };
}

/**
 * Custo de vida do mês: o que sai de verdade, fora parcelas e dívidas.
 *
 * Prefere o histórico dos meses já fechados — o mês corrente sempre parece
 * barato porque ainda não terminou. Sem pelo menos dois meses fechados, usa os
 * gastos fixos cadastrados e avisa que o número está subestimado.
 */
function custoDeVida(doc, mesAtual, fixosCents) {
  const porMes = new Map();
  for (const t of doc.transactions) {
    if (t.amountCents >= 0) continue;
    if (t.installment) continue;               // parcela entra separada
    if (t.categoryId === 'taxas') continue;    // juros são conta da dívida
    const comp = t.competence || monthKey(t.date);
    if (comp >= mesAtual) continue;            // mês corrente ainda está aberto
    porMes.set(comp, (porMes.get(comp) || 0) + Math.abs(t.amountCents));
  }

  const valores = [...porMes.values()];
  if (valores.length < 2) {
    return { cents: fixosCents, source: 'fixos', months: valores.length, confident: false };
  }
  return {
    cents: Math.round(sum(valores) / valores.length),
    source: 'histórico',
    months: valores.length,
    confident: valores.length >= 3,
  };
}

/**
 * Faturas: agrupa os lançamentos de cartão pelo ciclo em que caem.
 *
 * Como cada parcela já nasce com `cycleId` e `dueDate` próprios, agrupar aqui
 * basta — as parcelas futuras entram nas faturas futuras sozinhas.
 */
export function statementsOf(doc, todayISO = today()) {
  const cardById = Object.fromEntries(doc.cards.map((c) => [c.id, c]));
  const grupos = new Map();

  for (const t of doc.transactions) {
    if (!t.cardId) continue;
    const card = cardById[t.cardId];
    if (!card) continue;
    const ciclo = t.cycleId ? { id: t.cycleId, dueDate: t.dueDate } : cycleFor(card, t.date);
    const chave = `${card.id}|${ciclo.id}`;
    const g = grupos.get(chave) || {
      id: chave,
      cardId: card.id,
      cardName: card.name,
      cycleId: ciclo.id,
      closeDate: ciclo.id,
      dueDate: ciclo.dueDate || dueDateOf(card, ciclo.id),
      totalCents: 0,
      items: [],
    };
    g.totalCents += Math.abs(t.amountCents);
    g.items.push(t);
    grupos.set(chave, g);
  }

  const todas = [...grupos.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return {
    todas,
    futuras: todas.filter((s) => s.dueDate >= todayISO),
    porCartao: (cardId) => todas.filter((s) => s.cardId === cardId),
  };
}

/** A visão de um cartão: fatura aberta, próxima a vencer, limite usado. */
function cardView(card, doc, faturas, todayISO) {
  const aberta = openCycle(card, todayISO);
  const doCartao = faturas.porCartao(card.id);
  const atual = doCartao.find((s) => s.cycleId === aberta.id);
  const fechadas = doCartao.filter((s) => s.closeDate < todayISO && s.dueDate >= todayISO);
  const proxima = doCartao.find((s) => s.dueDate >= todayISO);
  const atraso = doc.debts.find((d) => d.cardId === card.id);

  const usadoCents =
    sum(doCartao.filter((s) => s.dueDate >= todayISO).map((s) => s.totalCents)) +
    Math.abs(atraso?.balanceCents || 0);

  return {
    ...card,
    cycle: aberta,
    openCents: atual?.totalCents || 0,
    openItems: atual?.items || [],
    closedStatements: fechadas,
    nextStatement: proxima || null,
    overdue: atraso || null,
    usedCents: usadoCents,
    availableCents: Math.max(0, (card.limitCents || 0) - usadoCents),
    usedRatio: card.limitCents ? Math.min(1, usadoCents / card.limitCents) : 0,
  };
}

/**
 * Os mínimos das dívidas viram saídas mensais na projeção de caixa.
 *
 * Usa `minimumOf` do núcleo, e não uma conta própria. Esta função era a quarta
 * cópia da mesma regra: quando as outras três foram unificadas, ela ficou para
 * trás e continuou aceitando mínimo maior que o saldo. O resultado foi a
 * projeção despencar para R$ 650 mil negativos com uma dívida de R$ 10 mil.
 */
function minimosAgendados(debts, todayISO) {
  const out = [];
  for (const d of debts) {
    const minimo = minimumOf(d);
    if (minimo <= 0) continue;
    const dia = Number((d.since || todayISO).slice(8, 10)) || 10;
    for (let i = 0; i < 4; i++) {
      const mes = addMonthKey(monthKey(todayISO), i);
      const data = `${mes}-${String(Math.min(dia, 28)).padStart(2, '0')}`;
      if (data >= todayISO) {
        out.push({ id: `${d.id}@${mes}`, date: data, amountCents: -minimo, label: `Mínimo · ${d.name}`, kind: 'debt' });
      }
    }
  }
  return out;
}

/** Os sete passos do "Como usar" — o que já está feito e o que falta. */
export function guiaStatus(doc) {
  const passos = [
    { id: 'cartoes', label: 'Cartões e contas', where: 'em Cartões', hint: 'fechamento, vencimento e limite de cada um', go: 'cartoes', done: doc.cards.length > 0 && doc.accounts.length > 0 },
    { id: 'dividas', label: 'Dívidas e taxas', where: 'em Dívidas', hint: 'o juro vem escrito na fatura e no extrato', go: 'dividas', done: doc.debts.length > 0 },
    { id: 'fixos', label: 'Renda e gastos fixos', where: 'em Tudo', hint: 'salário, aluguel, luz, internet, assinaturas', go: 'tudo', done: (doc.recurring || []).length >= 2 },
    { id: 'tetos', label: 'Tetos por categoria', where: 'em Saúde', hint: 'quanto pode gastar em cada coisa', go: 'analise', done: Object.keys(doc.budgets || {}).length > 0 },
    { id: 'custo', label: 'Custo de vida mínimo', where: 'em Saúde', hint: 'só o que não dá pra cortar. É a base de tudo', go: 'analise', done: (doc.profile?.minimumCostCents || 0) > 0 },
    { id: 'cofrinhos', label: 'Criar seus cofrinhos', where: 'em Tudo', hint: 'comece só pela reserva de emergência', go: 'cofrinhos', done: (doc.goals || []).length > 0 },
    { id: 'backup', label: 'Primeiro backup', where: 'em Tudo', hint: 'sem servidor, o backup é você quem faz', go: 'tudo', done: !!doc.profile?.backupFeito },
  ];
  const feitos = passos.filter((p) => p.done).length;
  return { passos, feitos, total: passos.length, pendentes: passos.filter((p) => !p.done) };
}
