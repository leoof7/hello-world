import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versusMedia, custoDoHabito, podeComprar, marcos, avisosDoDia } from '../src/core/insights.js';

const HOJE = '2026-08-15';
const categorias = [
  { id: 'delivery', name: 'Delivery e restaurante', fixed: false },
  { id: 'mercado', name: 'Mercado', fixed: false },
  { id: 'moradia', name: 'Moradia', fixed: true },
  { id: 'pix-interno', name: 'Pix entre contas', fixed: false, neutra: true },
];

const gasto = (mes, dia, categoryId, cents) => ({
  id: `${mes}-${dia}-${categoryId}`, date: `${mes}-${dia}`, competence: mes,
  amountCents: -cents, categoryId,
});

// ----------------------------------------------------- você contra você mesmo

test('acusa a categoria que está acima da própria média', () => {
  const tx = [
    gasto('2026-06', '10', 'delivery', 30000),
    gasto('2026-07', '10', 'delivery', 30000),
    // no dia 15, o esperado é metade de R$ 300 = R$ 150. Gastou R$ 400.
    gasto('2026-08', '05', 'delivery', 40000),
  ];
  const r = versusMedia(tx, categorias, HOJE);
  const delivery = r.find((x) => x.categoryId === 'delivery');
  assert.ok(delivery, 'delivery tem que aparecer');
  assert.equal(delivery.direction, 'acima');
  assert.ok(delivery.ratio > 1, 'mais que o dobro do esperado para o dia 15');
});

test('não compara com menos de dois meses fechados', () => {
  const tx = [gasto('2026-07', '10', 'delivery', 30000), gasto('2026-08', '05', 'delivery', 90000)];
  assert.deepEqual(versusMedia(tx, categorias, HOJE), [], 'um mês só não é média');
});

test('categoria fixa não entra — ela não varia por definição', () => {
  const tx = [
    gasto('2026-06', '10', 'moradia', 90000),
    gasto('2026-07', '10', 'moradia', 90000),
    gasto('2026-08', '01', 'moradia', 90000),
  ];
  assert.ok(!versusMedia(tx, categorias, HOJE).some((x) => x.categoryId === 'moradia'));
});

test('transferência entre contas não vira insight de gasto', () => {
  const tx = [
    gasto('2026-06', '10', 'pix-interno', 50000),
    gasto('2026-07', '10', 'pix-interno', 50000),
    gasto('2026-08', '01', 'pix-interno', 200000),
  ];
  assert.deepEqual(versusMedia(tx, categorias, HOJE), []);
});

test('diferença pequena não vira aviso', () => {
  const tx = [
    gasto('2026-06', '10', 'mercado', 30000),
    gasto('2026-07', '10', 'mercado', 30000),
    gasto('2026-08', '05', 'mercado', 15500), // esperado 15000, 3% acima
  ];
  assert.ok(!versusMedia(tx, categorias, HOJE).some((x) => x.categoryId === 'mercado'), 'ruído não é notícia');
});

// ------------------------------------------------------- custo real do hábito

test('traduz gasto mensal em ano e em meses de reserva', () => {
  const r = custoDoHabito(40000, { minimumCostCents: 160000 });
  assert.equal(r.yearlyCents, 480000, 'R$ 400/mês são R$ 4.800/ano');
  assert.equal(r.reserveMonths, 3, 'e equivalem a três meses de custo mínimo');
});

test('sem custo mínimo conhecido, não inventa a conversão', () => {
  assert.equal(custoDoHabito(40000).reserveMonths, null);
});

// ------------------------------------------------------------ posso comprar?

test('compra que cabe no saldo e não fura a projeção é aprovada', () => {
  const r = podeComprar({
    valorCents: 20000, saldoCents: 100000,
    projecao: { min: { cents: 50000 } }, todayISO: HOJE,
  });
  assert.equal(r.aVista.cabe, true);
  assert.deepEqual(r.motivos, []);
});

test('compra que deixa a projeção negativa é reprovada, com motivo', () => {
  const r = podeComprar({
    valorCents: 80000, saldoCents: 100000,
    projecao: { min: { cents: 50000 } }, todayISO: HOJE,
  });
  assert.equal(r.aVista.cabe, false);
  assert.ok(r.motivos.some((m) => /negativo/.test(m)));
});

test('parcelado respeita o limite disponível do cartão', () => {
  const cartao = { name: 'Nubank', limitCents: 100000, availableCents: 30000 };
  const cabe = podeComprar({ valorCents: 25000, parcelas: 5, cartao, projecao: {}, todayISO: HOJE });
  const naoCabe = podeComprar({ valorCents: 50000, parcelas: 5, cartao, projecao: {}, todayISO: HOJE });

  assert.equal(cabe.parcelado.cabe, true);
  assert.equal(cabe.parcelaCents, 5000);
  assert.equal(naoCabe.parcelado.cabe, false);
  assert.ok(naoCabe.motivos.some((m) => /limite/.test(m)));
});

// -------------------------------------------------------------------- marcos

test('quitar tudo dá o marco de livre de dívidas', () => {
  const m = marcos({ dividaTotalCents: 0, dividaPicoCents: 500000, reservaMeses: 0 });
  assert.ok(m.some((x) => x.id === 'livre-divida'));
});

test('metade da dívida paga é marco, um terço ainda não', () => {
  const metade = marcos({ dividaTotalCents: 250000, dividaPicoCents: 500000, reservaMeses: 0 });
  const pouco = marcos({ dividaTotalCents: 450000, dividaPicoCents: 500000, reservaMeses: 0 });
  assert.ok(metade.some((x) => x.id === 'metade-divida'));
  assert.ok(!pouco.some((x) => x.id === 'metade-divida'));
});

test('reserva dá marcos crescentes, não um só', () => {
  const seis = marcos({ dividaTotalCents: 0, dividaPicoCents: 0, reservaMeses: 6 });
  assert.ok(seis.some((x) => x.id === 'reserva-1'));
  assert.ok(seis.some((x) => x.id === 'reserva-3'));
  assert.ok(seis.some((x) => x.id === 'reserva-6'));
});

test('não existe marco por abrir o app', () => {
  const nenhum = marcos({ dividaTotalCents: 0, dividaPicoCents: 0, reservaMeses: 0 });
  assert.deepEqual(nenhum, [], 'sem conquista real, sem comemoração');
});

// ------------------------------------------------------------ avisos do dia

test('conta ficando negativa é o aviso mais urgente', () => {
  const avisos = avisosDoDia({
    projecao: { firstNegative: { date: '2026-08-17', cents: -74000 } },
    todayISO: HOJE,
  });
  assert.equal(avisos[0].titulo, 'Sua conta fica negativa em 2 dias');
  assert.equal(avisos[0].tela, 'analise');
});

test('furo daqui a três meses não vira aviso de hoje', () => {
  const avisos = avisosDoDia({
    projecao: { firstNegative: { date: '2026-11-17', cents: -74000 } },
    todayISO: HOJE,
  });
  assert.deepEqual(avisos, [], 'longe demais para tirar alguém do sério agora');
});

test('fatura vencendo entra, fatura distante não', () => {
  const perto = avisosDoDia({
    faturas: [{ cardId: 'c1', cycleId: 'x', cardName: 'Nubank', dueDate: '2026-08-16', totalCents: 50000 }],
    todayISO: HOJE,
  });
  const longe = avisosDoDia({
    faturas: [{ cardId: 'c1', cycleId: 'x', cardName: 'Nubank', dueDate: '2026-09-16', totalCents: 50000 }],
    todayISO: HOJE,
  });
  assert.ok(perto.some((a) => /Nubank/.test(a.titulo)));
  assert.deepEqual(longe, []);
});

test('nunca passa do limite de avisos — notificação demais é notificação desligada', () => {
  const avisos = avisosDoDia({
    projecao: { firstNegative: { date: '2026-08-16', cents: -1000 } },
    faturas: [
      { cardId: 'a', cycleId: '1', cardName: 'A', dueDate: '2026-08-16', totalCents: 100 },
      { cardId: 'b', cycleId: '1', cardName: 'B', dueDate: '2026-08-17', totalCents: 100 },
    ],
    vazamentos: { findings: [{ type: 'duplicada', name: 'X', yearlyCents: 100 }] },
    revisaoCount: 40,
    backupDiasSem: 90,
    todayISO: HOJE,
    limite: 3,
  });
  assert.equal(avisos.length, 3);
  assert.ok(avisos[0].urgencia >= avisos[1].urgencia, 'e vêm em ordem de urgência');
});

test('app em dia não inventa aviso', () => {
  assert.deepEqual(avisosDoDia({ projecao: {}, todayISO: HOJE }), []);
});

// ------------------------------------------------------- o mês fecha ou não

test('o fechamento soma as saídas e diz quanto sobra', async () => {
  const { fechamentoDoMes } = await import('../src/core/insights.js');
  const f = fechamentoDoMes({
    entradasCents: 470000, faturasCents: 135000, fixosCents: 117000,
    parcelasCents: 120000, minimosDividaCents: 100000,
  });
  assert.equal(f.totalSaidasCents, 472000);
  assert.equal(f.sobraCents, -2000, 'falta R$ 20 para fechar');
  assert.equal(f.fecha, false);
  assert.equal(f.saidas.length, 4);
});

test('guardar não é gastar — investimento não entra como saída', async () => {
  const { fechamentoDoMes } = await import('../src/core/insights.js');
  const f = fechamentoDoMes({ entradasCents: 470000, fixosCents: 117000 });
  assert.equal(f.sobraCents, 353000, 'o que sobra é para guardar, não já guardado');
  assert.ok(f.saidas.every((s) => !/investi|cofrinho/i.test(s.rotulo)));
});

test('saída zerada não polui a lista', async () => {
  const { fechamentoDoMes } = await import('../src/core/insights.js');
  const f = fechamentoDoMes({ entradasCents: 100000, fixosCents: 50000 });
  assert.equal(f.saidas.length, 1, 'só os que têm valor aparecem');
});

test('comprometido acima de 100% é mês que não fecha sozinho', async () => {
  const { fechamentoDoMes } = await import('../src/core/insights.js');
  const f = fechamentoDoMes({ entradasCents: 100000, fixosCents: 150000 });
  assert.ok(f.comprometidoRatio > 1);
  assert.equal(f.fecha, false);
});

test('categoria sem gasto no mês não vira insight', () => {
  const tx = [
    gasto('2026-06', '10', 'delivery', 30000),
    gasto('2026-07', '10', 'delivery', 30000),
    // nada em agosto — "100% abaixo" não é notícia, é o que não aconteceu
  ];
  const r = versusMedia(tx, categorias, HOJE);
  assert.ok(!r.some((x) => x.categoryId === 'delivery'), 'zero gasto não entra na lista');
});
