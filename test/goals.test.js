import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyYield, monthsToGoal, goalProjection } from '../src/core/goals.js';

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
