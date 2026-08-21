import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND, ehCredito, ehDebito, ehBeneficio, geraFatura, permiteParcelar,
  validarCartao, saldoDoBeneficio, proximaRecarga, previsaoDoBeneficio,
  valesDe, debitosFuturos,
} from '../src/core/cards.js';

const HOJE = '2026-08-15';

const credito = { id: 'nu', name: 'Nubank', kind: KIND.CREDIT, closingDay: 20, dueDay: 27, limitCents: 500000 };
const debito = { id: 'db', name: 'Débito Itaú', kind: KIND.DEBIT, accountId: 'c1' };
const vale = {
  id: 'va', name: 'Vale Alimentação', kind: KIND.BENEFIT,
  balanceCents: 80000, balanceAsOf: '2026-08-05', reloadCents: 80000, reloadDay: 5,
};

const gasto = (cardId, date, cents, description = 'Mercado') => ({
  id: `${cardId}-${date}-${cents}`, cardId, date, amountCents: -cents, description,
});

// -------------------------------------------------------- quem é o quê

test('cartão sem tipo é de crédito — é o que todo cartão era antes', () => {
  assert.equal(ehCredito({ id: 'x', name: 'Antigo' }), true);
  assert.equal(ehDebito({ id: 'x' }), false);
  assert.equal(ehBeneficio({ id: 'x' }), false);
});

test('só o crédito vira fatura e só ele parcela', () => {
  assert.equal(geraFatura(credito), true);
  assert.equal(geraFatura(debito), false, 'débito sai da conta na hora, não tem fatura');
  assert.equal(geraFatura(vale), false, 'vale passa como crédito na maquininha, mas não gera fatura');

  assert.equal(permiteParcelar(credito), true);
  assert.equal(permiteParcelar(debito), false, 'não dá para dividir um débito em 12x');
  assert.equal(permiteParcelar(vale), false);
});

// ------------------------------------------------------------- validação

test('cartão de débito sem conta é recusado', () => {
  const erros = validarCartao({ name: 'X', kind: KIND.DEBIT }, { accounts: [] });
  assert.ok(erros.some((e) => /precisa de uma conta/.test(e)));
});

test('débito apontando para conta que sumiu também é recusado', () => {
  const erros = validarCartao(debito, { accounts: [{ id: 'outra' }] });
  assert.ok(erros.some((e) => /não existe mais/.test(e)));
});

test('débito com conta de verdade passa', () => {
  assert.deepEqual(validarCartao(debito, { accounts: [{ id: 'c1' }] }), []);
});

test('crédito com dia fora do calendário é recusado', () => {
  const erros = validarCartao({ ...credito, closingDay: 0, dueDay: 45 }, {});
  assert.equal(erros.length, 2, 'os dois dias entram na conta');
});

test('vale com recarga precisa do dia da recarga', () => {
  const erros = validarCartao({ name: 'VA', kind: KIND.BENEFIT, reloadCents: 50000, reloadDay: 0 }, {});
  assert.ok(erros.some((e) => /dia do mês/.test(e)));
});

test('vale sem recarga nenhuma é válido — nem toda empresa deposita todo mês', () => {
  assert.deepEqual(validarCartao({ name: 'VA', kind: KIND.BENEFIT, balanceCents: 10000 }, {}), []);
});

test('cartão sem nome não passa, seja qual for o tipo', () => {
  for (const kind of Object.values(KIND)) {
    assert.ok(validarCartao({ kind, name: '  ' }, {}).some((e) => /nome/.test(e)), kind);
  }
});

// ------------------------------------------------------- saldo do vale

test('o saldo do vale desconta o que foi gasto nele', () => {
  const tx = [gasto('va', '2026-08-10', 15000), gasto('va', '2026-08-12', 8000)];
  const r = saldoDoBeneficio(vale, tx, HOJE);
  assert.equal(r.gastoCents, 23000);
  assert.equal(r.saldoCents, 57000, 'R$ 800 menos R$ 230');
});

// Este é o bug que a data do saldo existe para evitar: sem ela, corrigir o
// saldo à mão descontaria de novo as compras que o saldo novo já refletia.
test('compra anterior ao saldo digitado não é descontada duas vezes', () => {
  const tx = [
    gasto('va', '2026-08-02', 30000), // antes do balanceAsOf: já está no saldo
    gasto('va', '2026-08-10', 15000), // depois: desconta
  ];
  assert.equal(saldoDoBeneficio(vale, tx, HOJE).saldoCents, 65000);
});

test('gasto de outro cartão não toca o saldo do vale', () => {
  const tx = [gasto('nu', '2026-08-10', 50000), gasto('db', '2026-08-11', 20000)];
  assert.equal(saldoDoBeneficio(vale, tx, HOJE).saldoCents, 80000);
});

test('compra futura no vale ainda não desconta', () => {
  const tx = [gasto('va', '2026-08-30', 20000)];
  assert.equal(saldoDoBeneficio(vale, tx, HOJE).saldoCents, 80000);
});

test('entrada no vale (estorno) não vira gasto', () => {
  const tx = [{ id: 'e', cardId: 'va', date: '2026-08-10', amountCents: 5000 }];
  assert.equal(saldoDoBeneficio(vale, tx, HOJE).gastoCents, 0);
});

// --------------------------------------------------------------- recarga

test('a próxima recarga é neste mês quando o dia ainda não passou', () => {
  assert.equal(proximaRecarga({ reloadCents: 1, reloadDay: 20 }, HOJE), '2026-08-20');
});

test('e no mês seguinte quando já passou', () => {
  assert.equal(proximaRecarga({ reloadCents: 1, reloadDay: 5 }, HOJE), '2026-09-05');
});

test('recarga dia 31 cai no último dia dos meses curtos', () => {
  assert.equal(proximaRecarga({ reloadCents: 1, reloadDay: 31 }, '2026-02-01'), '2026-02-28');
});

test('sem valor de recarga não existe próxima recarga', () => {
  assert.equal(proximaRecarga({ reloadDay: 5 }, HOJE), null);
  assert.equal(proximaRecarga({ reloadCents: 50000 }, HOJE), null);
});

// ------------------------------------------------------------- previsão

test('vale gasto rápido demais avisa que vai apertar', () => {
  // R$ 800 recarregados dia 5. Em 10 dias já foram R$ 600 — R$ 60/dia.
  // Sobram R$ 200, que a esse ritmo duram 3 dias, e faltam 21 até a recarga.
  const tx = [gasto('va', '2026-08-10', 60000)];
  const p = previsaoDoBeneficio(vale, tx, HOJE);
  assert.equal(p.situacao, 'aperta');
  assert.ok(p.diasQueAinda < p.diasAteRecarga);
  assert.equal(p.saldoCents, 20000);
});

test('vale no ritmo certo não gera alarme', () => {
  const tx = [gasto('va', '2026-08-10', 10000)];
  const p = previsaoDoBeneficio(vale, tx, HOJE);
  assert.equal(p.situacao, 'folgado');
});

test('vale zerado é zerado, não negativo com previsão', () => {
  const tx = [gasto('va', '2026-08-10', 100000)];
  const p = previsaoDoBeneficio(vale, tx, HOJE);
  assert.equal(p.situacao, 'acabou');
  assert.equal(p.diasQueAinda, 0);
});

test('vale sem gasto nenhum não divide por zero', () => {
  const p = previsaoDoBeneficio(vale, [], HOJE);
  assert.equal(p.situacao, 'folgado');
  assert.equal(p.saldoCents, 80000);
  assert.equal(p.diasQueAinda, null, 'sem ritmo não dá para prever fim');
});

test('vale sem recarga informada diz isso em vez de inventar data', () => {
  const semRecarga = { ...vale, reloadCents: 0, reloadDay: null };
  const p = previsaoDoBeneficio(semRecarga, [gasto('va', '2026-08-10', 10000)], HOJE);
  assert.equal(p.situacao, 'sem-recarga');
  assert.equal(p.proximaRecarga, null);
});

// ------------------------------------------------------------ lista e caixa

test('os vales vêm ordenados pelo que acaba primeiro', () => {
  const doc = {
    cards: [
      credito,
      { ...vale, id: 'folgado', name: 'VR' },
      { ...vale, id: 'apertado', name: 'VA' },
    ],
    transactions: [gasto('apertado', '2026-08-10', 70000), gasto('folgado', '2026-08-10', 5000)],
  };
  const lista = valesDe(doc, HOJE);
  assert.equal(lista.length, 2, 'cartão de crédito não é vale');
  assert.equal(lista[0].cardId, 'apertado', 'o que aperta vem primeiro — é o que faz agir');
});

// O ponto central do desenho: benefício não pode entrar na projeção da conta.
test('compra no vale não vira débito futuro da conta corrente', () => {
  const doc = {
    cards: [vale, debito],
    transactions: [
      gasto('va', '2026-08-20', 30000),
      gasto('db', '2026-08-20', 12000),
    ],
  };
  const futuros = debitosFuturos(doc, HOJE);
  assert.equal(futuros.length, 1, 'só o débito sai da conta');
  assert.equal(futuros[0].amountCents, -12000);
});

test('débito já passado não é cobrado de novo — o saldo digitado já o contém', () => {
  const doc = { cards: [debito], transactions: [gasto('db', '2026-08-01', 12000)] };
  assert.deepEqual(debitosFuturos(doc, HOJE), []);
});

test('sem cartão de débito não há débito futuro', () => {
  const doc = { cards: [credito, vale], transactions: [gasto('nu', '2026-08-30', 5000)] };
  assert.deepEqual(debitosFuturos(doc, HOJE), []);
});

// ------------------------------------------------- os três juntos, de verdade
//
// Os testes acima olham o núcleo isolado. Este monta um documento com os três
// tipos e passa pelo derive() inteiro, porque o risco não está em cada função
// e sim na junção: foi ali que compra de vale poderia virar fatura, ou o saldo
// do vale poderia ser descontado da conta corrente.
//
// A data e propria: as compras do vale precisam ser passadas para ja terem
// descontado, e a do debito futura para ainda estar por sair.
const DEPOIS = '2026-08-21';

test('vale não vira fatura, débito não vira fatura, e só o débito mexe no caixa', async () => {
  const { derive } = await import('../src/ui/state.js');
  const { emptyDocument } = await import('../src/data/migrations.js');
  const { CATEGORIES } = await import('../src/seed/categories.js');

  const doc = {
    ...emptyDocument(),
    categories: CATEGORIES.map((c) => ({ ...c })),
    accounts: [{ id: 'c1', name: 'Itaú', type: 'checking', balanceCents: 200000 }],
    cards: [
      { id: 'nu', name: 'Nubank', kind: KIND.CREDIT, closingDay: 20, dueDay: 27, limitCents: 500000 },
      { id: 'db', name: 'Débito Itaú', kind: KIND.DEBIT, accountId: 'c1' },
      { id: 'va', name: 'Vale', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-05', reloadCents: 80000, reloadDay: 5 },
    ],
    transactions: [
      { id: 't1', date: '2026-08-18', amountCents: -30000, description: 'Mercado', categoryId: 'mercado', cardId: 'nu' },
      { id: 't2', date: '2026-08-18', amountCents: -10000, description: 'Padaria', categoryId: 'mercado', cardId: 'va' },
      { id: 't3', date: '2026-08-19', amountCents: -25000, description: 'Restaurante', categoryId: 'delivery', cardId: 'va' },
      { id: 't4', date: '2026-08-25', amountCents: -15000, description: 'Farmácia', categoryId: 'contas', cardId: 'db' },
    ],
  };

  const v = derive(doc, DEPOIS);

  assert.deepEqual(v.cartoes.map((c) => c.id), ['nu'], 'só o crédito na lista de faturas');
  assert.ok(!v.faturas.todas.some((f) => f.cardId === 'va'), 'vale não gera fatura');
  assert.ok(!v.faturas.todas.some((f) => f.cardId === 'db'), 'débito não gera fatura');

  assert.equal(v.vales[0].saldoCents, 45000, 'R$ 800 menos os R$ 350 gastos no vale');
  assert.equal(v.cartoesDebito[0].conta.name, 'Itaú');

  // 200.000 − 15.000 (débito agendado) − 30.000 (fatura) = 155.000.
  // Se o vale entrasse no caixa, cairia 35.000 a mais.
  assert.equal(v.projecao.min.cents, 155000, 'o vale não sai da conta corrente');
});

test('compra no vale continua contando na categoria dela', async () => {
  const { derive } = await import('../src/ui/state.js');
  const { emptyDocument } = await import('../src/data/migrations.js');
  const { CATEGORIES } = await import('../src/seed/categories.js');

  const doc = {
    ...emptyDocument(),
    categories: CATEGORIES.map((c) => ({ ...c })),
    cards: [{ id: 'va', name: 'Vale', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-01' }],
    transactions: [
      { id: 't1', date: '2026-08-10', amountCents: -12000, description: 'Padaria', categoryId: 'mercado', cardId: 'va' },
    ],
  };

  const v = derive(doc, DEPOIS);
  // Mercado é categoria essencial. Se o vale ficasse de fora do retrato de
  // gastos, esta soma daria zero e a pessoa pareceria não comer.
  assert.equal(v.saude.allocation.essentialCents, 12000,
    'o cartão é a origem do dinheiro, não a categoria da compra');
});

// ------------------------------- conta fixa paga no vale (água, luz, internet)

test('gasto fixo pago no vale não sai da conta corrente', async () => {
  const { derive } = await import('../src/ui/state.js');
  const { emptyDocument } = await import('../src/data/migrations.js');
  const { CATEGORIES } = await import('../src/seed/categories.js');

  const base = {
    ...emptyDocument(),
    categories: CATEGORIES.map((c) => ({ ...c })),
    accounts: [{ id: 'c1', name: 'Conta', type: 'checking', balanceCents: 200000 }],
    cards: [{ id: 'sw', name: 'Swile', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-01', reloadCents: 80000, reloadDay: 5 }],
  };

  const v = derive({
    ...base,
    recurring: [
      { id: 'a', label: 'Aluguel', kind: 'expense', amountCents: -120000, dayOfMonth: 25, cardId: null },
      { id: 'l', label: 'Luz', kind: 'expense', amountCents: -18000, dayOfMonth: 25, cardId: 'sw' },
      { id: 'i', label: 'Internet', kind: 'expense', amountCents: -12000, dayOfMonth: 25, cardId: 'sw' },
    ],
  }, DEPOIS);

  const rotulos = [...new Set(v.eventos.map((e) => e.label))];
  assert.deepEqual(rotulos, ['Aluguel'], 'só o que sai da conta vira evento de caixa');
  assert.ok(!v.eventos.some((e) => /Luz|Internet/.test(e.label)), 'o vale não passa pela conta');
});

test('mas o vale desconta essas contas do próprio saldo', async () => {
  const { valesDe } = await import('../src/core/cards.js');
  const doc = {
    cards: [{ id: 'sw', name: 'Swile', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-01', reloadCents: 80000, reloadDay: 5 }],
    transactions: [],
    recurring: [
      { id: 'l', label: 'Luz', kind: 'expense', amountCents: -18000, dayOfMonth: 25, cardId: 'sw' },
      { id: 'i', label: 'Internet', kind: 'expense', amountCents: -12000, dayOfMonth: 25, cardId: 'sw' },
    ],
  };
  const vale = valesDe(doc, DEPOIS)[0];
  assert.equal(vale.saldoCents, 50000, 'R$ 800 menos os R$ 300 de contas — senão o dinheiro sumia dos dois lados');
});

test('o fixo quinzenal no vale desconta as duas vezes', async () => {
  const { saldoDoBeneficio } = await import('../src/core/cards.js');
  const card = { id: 'sw', name: 'Swile', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-01' };
  const r = saldoDoBeneficio(card, [], DEPOIS, [
    { id: 'd', label: 'Diarista', kind: 'expense', amountCents: -15000, dayOfMonth: 5, dayOfMonth2: 20, every: 'quinzena', cardId: 'sw' },
  ]);
  assert.equal(r.saldoCents, 50000, 'R$ 150 duas vezes são R$ 300');
});

test('fixo de outro cartão não mexe no saldo deste vale', async () => {
  const { saldoDoBeneficio } = await import('../src/core/cards.js');
  const card = { id: 'sw', name: 'Swile', kind: KIND.BENEFIT, balanceCents: 80000, balanceAsOf: '2026-08-01' };
  const r = saldoDoBeneficio(card, [], DEPOIS, [
    { id: 'l', label: 'Luz', kind: 'expense', amountCents: -18000, dayOfMonth: 25, cardId: 'outro' },
  ]);
  assert.equal(r.saldoCents, 80000);
});
