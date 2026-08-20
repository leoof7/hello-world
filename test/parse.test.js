import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, extractAmount, extractDate, wordsToNumber, extractInstallments } from '../src/core/parse.js';
import { categorize, pixCounterparty, cleanDescription, learn, ruleFrom } from '../src/core/categorize.js';
import { findRecurring, priceIncreases, duplicates, scan } from '../src/core/leaks.js';
import { minimumCostOfLiving, emergencyFund, commitment, savingsRate } from '../src/core/health.js';

const HOJE = '2026-08-19';
const merchants = [
  { match: 'mercado', label: 'Supermercado', categoryId: 'alimentacao' },
  { match: 'posto', label: 'Posto', categoryId: 'transporte' },
  { match: 'ifood', label: 'iFood', categoryId: 'alimentacao' },
];

// ---------------- parser de voz ----------------

test('entende números por extenso', () => {
  assert.equal(wordsToNumber('oitenta e cinco'), 85);
  assert.equal(wordsToNumber('cento e vinte'), 120);
  assert.equal(wordsToNumber('mil e duzentos'), 1200);
  assert.equal(wordsToNumber('tres'), 3);
});

test('acha o valor em dígitos e por extenso', () => {
  assert.equal(extractAmount('gastei 85 no mercado'), 8500);
  assert.equal(extractAmount('45,90 no posto'), 4590);
  assert.equal(extractAmount('R$ 1.234,56'), 123456);
  assert.equal(extractAmount('gastei oitenta e cinco reais'), 8500);
  assert.equal(extractAmount('85 reais e 50 centavos'), 8550);
});

test('"gastei oitenta e cinco no mercado ontem" vira lançamento completo', () => {
  const r = parseEntry('gastei oitenta e cinco reais no mercado ontem', { todayISO: HOJE, merchants });
  assert.equal(r.amountCents, -8500, 'gasto é negativo');
  assert.equal(r.date, '2026-08-18');
  assert.equal(r.description, 'Supermercado');
  assert.equal(r.categoryId, 'alimentacao');
  assert.deepEqual(r.needs, []);
});

test('"45,90 no posto no crédito em 3x" pega forma e parcelas', () => {
  const r = parseEntry('45,90 no posto no crédito em 3x', { todayISO: HOJE, merchants });
  assert.equal(r.amountCents, -4590);
  assert.equal(r.method, 'credit');
  assert.equal(r.installmentCount, 3);
  assert.equal(r.categoryId, 'transporte');
});

test('reconhece entrada de dinheiro', () => {
  const r = parseEntry('recebi 1200 de freela hoje', { todayISO: HOJE });
  assert.equal(r.direction, 'in');
  assert.equal(r.amountCents, 120000);
  assert.equal(r.date, HOJE);
});

test('entende datas relativas e absolutas', () => {
  assert.equal(extractDate('gastei 50 hoje', HOJE), '2026-08-19');
  assert.equal(extractDate('gastei 50 ontem', HOJE), '2026-08-18');
  assert.equal(extractDate('gastei 50 anteontem', HOJE), '2026-08-17');
  assert.equal(extractDate('gastei 50 em 12/08', HOJE), '2026-08-12');
  assert.equal(extractDate('gastei 50 dia 3', HOJE), '2026-08-03');
});

test('sem data explícita assume hoje', () => {
  assert.equal(parseEntry('gastei 30 no ifood', { todayISO: HOJE }).date, HOJE);
});

test('avisa o que faltou em vez de inventar', () => {
  const r = parseEntry('gastei no mercado', { todayISO: HOJE, merchants });
  assert.equal(r.amountCents, null);
  assert.ok(r.needs.includes('valor'));
});

test('parcelas por extenso também contam', () => {
  assert.equal(extractInstallments('em três vezes'), 3);
  assert.equal(extractInstallments('em 10x'), 10);
  assert.equal(extractInstallments('à vista'), 1);
});

// ---------------- categorização ----------------

test('limpa o lixo que o banco põe na descrição', () => {
  assert.equal(cleanDescription('PAGSEGURO *AUTOPOSTO'), 'AUTOPOSTO');
  assert.equal(cleanDescription('Compra cartão IFOOD *CLUB'), 'IFOOD CLUB');
});

test('extrai a contraparte de um Pix', () => {
  assert.equal(pixCounterparty('Pix enviado para MARINA COSTA'), 'MARINA COSTA');
  assert.equal(pixCounterparty('PIX RECEBIDO DE CARLOS SILVA'), 'CARLOS SILVA');
});

test('a cascata respeita a ordem: regra, memória, dicionário, revisão', () => {
  const ctx = {
    rules: [{ match: 'posto', categoryId: 'combustivel', priority: 10 }],
    memory: { 'MARINA COSTA': { categoryId: 'presentes' } },
    merchants: [{ match: 'ifood', categoryId: 'alimentacao' }],
  };

  assert.equal(categorize({ description: 'AUTOPOSTO IPIRANGA' }, ctx).categoryId, 'combustivel');
  assert.equal(categorize({ description: 'Pix para Marina Costa', method: 'pix' }, ctx).source, 'memória');
  assert.equal(categorize({ description: 'IFOOD SP' }, ctx).source, 'dicionário');
  assert.equal(categorize({ description: 'LOJA DESCONHECIDA' }, ctx).categoryId, null);
});

test('aprende com a correção e não pergunta de novo', () => {
  const tx = { description: 'Pix enviado para MARINA COSTA', method: 'pix' };
  const memoria = learn({}, tx, { categoryId: 'presentes' });
  assert.equal(categorize(tx, { memory: memoria }).categoryId, 'presentes');
});

test('cria regra a partir de uma transação', () => {
  const r = ruleFrom({ id: 't1', description: 'PAGSEGURO *AUTOPOSTO' }, 'combustivel');
  assert.equal(r.match, 'AUTOPOSTO');
  assert.equal(r.categoryId, 'combustivel');
});

// ---------------- vazamentos ----------------

const assinaturas = [
  { id: '1', date: '2026-04-05', description: 'NETFLIX', amountCents: -3990 },
  { id: '2', date: '2026-05-05', description: 'NETFLIX', amountCents: -3990 },
  { id: '3', date: '2026-06-05', description: 'NETFLIX', amountCents: -3990 },
  { id: '4', date: '2026-07-05', description: 'NETFLIX', amountCents: -3990 },
  { id: '5', date: '2026-08-05', description: 'NETFLIX', amountCents: -4490 },
  { id: '6', date: '2026-07-05', description: 'SPOTIFY', amountCents: -2190 },
  { id: '7', date: '2026-07-07', description: 'SPOTIFY', amountCents: -2190 },
  { id: '8', date: '2026-08-05', description: 'SPOTIFY', amountCents: -2190 },
  { id: '9', date: '2026-06-05', description: 'SPOTIFY', amountCents: -2190 },
];

test('detecta assinatura mensal com três ocorrências', () => {
  const r = findRecurring(assinaturas);
  const netflix = r.find((x) => x.name === 'NETFLIX');
  assert.ok(netflix, 'Netflix tem que ser detectada');
  assert.equal(netflix.period, 'mensal');
  assert.equal(netflix.occurrences, 5);
});

test('pega o aumento silencioso de preço', () => {
  const aumentos = priceIncreases(findRecurring(assinaturas));
  const netflix = aumentos.find((a) => a.name === 'NETFLIX');
  assert.ok(netflix, 'o aumento da Netflix tem que aparecer');
  assert.equal(netflix.deltaCents, 500);
  assert.equal(netflix.yearlyCents, 6000, 'R$ 5 por mês são R$ 60 por ano');
});

test('pega cobrança duplicada em poucos dias', () => {
  const d = duplicates(assinaturas);
  const spotify = d.find((x) => x.name === 'SPOTIFY');
  assert.ok(spotify, 'as duas cobranças de julho têm que ser sinalizadas');
  assert.equal(spotify.daysApart, 2);
});

test('a varredura ordena pelo que custa mais no ano', () => {
  const r = scan(assinaturas, '2026-08-19');
  assert.ok(r.findings.length >= 2);
  assert.ok(r.totalYearlyCents > 0);
  assert.ok(r.findings[0].yearlyCents >= r.findings[r.findings.length - 1].yearlyCents);
});

test('parcela não é confundida com assinatura', () => {
  const parcelas = [1, 2, 3, 4].map((n) => ({
    id: `p${n}`,
    date: `2026-0${3 + n}-12`,
    description: 'NOTEBOOK DELL',
    amountCents: -41658,
    installment: { n, of: 12 },
  }));
  assert.equal(findRecurring(parcelas).length, 0);
});

// ---------------- diagnóstico ----------------

const categorias = [
  { id: 'casa', essential: true },
  { id: 'mercado', essential: true },
  { id: 'lazer', essential: false },
];

test('custo de vida mínimo usa só o essencial e ignora o mês corrente', () => {
  const txs = [
    { competence: '2026-05', categoryId: 'casa', amountCents: -294000 },
    { competence: '2026-06', categoryId: 'casa', amountCents: -294000 },
    { competence: '2026-07', categoryId: 'casa', amountCents: -294000 },
    { competence: '2026-07', categoryId: 'lazer', amountCents: -50000 },
    { competence: '2026-08', categoryId: 'casa', amountCents: -294000 },
  ];
  const r = minimumCostOfLiving(txs, categorias, '2026-08-19');
  assert.equal(r.cents, 294000, 'lazer não entra e agosto ainda está incompleto');
  assert.equal(r.months, 3);
  assert.ok(r.confident);
});

test('sem histórico suficiente o custo mínimo não finge confiança', () => {
  const r = minimumCostOfLiving([{ competence: '2026-07', categoryId: 'casa', amountCents: -100000 }], categorias, '2026-08-19');
  assert.equal(r.confident, false);
});

test('reserva de emergência é medida em meses de custo mínimo', () => {
  const r = emergencyFund(1003200, 418000);
  assert.ok(Math.abs(r.months - 2.4) < 0.05);
  assert.equal(r.targetCents, 418000 * 6);
  assert.equal(r.missingCents, 418000 * 6 - 1003200);
});

test('comprometimento acima de 30% é sinalizado', () => {
  const c = commitment(840000, { fixedCents: 294000, installmentCents: 119000, debtMinimumsCents: 0 });
  assert.ok(c.ratio > 0.45);
  assert.equal(c.healthy, false);
});

test('taxa de poupança', () => {
  const s = savingsRate(840000, 711600);
  assert.equal(s.savedCents, 128400);
  assert.ok(Math.abs(s.ratio - 0.1529) < 0.001);
});
