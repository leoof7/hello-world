import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasDoRecorrente, mensalDoRecorrente, buildEvents } from '../src/core/projection.js';
import { brlShort } from '../src/core/money.js';
import { openEnvelope } from '../src/data/backup.js';
import { derive } from '../src/ui/state.js';
import { emptyDocument } from '../src/data/migrations.js';
import { CATEGORIES } from '../src/seed/categories.js';

const HOJE = '2026-08-21';

// ------------------------------------------------ de quinze em quinze dias

test('sem frequência declarada, continua sendo uma vez por mês', () => {
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 5 }), [5]);
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 5, every: 'mes' }), [5]);
});

test('quinzenal acontece em dois dias do mês', () => {
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena' }), [5, 20]);
});

test('os dias saem em ordem, mesmo digitados trocados', () => {
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 20, dayOfMonth2: 5, every: 'quinzena' }), [5, 20]);
});

test('quinzenal sem o segundo dia inventa um quinze dias depois', () => {
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 5, every: 'quinzena' }), [5, 20]);
});

test('dois dias iguais não viram cobrança dupla no mesmo dia', () => {
  assert.deepEqual(diasDoRecorrente({ dayOfMonth: 10, dayOfMonth2: 10, every: 'quinzena' }), [10]);
});

test('nenhum dia passa de 28 — dia 31 não existe em fevereiro', () => {
  const dias = diasDoRecorrente({ dayOfMonth: 31, dayOfMonth2: 45, every: 'quinzena' });
  assert.ok(dias.every((d) => d >= 1 && d <= 28), JSON.stringify(dias));
});

// O ponto todo: a diarista de R$ 150 de 15 em 15 dias custa R$ 300 no mês.
test('o custo mensal conta todas as vezes que o fixo acontece', () => {
  const mensal = { amountCents: -15000, dayOfMonth: 5 };
  const quinzenal = { amountCents: -15000, dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena' };
  assert.equal(mensalDoRecorrente(mensal), 15000);
  assert.equal(mensalDoRecorrente(quinzenal), 30000, 'duas vezes R$ 150 são R$ 300 no mês');
});

test('a projeção gera os dois eventos, não um', () => {
  const eventos = buildEvents(
    { recurring: [{ id: 'd', label: 'Diarista', amountCents: -15000, dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena', kind: 'expense' }] },
    '2026-08-01', '2026-08-31'
  );
  assert.equal(eventos.length, 2);
  assert.deepEqual(eventos.map((e) => e.date), ['2026-08-05', '2026-08-20']);
  assert.ok(eventos.every((e) => e.amountCents === -15000), 'cada vez sai o valor de uma vez');
});

test('e continua gerando mês após mês', () => {
  const eventos = buildEvents(
    { recurring: [{ id: 'd', label: 'Diarista', amountCents: -15000, dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena', kind: 'expense' }] },
    '2026-08-01', '2026-10-31'
  );
  assert.equal(eventos.length, 6, 'três meses, duas vezes cada');
});

test('o fixo mensal não passou a sair duas vezes', () => {
  const eventos = buildEvents(
    { recurring: [{ id: 'a', label: 'Aluguel', amountCents: -120000, dayOfMonth: 5, kind: 'expense' }] },
    '2026-08-01', '2026-08-31'
  );
  assert.equal(eventos.length, 1);
});

test('um Pix quinzenal essencial entra inteiro no custo mínimo', () => {
  const doc = {
    ...emptyDocument(),
    categories: CATEGORIES.map((c) => ({ ...c })),
    recurring: [
      { id: 'd', label: 'Diarista', kind: 'expense', amountCents: -15000,
        dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena', categoryId: 'contas' },
    ],
  };
  const v = derive(doc, HOJE);
  assert.equal(v.fixosCents, 30000, 'R$ 300 por mês, não R$ 150');
  assert.equal(v.saude.minimumCost.cents, 30000);
});

// ------------------------------------------------------- o centavo importa

test('abaixo de mil reais o centavo aparece', () => {
  assert.equal(brlShort(2173), 'R$ 21,73', 'R$ 21,73 não é R$ 22');
  assert.equal(brlShort(99999), 'R$ 999,99');
  assert.equal(brlShort(0), 'R$ 0,00');
});

test('acima de mil reais o centavo some, que é o ponto da versão curta', () => {
  assert.equal(brlShort(100000), 'R$ 1.000');
  assert.equal(brlShort(470000), 'R$ 4.700');
  assert.equal(brlShort(12345678), 'R$ 123.457');
});

test('negativo curto mantém o sinal nos dois lados do corte', () => {
  assert.equal(brlShort(-2173), '−R$ 21,73');
  assert.equal(brlShort(-470000), '−R$ 4.700');
});

// ------------------------------------------- o backup que não abria no iPhone

test('arquivo que não é JSON dá recado de gente, não SyntaxError', () => {
  assert.throws(() => openEnvelope('isto não é json'), /não é um backup do Zero/);
});

test('JSON válido que não é backup também é recusado com nome', () => {
  assert.throws(() => openEnvelope('{"qualquer":"coisa"}'), /não é um backup do Zero/);
});

test('envelope de versão futura avisa para atualizar o app', () => {
  const futuro = JSON.stringify({ magic: 'zero-backup', format: 999, salt: 'x', payload: 'y' });
  assert.throws(() => openEnvelope(futuro), /versão mais nova/);
});
