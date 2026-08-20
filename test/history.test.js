import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlySpend, dailyNet, worstDay } from '../src/core/history.js';

const HOJE = '2026-08-20';

test('soma o gasto de cada um dos últimos meses, mês corrente em aberto', () => {
  const tx = [
    { date: '2026-06-10', competence: '2026-06', amountCents: -10000 },
    { date: '2026-07-05', competence: '2026-07', amountCents: -20000 },
    { date: '2026-07-15', competence: '2026-07', amountCents: -5000 },
    { date: '2026-08-01', competence: '2026-08', amountCents: -3000 },
    { date: '2026-08-05', competence: '2026-08', amountCents: 100000 }, // entrada, não conta
  ];
  const meses = monthlySpend(tx, HOJE, { months: 3 });
  assert.deepEqual(meses.map((m) => m.month), ['2026-06', '2026-07', '2026-08']);
  assert.equal(meses[0].cents, 10000);
  assert.equal(meses[1].cents, 25000);
  assert.equal(meses[2].cents, 3000);
  assert.equal(meses[2].aberto, true, 'mês corrente vem marcado como aberto');
  assert.equal(meses[0].aberto, false);
});

test('mês sem nenhum lançamento aparece com zero, não some da lista', () => {
  const meses = monthlySpend([], HOJE, { months: 3 });
  assert.equal(meses.length, 3);
  assert.ok(meses.every((m) => m.cents === 0));
});

test('saldo diário soma entradas e saídas do mesmo dia', () => {
  const tx = [
    { date: '2026-08-05', competence: '2026-08', amountCents: -5000 },
    { date: '2026-08-05', competence: '2026-08', amountCents: 20000 },
    { date: '2026-08-10', competence: '2026-08', amountCents: -30000 },
    { date: '2026-07-10', competence: '2026-07', amountCents: -99999 }, // outro mês, não conta
  ];
  const { dias, primeiroDiaSemana } = dailyNet(tx, '2026-08');
  assert.equal(dias.length, 31, 'agosto tem 31 dias');
  assert.equal(dias.find((d) => d.day === 5).cents, 15000);
  assert.equal(dias.find((d) => d.day === 10).cents, -30000);
  assert.equal(dias.find((d) => d.day === 1).cents, 0, 'dia sem lançamento é zero, não ausente');
  assert.ok(primeiroDiaSemana >= 0 && primeiroDiaSemana <= 6);
});

test('acha o dia que mais gastou no mês', () => {
  const { dias } = dailyNet([
    { date: '2026-08-05', competence: '2026-08', amountCents: -5000 },
    { date: '2026-08-10', competence: '2026-08', amountCents: -30000 },
    { date: '2026-08-15', competence: '2026-08', amountCents: 50000 },
  ], '2026-08');
  const pior = worstDay(dias);
  assert.equal(pior.day, 10);
  assert.equal(pior.cents, -30000);
});

test('sem nenhum dia negativo, não tem pior dia', () => {
  const { dias } = dailyNet([{ date: '2026-08-05', competence: '2026-08', amountCents: 5000 }], '2026-08');
  assert.equal(worstDay(dias), null);
});
