import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expand, totalOf, wall, committed, byPurchase } from '../src/core/installments.js';
import { payoffPlan, minimumOnlyPlan, minimumsToday, order, dailyInterest, refinance, comparePlans, KIND } from '../src/core/debts.js';
import { buildEvents, daily, freeToSpend } from '../src/core/projection.js';
import { pace, fixedVsVariable } from '../src/core/budget.js';
import { sum } from '../src/core/money.js';

const nubank = { id: 'nu', name: 'Nubank', closingDay: 20, dueDay: 27, limitCents: 1200000 };

// ---------------- parcelamento ----------------

test('12x de R$ 1.200 vira doze parcelas que somam exatamente R$ 1.200', () => {
  const p = expand({ id: 'note', date: '2026-08-12', totalCents: 120000, count: 12, description: 'Notebook' }, nubank);
  assert.equal(p.length, 12);
  assert.equal(totalOf(p), 120000);
  assert.ok(p.every((e) => e.amountCents === 10000));
});

test('cada parcela cai numa fatura diferente, mês a mês', () => {
  const p = expand({ id: 'note', date: '2026-08-12', totalCents: 120000, count: 12 }, nubank);
  assert.equal(p[0].cycleId, '2026-08-20');
  assert.equal(p[0].dueDate, '2026-08-27');
  assert.equal(p[1].cycleId, '2026-09-20');
  assert.equal(p[11].cycleId, '2027-07-20');
  const ciclos = new Set(p.map((e) => e.cycleId));
  assert.equal(ciclos.size, 12, 'nenhuma parcela pode dividir fatura com outra da mesma compra');
});

test('compra no dia do fechamento empurra a primeira parcela pro ciclo seguinte', () => {
  const p = expand({ id: 'x', date: '2026-08-20', totalCents: 30000, count: 3 }, nubank);
  assert.equal(p[0].cycleId, '2026-09-20');
  assert.equal(p[2].cycleId, '2026-11-20');
});

test('a competência da parcela é o mês dela, não o da compra', () => {
  const p = expand({ id: 'x', date: '2026-08-12', totalCents: 120000, count: 12 }, nubank);
  assert.equal(p[0].competence, '2026-08');
  assert.equal(p[1].competence, '2026-09');
  assert.equal(p[5].competence, '2027-01');
});

test('o muro de parcelas soma o que já está comprometido em cada mês', () => {
  const note = expand({ id: 'note', date: '2026-08-12', totalCents: 120000, count: 12 }, nubank);
  const gol = expand({ id: 'gol', date: '2026-07-15', totalCents: 173898, count: 6 }, nubank);
  const w = wall([...note, ...gol], '2026-09', 12);
  assert.equal(w.length, 12);
  assert.equal(w[0].month, '2026-09');
  // set/26 tem parcela do notebook (10000) e da passagem (28983)
  assert.equal(w[0].cents, 10000 + 28983);
  // depois que a passagem acaba, sobra só o notebook
  const jan = w.find((x) => x.month === '2027-01');
  assert.equal(jan.cents, 10000);
});

test('o total comprometido ignora o que já foi pago', () => {
  const p = expand({ id: 'note', date: '2026-08-12', totalCents: 120000, count: 12 }, nubank);
  assert.equal(committed(p, '2026-08-01'), 120000, 'nada pago ainda');
  assert.equal(committed(p, '2026-10-01'), 100000, 'duas parcelas já venceram');
});

test('agrupa parcelas por compra e sabe em qual você está', () => {
  const p = expand({ id: 'note', date: '2026-08-12', totalCents: 120000, count: 12, description: 'Notebook Dell' }, nubank);
  const [g] = byPurchase(p, '2026-10-01');
  assert.equal(g.description, 'Notebook Dell');
  assert.equal(g.of, 12);
  assert.equal(g.current, 2, 'duas parcelas já venceram');
  assert.equal(g.remainingCents, 100000);
  assert.equal(g.lastDueDate, '2027-07-27');
});

// ---------------- dívidas ----------------

// Cenário realista: o mínimo do cartão é percentual do saldo (encolhe junto),
// o cheque especial não tem mínimo obrigatório, e o parcelamento tem valor fixo.
const dividas = [
  { id: 'rot', name: 'Rotativo Nubank', kind: KIND.REVOLVING, balanceCents: 648000, monthlyRate: 0.149, minPaymentRate: 0.15 },
  { id: 'che', name: 'Cheque especial', kind: KIND.OVERDRAFT, balanceCents: 320000, monthlyRate: 0.08, minPaymentCents: 0 },
  { id: 'par', name: 'Parcelamentos', kind: KIND.INSTALLMENT, balanceCents: 539213, monthlyRate: 0, minPaymentCents: 59913 },
];

test('a fila põe o rotativo antes do cheque especial, mesmo com saldo menor', () => {
  const o = order(dividas, 'avalanche');
  assert.equal(o[0].id, 'rot');
  assert.equal(o[1].id, 'che');
  assert.equal(o[2].id, 'par', 'parcelamento nunca disputa a fila');
});

test('bola de neve inverte a ordem das duas primeiras', () => {
  const o = order(dividas, 'snowball');
  assert.equal(o[0].id, 'che', 'menor saldo primeiro');
  assert.equal(o[1].id, 'rot');
  assert.equal(o[2].id, 'par');
});

test('o custo diário mostra o tamanho do problema', () => {
  assert.equal(dailyInterest(dividas[0]), Math.round(648000 * 0.149 / 30));
  assert.equal(dailyInterest(dividas[2]), 0, 'parcelamento não gera juro novo');
});

test('o plano quita tudo e devolve a data de liberdade', () => {
  const plan = payoffPlan(dividas, 200000, { fromMonth: '2026-09' });
  assert.ok(plan.done, 'com R$ 2.000 por mês tem que quitar');
  assert.ok(plan.monthsCount > 0 && plan.monthsCount < 60);
  assert.equal(plan.months[plan.months.length - 1].totalCents, 0);
  assert.equal(plan.freeMonth, plan.months[plan.months.length - 1].month);
});

test('o saldo total cai a cada mês, nunca sobe', () => {
  const plan = payoffPlan(dividas, 200000, { fromMonth: '2026-09' });
  for (let i = 1; i < plan.months.length; i++) {
    assert.ok(
      plan.months[i].totalCents <= plan.months[i - 1].totalCents,
      `mês ${plan.months[i].month} subiu`
    );
  }
});

test('pagar só o mínimo demora muito mais e custa muito mais juro', () => {
  const comPlano = payoffPlan(dividas, 200000, { fromMonth: '2026-09' });
  const soMinimo = minimumOnlyPlan(dividas, { fromMonth: '2026-09' });
  const ganho = comparePlans(soMinimo, comPlano);
  assert.ok(ganho.savedMonths > 0, 'o plano tem que ser mais rápido');
  assert.ok(ganho.savedInterestCents > 0, 'o plano tem que custar menos juro');
});

test('orçamento abaixo dos mínimos é sinalizado como inviável', () => {
  // R$ 1.284 livres contra R$ 1.571 de mínimos: não existe plano possível.
  // O app precisa dizer isso em vez de desenhar uma data de liberdade falsa.
  const minimos = minimumsToday(dividas);
  assert.ok(minimos > 128400, 'o cenário do exemplo é mesmo inviável');
  const plan = payoffPlan(dividas, 128400, { fromMonth: '2026-09', maxMonths: 24 });
  assert.equal(plan.viable, false);
  assert.equal(plan.done, false);
});

test('trocar o rotativo por empréstimo barato economiza juros e tempo', () => {
  const antes = payoffPlan(dividas, 200000, { fromMonth: '2026-09' });
  const depois = payoffPlan(refinance(dividas, 'rot', 0.035), 200000, { fromMonth: '2026-09' });
  const ganho = comparePlans(antes, depois);
  assert.ok(ganho.savedInterestCents > 0, 'trocar 14,9% por 3,5% tem que economizar');
  assert.ok(depois.monthsCount <= antes.monthsCount);
});

// ---------------- projeção ----------------

const recorrentes = [
  { id: 'sal', label: 'Salário', dayOfMonth: 5, amountCents: 840000, kind: 'income' },
  { id: 'alu', label: 'Aluguel', dayOfMonth: 10, amountCents: 180000, kind: 'expense' },
];

test('a projeção acha o dia exato em que o saldo fica negativo', () => {
  const eventos = buildEvents(
    { recurring: recorrentes, statements: [{ id: 'f1', dueDate: '2026-08-27', totalCents: 900000, cardName: 'Nubank' }] },
    '2026-08-19',
    '2026-11-17'
  );
  const proj = daily(535860, eventos, '2026-08-19', 90);
  assert.ok(proj.firstNegative, 'com fatura de 9.000 e saldo de 5.358 tem que ficar negativo');
  assert.equal(proj.firstNegative.date, '2026-08-27');
});

test('sem fatura grande a projeção não fica negativa', () => {
  const eventos = buildEvents({ recurring: recorrentes }, '2026-08-19', '2026-11-17');
  const proj = daily(535860, eventos, '2026-08-19', 90);
  assert.equal(proj.firstNegative, null);
  assert.ok(proj.endBalanceCents > 535860, 'salário maior que aluguel, saldo tem que crescer');
});

test('o salário aparece uma vez por mês, no dia certo', () => {
  const eventos = buildEvents({ recurring: recorrentes }, '2026-08-19', '2026-11-17');
  const salarios = eventos.filter((e) => e.sourceId === 'sal');
  assert.deepEqual(salarios.map((e) => e.date), ['2026-09-05', '2026-10-05', '2026-11-05']);
});

test('livre para gastar desconta tudo que já está contratado', () => {
  const eventos = buildEvents(
    { recurring: recorrentes, statements: [{ id: 'f1', dueDate: '2026-08-27', totalCents: 384722, cardName: 'Nubank' }] },
    '2026-08-19',
    '2026-09-05'
  );
  const livre = freeToSpend(535860, eventos, '2026-08-19', '2026-09-05');
  // saldo 5.358,60 − fatura 3.847,22 = 1.511,38 (o aluguel de setembro é depois do dia 5)
  assert.equal(livre.cents, 535860 - 384722);
  assert.ok(livre.perDayCents > 0);
});

// ---------------- orçamento ----------------

test('a marca de ritmo mostra onde você deveria estar hoje', () => {
  const p = pace(89210, 90000, '2026-08-19');
  assert.ok(p.overPace, '99% gasto no dia 19 de 31 está acima do ritmo');
  assert.ok(Math.abs(p.expectedRatio - 19 / 31) < 0.001);
  assert.equal(p.exceeded, false, 'ainda não estourou');
});

test('prevê o dia do estouro', () => {
  const p = pace(89210, 90000, '2026-08-19');
  assert.ok(p.breakDay >= 19 && p.breakDay <= 31);
  assert.equal(p.breakDate.slice(0, 7), '2026-08');
});

test('quem está no ritmo não é marcado como risco', () => {
  const p = pace(51200, 80000, '2026-08-19'); // 64% no dia 19/31 = 61% esperado
  assert.equal(p.exceeded, false);
  assert.ok(p.remainingCents === 28800);
});

test('gasto acima do teto é marcado como estourado', () => {
  const p = pace(95000, 90000, '2026-08-19');
  assert.equal(p.exceeded, true);
  assert.equal(p.remainingCents, 0);
});

test('separa gasto fixo de variável', () => {
  const cats = [{ id: 'casa', fixed: true }, { id: 'ali', fixed: false }];
  const txs = [
    { competence: '2026-08', categoryId: 'casa', amountCents: -294000 },
    { competence: '2026-08', categoryId: 'ali', amountCents: -89210 },
    { competence: '2026-07', categoryId: 'ali', amountCents: -50000 },
  ];
  const r = fixedVsVariable(txs, cats, '2026-08');
  assert.equal(r.fixedCents, 294000);
  assert.equal(r.variableCents, 89210);
  assert.ok(r.fixedRatio > 0.7);
});

// ---------------------------------------------- o mínimo nunca passa do saldo
//
// Estes existem porque a regra do mínimo estava escrita em três lugares e só
// um deles limitava ao saldo. Na tela, uma dívida de R$ 3.732 apareceu pedindo
// R$ 136.232 de mínimo — o valor tinha sido digitado no campo de porcentagem.

test('o mínimo de uma dívida nunca passa do saldo devedor', async () => {
  const { minimumOf, minimumsToday } = await import('../src/core/debts.js');
  const absurda = { balanceCents: 373239, monthlyRate: 0.16, minPaymentRate: 36.5 };
  assert.equal(minimumOf(absurda), 373239, 'no pior caso, o mínimo é o saldo inteiro');
  assert.equal(minimumsToday([absurda]), 373239);
});

test('mínimo fixo maior que o saldo também é limitado', async () => {
  const { minimumOf } = await import('../src/core/debts.js');
  assert.equal(minimumOf({ balanceCents: 100000, minPaymentCents: 900000 }), 100000);
});

test('percentual normal de cartão continua valendo', async () => {
  const { minimumOf } = await import('../src/core/debts.js');
  assert.equal(minimumOf({ balanceCents: 373239, minPaymentRate: 0.15 }), 55986);
});

test('dívida quitada não exige mínimo nenhum', async () => {
  const { minimumOf } = await import('../src/core/debts.js');
  assert.equal(minimumOf({ balanceCents: 0, minPaymentRate: 0.15, minPaymentCents: 50000 }), 0);
});

test('vale o maior entre o percentual e o fixo, dentro do saldo', async () => {
  const { minimumOf } = await import('../src/core/debts.js');
  const d = { balanceCents: 100000, minPaymentRate: 0.05, minPaymentCents: 8000 };
  assert.equal(minimumOf(d), 8000, '5% dá 5.000; o fixo de 8.000 é maior e vence');
});

test('as três contas de mínimo do app concordam entre si', async () => {
  const { minimumsToday, payoffPlan, minimumOnlyPlan } = await import('../src/core/debts.js');
  const dividas = [
    { id: 'a', name: 'Rotativo', kind: 'revolving', balanceCents: 648000, monthlyRate: 0.149, minPaymentRate: 0.15 },
    { id: 'b', name: 'Cheque', kind: 'overdraft', balanceCents: 320000, monthlyRate: 0.08, minPaymentCents: 20000 },
  ];
  const hoje = minimumsToday(dividas);
  const plano = payoffPlan(dividas, hoje, { fromMonth: '2026-08' });
  assert.equal(plano.minimumsTotalCents, hoje, 'payoffPlan usa a mesma regra');
  assert.equal(minimumOnlyPlan(dividas, { fromMonth: '2026-08' }).minimumsTotalCents, hoje);
  assert.ok(plano.viable, 'pagando exatamente os mínimos, o plano é viável');
});

test('dívida impossível é recusada antes de virar dado guardado', async () => {
  const { validateDebt } = await import('../src/core/debts.js');
  // o caso real: "3650" digitado no campo de porcentagem
  assert.equal(validateDebt({ balanceCents: 373239, minPaymentRate: 36.5 }), 'minimo-acima-de-100');
  assert.equal(validateDebt({ balanceCents: 373239, monthlyRate: 16 }), 'juros-acima-de-100');
  assert.equal(validateDebt({ balanceCents: 100000, minPaymentCents: 900000 }), 'minimo-maior-que-saldo');
});

test('dívida plausível passa sem reclamação', async () => {
  const { validateDebt } = await import('../src/core/debts.js');
  assert.equal(validateDebt({ balanceCents: 648000, monthlyRate: 0.149, minPaymentRate: 0.15 }), null);
  assert.equal(validateDebt({ balanceCents: 320000, monthlyRate: 0.08, minPaymentCents: 20000 }), null);
  assert.equal(validateDebt({}), null, 'formulário em branco não é erro');
  assert.equal(validateDebt({ balanceCents: 0, minPaymentCents: 50000 }), null,
    'sem saldo não dá para comparar mínimo com saldo');
});

test('100% de mínimo é o limite e ainda é aceito', async () => {
  const { validateDebt, minimumOf } = await import('../src/core/debts.js');
  assert.equal(validateDebt({ balanceCents: 100000, minPaymentRate: 1 }), null);
  assert.equal(minimumOf({ balanceCents: 100000, minPaymentRate: 1 }), 100000);
});
