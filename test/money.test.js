import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatCents, brl, splitInstallments, sum, monthlyToYearly } from '../src/core/money.js';

test('lê valores no formato brasileiro', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('R$ 45,90'), 4590);
  assert.equal(toCents('0,05'), 5);
  assert.equal(toCents('1234,56'), 123456);
  assert.equal(toCents('-120,00'), -12000);
  assert.equal(toCents(1234.56), 123456);
});

test('distingue ponto de milhar de ponto decimal', () => {
  assert.equal(toCents('1.234'), 123400, 'três casas depois do ponto é milhar');
  assert.equal(toCents('45.9'), 4590, 'uma casa é decimal');
  assert.equal(toCents('45.90'), 4590, 'duas casas é decimal');
});

test('formata de volta no padrão brasileiro', () => {
  assert.equal(formatCents(123456), '1.234,56');
  assert.equal(formatCents(5), '0,05');
  assert.equal(formatCents(-12000), '−120,00');
  assert.equal(brl(384722), 'R$ 3.847,22');
  assert.equal(brl(-12000), '−R$ 120,00');
});

test('não perde centavo em ida e volta', () => {
  for (const s of ['0,01', '9,99', '1.000,00', '8.400,00', '12.345,67']) {
    assert.equal(formatCents(toCents(s)), s);
  }
});

test('parcelas somam exatamente o total', () => {
  const p = splitInstallments(120000, 12);
  assert.equal(p.length, 12);
  assert.equal(sum(p), 120000, '12x de R$ 1.200 tem que somar R$ 1.200');
  assert.ok(p.every((v) => v === 10000));
});

test('o resto vai na primeira parcela, como fazem os emissores', () => {
  const p = splitInstallments(10000, 3);
  assert.deepEqual(p, [3334, 3333, 3333]);
  assert.equal(sum(p), 10000);
});

test('parcelamento com resto grande continua exato', () => {
  const p = splitInstallments(640000, 7); // 6.400 em 7x
  assert.equal(sum(p), 640000);
  assert.equal(p[0] - p[1], 640000 % 7);
});

test('uma parcela devolve o total inteiro', () => {
  assert.deepEqual(splitInstallments(9999, 1), [9999]);
});

test('converte taxa mensal em anual composta', () => {
  // rotativo a 14,9% ao mês passa de 400% ao ano
  const anual = monthlyToYearly(0.149);
  assert.ok(anual > 4 && anual < 4.6, `esperava ~435%, veio ${(anual * 100).toFixed(1)}%`);
  // cheque especial no teto do BC: 8% ao mês
  const che = monthlyToYearly(0.08);
  assert.ok(che > 1.5 && che < 1.6, `esperava ~151%, veio ${(che * 100).toFixed(1)}%`);
});
