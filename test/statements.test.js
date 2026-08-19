import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleFor, dueDateOf, closeDateOf, cyclesBetween, previousCycle, nextCycle } from '../src/core/statements.js';
import { addMonths, clampedDay } from '../src/core/dates.js';

const nubank = { id: 'nu', closingDay: 20, dueDay: 27, limitCents: 1200000 };
const inter = { id: 'in', closingDay: 28, dueDay: 5, limitCents: 350000 };
const extremo = { id: 'ex', closingDay: 31, dueDay: 10, limitCents: 100000 };

test('compra antes do fechamento cai na fatura do mês', () => {
  const c = cycleFor(nubank, '2026-08-19');
  assert.equal(c.closeDate, '2026-08-20');
  assert.equal(c.dueDate, '2026-08-27');
});

test('compra NO DIA do fechamento cai na fatura seguinte', () => {
  const c = cycleFor(nubank, '2026-08-20');
  assert.equal(c.closeDate, '2026-09-20', 'o dia do fechamento já pertence ao próximo ciclo');
  assert.equal(c.dueDate, '2026-09-27');
});

test('compra depois do fechamento cai na fatura seguinte', () => {
  assert.equal(cycleFor(nubank, '2026-08-21').closeDate, '2026-09-20');
});

test('o ciclo cobre do fechamento anterior até a véspera do próximo', () => {
  const c = cycleFor(nubank, '2026-08-19');
  assert.equal(c.start, '2026-07-20');
  assert.equal(c.end, '2026-08-19');
});

test('vencimento cai no mês seguinte quando é menor que o fechamento', () => {
  const c = cycleFor(inter, '2026-08-27');
  assert.equal(c.closeDate, '2026-08-28');
  assert.equal(c.dueDate, '2026-09-05', 'fecha 28/ago, vence 5/set');
});

test('fechamento dia 31 vira dia 28 em fevereiro', () => {
  assert.equal(closeDateOf(extremo, 2027, 2), '2027-02-28');
  const c = cycleFor(extremo, '2027-02-27');
  assert.equal(c.closeDate, '2027-02-28');
  assert.equal(c.dueDate, '2027-03-10');
});

test('fevereiro bissexto usa dia 29', () => {
  assert.equal(closeDateOf(extremo, 2028, 2), '2028-02-29');
});

test('compra em 28/fev num cartão que fecha dia 31 vai pro ciclo de março', () => {
  const c = cycleFor(extremo, '2027-02-28');
  assert.equal(c.closeDate, '2027-03-31');
});

test('vencimento dia 31 em mês curto é ajustado', () => {
  const card = { id: 'x', closingDay: 5, dueDay: 31 };
  const c = cycleFor(card, '2027-02-03');
  assert.equal(c.closeDate, '2027-02-05');
  assert.equal(c.dueDate, '2027-02-28');
});

test('ciclo anterior e seguinte são inversos', () => {
  const c = cycleFor(nubank, '2026-08-19');
  assert.equal(previousCycle(nubank, c).closeDate, '2026-07-20');
  assert.equal(nextCycle(nubank, c).closeDate, '2026-09-20');
  assert.equal(nextCycle(nubank, previousCycle(nubank, c)).closeDate, c.closeDate);
});

test('ciclos entre duas datas vêm completos e em ordem', () => {
  const list = cyclesBetween(nubank, '2026-08-01', '2026-12-31');
  assert.deepEqual(
    list.map((c) => c.closeDate),
    ['2026-08-20', '2026-09-20', '2026-10-20', '2026-11-20', '2026-12-20']
  );
});

test('a virada de ano funciona', () => {
  const c = cycleFor(nubank, '2026-12-21');
  assert.equal(c.closeDate, '2027-01-20');
  assert.equal(c.dueDate, '2027-01-27');
});

test('doze meses seguidos de fechamento não pulam nem repetem', () => {
  let c = cycleFor(nubank, '2026-01-05');
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    assert.ok(!seen.has(c.closeDate), `repetiu ${c.closeDate}`);
    seen.add(c.closeDate);
    const anterior = c.closeDate;
    c = nextCycle(nubank, c);
    assert.equal(c.closeDate, addMonths(anterior, 1), 'cada ciclo avança exatamente um mês');
    assert.ok(c.dueDate > c.closeDate, 'vencimento sempre depois do fechamento');
  }
  assert.equal(seen.size, 12);
});

test('o intervalo do ciclo nunca deixa buraco nem sobreposição', () => {
  let c = cycleFor(inter, '2026-03-10');
  for (let i = 0; i < 14; i++) {
    const prox = nextCycle(inter, c);
    assert.equal(prox.start, c.closeDate, 'o próximo ciclo começa no fechamento do anterior');
    assert.ok(c.end < prox.start, 'sem sobreposição entre ciclos');
    c = prox;
  }
});
