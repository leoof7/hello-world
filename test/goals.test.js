import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyYield, monthsToGoal, goalProjection } from '../src/core/goals.js';
import { derive } from '../src/ui/state.js';
import { emptyDocument } from '../src/data/migrations.js';

const HOJE = '2026-08-21';

test('rendimento do mês é o saldo vezes a taxa', () => {
  assert.equal(monthlyYield(200000, 0.009), 1800, 'R$ 2.000 a 0,9% rende R$ 18');
  assert.equal(monthlyYield(200000, 0), 0, 'sem taxa não rende');
  assert.equal(monthlyYield(0, 0.01), 0);
});

test('sem rendimento, o prazo é a divisão de sempre', () => {
  const meses = monthsToGoal({ savedCents: 0, monthlyCents: 50000, targetCents: 500000 });
  assert.equal(meses, 10, 'R$ 5.000 guardando R$ 500 dá dez meses');
});

test('com rendimento a meta chega antes', () => {
  const sem = monthsToGoal({ savedCents: 100000, monthlyCents: 50000, targetCents: 1000000 });
  const com = monthsToGoal({ savedCents: 100000, monthlyCents: 50000, targetCents: 1000000, monthlyRate: 0.01 });
  assert.ok(com < sem, `com rendimento (${com}) tem que ser menos meses que sem (${sem})`);
});

test('meta já atingida não pede mais nenhum mês', () => {
  assert.equal(monthsToGoal({ savedCents: 500000, targetCents: 500000 }), 0);
  assert.equal(monthsToGoal({ savedCents: 600000, monthlyCents: 1000, targetCents: 500000 }), 0);
});

test('sem aporte e sem rendimento a meta não chega nunca', () => {
  assert.equal(monthsToGoal({ savedCents: 10000, monthlyCents: 0, targetCents: 500000 }), null);
});

test('só o rendimento, sem aporte nenhum, ainda chega lá', () => {
  const meses = monthsToGoal({ savedCents: 400000, monthlyCents: 0, targetCents: 500000, monthlyRate: 0.01 });
  assert.ok(meses > 0 && meses < 600, `deveria chegar em algum momento, veio ${meses}`);
});

test('meta sem valor-alvo não tem prazo — é acompanhamento, não meta', () => {
  assert.equal(monthsToGoal({ savedCents: 0, monthlyCents: 50000, targetCents: 0 }), null);
});

test('a projeção separa o que você depositou do que o dinheiro rendeu', () => {
  const p = goalProjection({ savedCents: 0, monthlyCents: 50000, targetCents: 500000, monthlyRate: 0.01 });
  assert.equal(p.depositedCents, 50000 * p.months, 'o depositado é aporte vezes meses');
  assert.ok(p.yieldCents > 0, 'e o resto do saldo veio do rendimento');
  assert.equal(p.finalCents, p.depositedCents + p.yieldCents, 'as duas partes somam o total');
  assert.ok(p.finalCents >= 500000, 'e o total alcança a meta');
});

test('sem taxa, a projeção não inventa rendimento', () => {
  const p = goalProjection({ savedCents: 0, monthlyCents: 50000, targetCents: 500000 });
  assert.equal(p.months, 10);
  assert.equal(p.yieldCents, 0);
});

// ------------------------------ o cofrinho da viagem não é reserva
//
// Perguntar "quantos meses você aguenta sem renda?" e somar o dinheiro do
// casamento responde alto demais. É a conta que decide se dá para largar um
// emprego ruim, então ela não pode contar dinheiro que já tem dono.

test('por padrão o cofrinho conta como reserva — quem cadastrou antes da flag não vê o número mudar', () => {
  const doc = {
    ...emptyDocument(),
    goals: [{ id: 'g1', name: 'Reserva', savedCents: 500000, targetCents: 1000000 }],
  };
  const v = derive(doc, HOJE);
  assert.equal(v.cofrinhosDeReservaCents, 500000);
  assert.equal(v.reservaCents, 500000);
});

test('cofrinho fora da reserva sai do colchão e continua no patrimônio', () => {
  const doc = {
    ...emptyDocument(),
    goals: [
      { id: 'g1', name: 'Reserva', savedCents: 300000, targetCents: 1000000 },
      { id: 'g2', name: 'Viagem', savedCents: 200000, targetCents: 400000, contaReserva: false },
    ],
  };
  const v = derive(doc, HOJE);
  assert.equal(v.emCofrinhosCents, 500000, 'o patrimônio soma os dois');
  assert.equal(v.cofrinhosDeReservaCents, 300000, 'a reserva soma só o que se resgata num aperto');
  assert.equal(v.cofrinhosComDestinoCents, 200000);
  assert.equal(v.reservaCents, 300000);
});

test('tirar da reserva não muda o patrimônio líquido — o dinheiro continua sendo seu', () => {
  const base = {
    ...emptyDocument(),
    goals: [{ id: 'g2', name: 'Viagem', savedCents: 200000, targetCents: 400000 }],
  };
  const contando = derive(base, HOJE);
  const fora = derive({ ...base, goals: [{ ...base.goals[0], contaReserva: false }] }, HOJE);
  assert.equal(
    fora.saude.netWorth.netCents,
    contando.saude.netWorth.netCents,
    'a flag decide se é colchão, não se o dinheiro existe');
});

test('a flag muda os meses de reserva que o app promete', () => {
  const base = {
    ...emptyDocument(),
    profile: { minimumCostCents: 100000 },
    goals: [{ id: 'g2', name: 'Casamento', savedCents: 600000, targetCents: 600000 }],
  };
  const contando = derive(base, HOJE);
  const fora = derive({ ...base, goals: [{ ...base.goals[0], contaReserva: false }] }, HOJE);
  assert.ok(
    contando.saude.emergency.months > fora.saude.emergency.months,
    `contar o casamento inflava o fôlego: ${contando.saude.emergency.months} vs ${fora.saude.emergency.months}`);
});
