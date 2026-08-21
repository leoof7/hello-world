import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ativa, somenteAtivas } from '../src/core/debts.js';
import { derive, guiaStatus } from '../src/ui/state.js';
import { emptyDocument } from '../src/data/migrations.js';
import { CATEGORIES } from '../src/seed/categories.js';

const HOJE = '2026-08-21';

const doc = (extra) => ({
  ...emptyDocument(),
  categories: CATEGORIES.map((c) => ({ ...c })),
  ...extra,
});

const divida = (id, cents, taxa, extra = {}) => ({
  id, name: id, kind: 'revolving', balanceCents: -cents, monthlyRate: taxa,
  minPaymentRate: 0.15, minPaymentCents: 0, dueDay: 10, since: '2026-01-01', ...extra,
});

// ------------------------------------------------------------ o padrão

test('dívida sem o campo continua ativa — nada de migração para quem já tinha', () => {
  assert.equal(ativa({ id: 'x' }), true);
  assert.equal(ativa({ id: 'x', active: true }), true);
  assert.equal(ativa({ id: 'x', active: false }), false);
});

test('somenteAtivas tira as pausadas e mantém a ordem', () => {
  const lista = [divida('a', 1000, 0.1), divida('b', 2000, 0.2, { active: false }), divida('c', 3000, 0.3)];
  assert.deepEqual(somenteAtivas(lista).map((d) => d.id), ['a', 'c']);
});

// ---------------------------------------- pausar sai de TODA a matemática

test('pausar tira a dívida de todos os números de uma vez', () => {
  const ativas = derive(doc({ debts: [divida('cartao', 500000, 0.15), divida('emprestimo', 300000, 0.02)] }), HOJE);
  const comPausa = derive(doc({ debts: [divida('cartao', 500000, 0.15), divida('emprestimo', 300000, 0.02, { active: false })] }), HOJE);

  assert.equal(ativas.dividaTotalCents, 800000);
  assert.equal(comPausa.dividaTotalCents, 500000, 'o total ignora a pausada');

  assert.ok(comPausa.jurosMesCents < ativas.jurosMesCents, 'o juro do mês também');
  assert.ok(comPausa.jurosDiaCents < ativas.jurosDiaCents, 'e o juro por dia');
  assert.ok(comPausa.minimosCents < ativas.minimosCents, 'e o mínimo do mês');

  assert.deepEqual(comPausa.dividas.map((d) => d.id), ['cartao'], 'e a ordem de pagar');
  assert.equal(comPausa.dividasDesligadas.length, 1, 'mas ela não sumiu — está na lista das pausadas');
  assert.equal(comPausa.dividasDesligadas[0].id, 'emprestimo');
});

test('pausar não some com a dívida do documento', () => {
  const d = doc({ debts: [divida('x', 100000, 0.1, { active: false })] });
  const v = derive(d, HOJE);
  assert.equal(v.debts.length, 1, 'continua cadastrada');
  assert.equal(v.dividaTotalCents, 0, 'mas não conta');
});

// O caso que mais importa: dívida pausada não pode continuar puxando a
// projeção de caixa para baixo com um mínimo mensal que ninguém vai pagar.
test('o mínimo de uma dívida pausada não vira saída na projeção', () => {
  const base = { accounts: [{ id: 'c1', name: 'Conta', type: 'checking', balanceCents: 100000 }] };
  const ativas = derive(doc({ ...base, debts: [divida('grande', 900000, 0.15)] }), HOJE);
  const pausada = derive(doc({ ...base, debts: [divida('grande', 900000, 0.15, { active: false })] }), HOJE);

  assert.ok(ativas.projecao.min.cents < pausada.projecao.min.cents,
    'com a dívida ativa a projeção cai mais fundo');
  assert.equal(pausada.projecao.min.cents, 100000, 'pausada, nada é descontado do saldo');
});

test('pausar todas as dívidas não deixa plano meio pronto', () => {
  const v = derive(doc({ debts: [divida('a', 100000, 0.1, { active: false })] }), HOJE);
  assert.equal(v.plano, null, 'sem dívida ativa não existe plano de saída');
  assert.equal(v.dividaTotalCents, 0);
});

// ------------------------------------------------- custo de vida mínimo

const fixo = (label, categoryId, cents) =>
  ({ id: label, label, kind: 'expense', dayOfMonth: 10, amountCents: -cents, categoryId });

test('o custo mínimo sai dos gastos fixos essenciais cadastrados', () => {
  const v = derive(doc({ recurring: [fixo('Aluguel', 'moradia', 120000), fixo('Luz', 'contas', 18000)] }), HOJE);
  assert.equal(v.saude.minimumCost.cents, 138000);
  assert.equal(v.saude.minimumCost.source, 'fixos');
});

// O bug: o app calculava R$ 1.380 e o checklist continuava pedindo para
// preencher o custo mínimo, porque só olhava o campo digitado à mão.
test('o checklist não cobra um custo mínimo que o app já calculou', () => {
  const d = doc({ recurring: [fixo('Aluguel', 'moradia', 120000)] });
  const v = derive(d, HOJE);
  assert.ok(v.saude.minimumCost.cents > 0, 'o app sabe o número');
  assert.ok(!v.guia.pendentes.some((p) => p.id === 'custo'), 'então para de pedir');
});

test('sem nenhum dado, o checklist continua cobrando', () => {
  const v = derive(doc({}), HOJE);
  assert.ok(v.guia.pendentes.some((p) => p.id === 'custo'));
});

test('digitar o valor à mão também basta para o checklist', () => {
  const d = doc({});
  d.profile.minimumCostCents = 200000;
  assert.ok(!guiaStatus(d, { custoConhecidoCents: 0 }).pendentes.some((p) => p.id === 'custo'));
});

// O outro lado do mesmo bug: gasto fixo sem categoria vale zero no custo
// mínimo, e antes isso acontecia calado.
test('gasto fixo sem categoria fica listado para a tela poder cobrar', () => {
  const v = derive(doc({
    recurring: [fixo('Aluguel', null, 120000), fixo('Internet', null, 12000), fixo('Luz', 'contas', 18000)],
  }), HOJE);

  assert.equal(v.fixosSemCategoria.length, 2);
  assert.equal(v.fixosSemCategoriaCents, 132000);
  assert.equal(v.saude.minimumCost.cents, 18000, 'só o categorizado entra no mínimo');
});

test('com tudo categorizado não sobra aviso nenhum', () => {
  const v = derive(doc({ recurring: [fixo('Aluguel', 'moradia', 120000)] }), HOJE);
  assert.deepEqual(v.fixosSemCategoria, []);
});

test('renda sem categoria não é cobrada como gasto sem categoria', () => {
  const v = derive(doc({
    recurring: [{ id: 's', label: 'Salário', kind: 'income', dayOfMonth: 5, amountCents: 470000 }],
  }), HOJE);
  assert.deepEqual(v.fixosSemCategoria, [], 'entrada não tem custo mínimo para compor');
});
