import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasDoRecorrente, mensalDoRecorrente, buildEvents, lancamentosDeFixos } from '../src/core/projection.js';
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

// -------------------------------- os fixos entram nas telas de gasto
//
// Aluguel, luz e internet moram em `recurring` e nunca viraram transação. A
// projeção sempre soube deles; as telas de gasto, não — e por isso "fixo
// contra variável" dizia 0% fixo com R$ 1.170 de fixo cadastrado, a tendência
// mensal mostrava só compras avulsas, e o "para onde foi" perdia a maior
// fatia do mês. Três telas discordando do resto do app sobre o mesmo dinheiro.

test('o gasto fixo do mês vira lançamento para as telas de gasto', async () => {
  const { lancamentosDeFixos } = await import('../src/core/projection.js');
  const fixos = [
    { id: 'a', label: 'Aluguel', kind: 'expense', amountCents: -120000, dayOfMonth: 10, categoryId: 'moradia' },
    { id: 'l', label: 'Luz', kind: 'expense', amountCents: -18000, dayOfMonth: 10, categoryId: 'contas' },
  ];
  const r = lancamentosDeFixos(fixos, '2026-07', '2026-08-21');
  assert.equal(r.length, 2);
  assert.equal(r.reduce((s, t) => s + Math.abs(t.amountCents), 0), 138000);
  assert.ok(r.every((t) => t.derivado), 'marcados como derivados, para não virarem lançamento de verdade');
});

test('no mês corrente só entra o que já passou', () => {
  // dia 21: o fixo do dia 10 já saiu, o do dia 28 ainda não.
  const fixos = [
    { id: 'a', label: 'Aluguel', kind: 'expense', amountCents: -120000, dayOfMonth: 10, categoryId: 'moradia' },
    { id: 'f', label: 'Faxina', kind: 'expense', amountCents: -20000, dayOfMonth: 28, categoryId: 'contas' },
  ];
  const r = lancamentosDeFixos(fixos, '2026-08', '2026-08-21');
  assert.equal(r.length, 1, 'contar o do dia 28 faria o mês nascer quase todo gasto');
  assert.equal(r[0].description, 'Aluguel');
});

// A regra que decide entre contar duas vezes e não contar.
test('se a pessoa lança gastos da categoria, o fixo dela não é somado de novo', () => {
  const fixos = [{ id: 'a', label: 'Aluguel', kind: 'expense', amountCents: -120000, dayOfMonth: 10, categoryId: 'moradia' }];
  const lancados = [{ id: 't', date: '2026-07-10', amountCents: -120000, categoryId: 'moradia' }];
  assert.deepEqual(lancamentosDeFixos(fixos, '2026-07', '2026-08-21', lancados), [],
    'quem registra o aluguel não pode ver dois aluguéis no mês');
});

test('mas o fixo de uma categoria que ela não lança continua entrando', () => {
  const fixos = [
    { id: 'a', label: 'Aluguel', kind: 'expense', amountCents: -120000, dayOfMonth: 10, categoryId: 'moradia' },
    { id: 'l', label: 'Luz', kind: 'expense', amountCents: -18000, dayOfMonth: 10, categoryId: 'contas' },
  ];
  const lancados = [{ id: 't', date: '2026-07-10', amountCents: -120000, categoryId: 'moradia' }];
  const r = lancamentosDeFixos(fixos, '2026-07', '2026-08-21', lancados);
  assert.equal(r.length, 1);
  assert.equal(r[0].description, 'Luz', 'moradia foi lançada; contas não');
});

test('renda fixa não vira gasto', () => {
  const r = lancamentosDeFixos(
    [{ id: 's', label: 'Salário', kind: 'income', amountCents: 470000, dayOfMonth: 5 }],
    '2026-07', '2026-08-21');
  assert.deepEqual(r, []);
});
