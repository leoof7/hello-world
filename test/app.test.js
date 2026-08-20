// A camada de derivação e a de importação/exportação.
//
// O que interessa aqui não é "a função roda" — é que os números que aparecem
// na tela batem com o que o núcleo calculou, e que reimportar um extrato duas
// vezes não duplica nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { derive, statementsOf, guiaStatus } from '../src/ui/state.js';
import { seedDocument } from '../src/seed/seed.js';
import { emptyDocument } from '../src/data/migrations.js';
import { buildBackup, readBackup } from '../src/data/backup.js';
import { generatePhrase } from '../src/data/recovery.js';
import * as csv from '../src/io/csv.js';
import * as ofx from '../src/io/ofx.js';
import { buildCalendar } from '../src/io/ics.js';
import { sum } from '../src/core/money.js';

const HOJE = '2026-08-20';

// ------------------------------------------------------------------ derivação

test('deriva o cenário de exemplo inteiro sem quebrar', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  assert.equal(v.todayISO, HOJE);
  assert.equal(v.mes, '2026-08');
  assert.equal(v.cartoes.length, 3);
  assert.equal(v.dividas.length, 2);
  assert.ok(v.projecao.days.length === 91, 'projeção cobre 90 dias mais hoje');
});

test('deriva um documento vazio sem explodir', () => {
  const v = derive(emptyDocument(), HOJE);
  assert.equal(v.dividaTotalCents, 0);
  assert.equal(v.plano, null);
  assert.equal(v.cartoes.length, 0);
  assert.equal(v.guia.feitos, 0);
});

test('a dívida mais cara vem primeiro, não a maior', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  // rotativo: R$ 6.480 a 14,9%/mês · cheque especial: R$ 3.200 a 8%/mês
  assert.match(v.dividas[0].name, /Nubank/);
  assert.ok(v.dividas[0].monthlyRate > v.dividas[1].monthlyRate);
});

test('juros do dia batem com a soma das dívidas', () => {
  const doc = seedDocument(HOJE);
  const v = derive(doc, HOJE);
  const esperado = sum(doc.debts.map((d) => Math.round(Math.abs(d.balanceCents) * d.monthlyRate / 30)));
  assert.equal(v.jurosDiaCents, esperado);
});

test('cada parcela cai na fatura do seu próprio mês', () => {
  const doc = seedDocument(HOJE);
  const v = derive(doc, HOJE);
  const notebook = v.compras.find((c) => c.description === 'Notebook Dell');
  assert.ok(notebook, 'a compra parcelada aparece agrupada');
  assert.equal(notebook.of, 12);
  // 12 parcelas em 12 vencimentos distintos
  const parcelas = doc.transactions.filter((t) => t.installment?.groupId === 'cp-note');
  assert.equal(new Set(parcelas.map((p) => p.dueDate)).size, 12);
});

test('o muro cobre doze meses e soma o que já está comprometido', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  assert.equal(v.muro.length, 12);
  assert.equal(v.muro[0].month, '2026-08');
  assert.ok(v.comprometidoCents > 0);
});

test('custo de vida vem do histórico, não do mês corrente', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  assert.equal(v.custoVida.source, 'histórico');
  assert.ok(v.custoVida.months >= 2);
  assert.ok(v.custoVida.cents > 0);
});

test('sem histórico, o custo de vida cai para os fixos e se declara incerto', () => {
  const doc = seedDocument(HOJE);
  doc.transactions = doc.transactions.filter((t) => (t.competence || t.date.slice(0, 7)) >= '2026-08');
  const v = derive(doc, HOJE);
  assert.equal(v.custoVida.source, 'fixos');
  assert.equal(v.custoVida.confident, false);
});

test('a sobra desconta custo de vida e parcelas da renda', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  assert.equal(v.sobraCents, v.rendaFixaCents - v.custoVida.cents - v.parcelasDoMesCents);
});

test('o caça-vazamentos acha a duplicada e o aumento plantados no exemplo', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  const tipos = v.vazamentos.findings.map((f) => f.type);
  assert.ok(tipos.includes('duplicada'), 'acha o Spotify cobrado duas vezes');
  assert.ok(tipos.includes('aumento'), 'acha a Netflix que subiu');
});

test('a fila de revisão só traz o que ainda não tem categoria', () => {
  const v = derive(seedDocument(HOJE), HOJE);
  assert.ok(v.revisao.length > 0);
  const doc = seedDocument(HOJE);
  for (const t of v.revisao) {
    assert.equal(doc.transactions.find((x) => x.id === t.id)?.categoryId, undefined);
  }
});

test('o progresso da saída usa o pico da dívida, não o saldo de hoje', () => {
  const doc = seedDocument(HOJE);
  doc.profile.debtPeakCents = 1_936_000; // já pagou metade
  const v = derive(doc, HOJE);
  assert.ok(Math.abs(v.progresso - 0.5) < 0.01);
});

// ------------------------------------------------------------------ faturas

test('as faturas agrupam por cartão e por ciclo', () => {
  const doc = seedDocument(HOJE);
  const f = statementsOf(doc, HOJE);
  assert.ok(f.todas.length > 0);
  for (const s of f.todas) {
    assert.ok(s.dueDate >= s.closeDate, 'vencimento nunca é antes do fechamento');
    assert.equal(s.totalCents, sum(s.items.map((i) => Math.abs(i.amountCents))));
  }
  assert.ok(f.futuras.every((s) => s.dueDate >= HOJE));
});

test('o guia marca feito o que já está preenchido', () => {
  const cheio = guiaStatus(seedDocument(HOJE));
  const vazio = guiaStatus(emptyDocument());
  assert.ok(cheio.feitos > vazio.feitos);
  assert.equal(vazio.feitos, 0);
  assert.equal(cheio.total, 7);
});

// ------------------------------------------------------------------ backup

test('backup vai e volta idêntico com as doze palavras', async () => {
  const doc = seedDocument(HOJE);
  const frase = generatePhrase();
  const arquivo = await buildBackup(doc, frase);
  const voltou = await readBackup(JSON.stringify(arquivo), frase);
  assert.deepEqual(voltou.transactions, doc.transactions);
  assert.deepEqual(voltou.debts, doc.debts);
  assert.deepEqual(voltou.cards, doc.cards);
});

test('backup não abre com outras doze palavras', async () => {
  const arquivo = await buildBackup(seedDocument(HOJE), generatePhrase());
  await assert.rejects(() => readBackup(arquivo, generatePhrase()), /não abrem este arquivo/);
});

test('arquivo que não é backup do Zero é recusado com mensagem clara', async () => {
  await assert.rejects(
    () => readBackup(JSON.stringify({ qualquer: 'coisa' }), generatePhrase()),
    /não é um backup do Zero/
  );
});

// ------------------------------------------------------------------ CSV

test('CSV com ponto e vírgula e valor brasileiro', () => {
  const texto = 'Data;Descrição;Valor\n15/08/2026;PAO DE ACUCAR;-1.234,56\n16/08/2026;SALARIO;8.400,00';
  const { transactions, problemas } = csv.toTransactions(texto);
  assert.equal(problemas.length, 0);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, '2026-08-15');
  assert.equal(transactions[0].amountCents, -123456);
  assert.equal(transactions[1].amountCents, 840000);
});

test('CSV com vírgula como separador e ponto decimal', () => {
  const texto = 'date,description,amount\n2026-08-15,UBER TRIP,-38.20';
  const { transactions } = csv.toTransactions(texto);
  assert.equal(transactions[0].amountCents, -3820);
});

test('CSV com colunas separadas de crédito e débito', () => {
  const texto = 'Data;Histórico;Crédito;Débito\n10/08/2026;ALUGUEL;;1.800,00\n05/08/2026;SALARIO;8.400,00;';
  const { transactions } = csv.toTransactions(texto);
  assert.equal(transactions[0].amountCents, -180000);
  assert.equal(transactions[1].amountCents, 840000);
});

test('fatura de cartão pode forçar tudo como saída', () => {
  const texto = 'data,descricao,valor\n15/08/2026,IFOOD,68.90';
  const { transactions } = csv.toTransactions(texto, { sign: 'expense', cardId: 'nu' });
  assert.equal(transactions[0].amountCents, -6890);
  assert.equal(transactions[0].cardId, 'nu');
});

test('linha ilegível é reportada, não inventada', () => {
  const texto = 'data;descricao;valor\nlixo;NADA;abc\n15/08/2026;OK;-10,00';
  const { transactions, problemas } = csv.toTransactions(texto);
  assert.equal(transactions.length, 1);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0].linha, 2);
});

test('campo entre aspas com ponto e vírgula dentro não quebra a linha', () => {
  const linha = csv.splitLine('15/08/2026;"MERCADO; LTDA";-10,00', ';');
  assert.deepEqual(linha, ['15/08/2026', 'MERCADO; LTDA', '-10,00']);
});

test('exportar e reimportar preserva data, valor e descrição', () => {
  const doc = seedDocument(HOJE);
  const texto = csv.fromTransactions(doc.transactions.slice(0, 5), doc.categories);
  const { transactions } = csv.toTransactions(texto);
  assert.equal(transactions.length, 5);
  transactions.forEach((t, i) => {
    assert.equal(t.date, doc.transactions[i].date);
    assert.equal(t.amountCents, doc.transactions[i].amountCents);
    assert.equal(t.description, doc.transactions[i].description);
  });
});

// ------------------------------------------------------------------ OFX

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815120000[-3:BRT]<TRNAMT>-512.30<FITID>ABC123<MEMO>PAO DE ACUCAR</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260805<TRNAMT>8400.00<FITID>DEF456<MEMO>PAGAMENTO SALARIO</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>5358.60<DTASOF>20260820</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX é reconhecido e lido com o sinal certo', () => {
  assert.ok(ofx.isOFX(OFX));
  const { transactions, balanceCents } = ofx.toTransactions(OFX, { accountId: 'ac-nu' });
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, '2026-08-15');
  assert.equal(transactions[0].amountCents, -51230);
  assert.equal(transactions[0].description, 'PAO DE ACUCAR');
  assert.equal(transactions[1].amountCents, 840000);
  assert.equal(balanceCents, 535860);
});

test('reimportar o mesmo OFX não duplica nada', () => {
  const a = ofx.toTransactions(OFX).transactions;
  const b = ofx.toTransactions(OFX).transactions;
  const existentes = new Set(a.map((t) => t.id));
  assert.equal(b.filter((t) => !existentes.has(t.id)).length, 0);
});

// ------------------------------------------------------------------ calendário

test('o calendário sai com um evento por fatura e alarme de véspera', () => {
  const doc = seedDocument(HOJE);
  const futuras = statementsOf(doc, HOJE).futuras;
  const ics = buildCalendar(futuras);
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, futuras.filter((s) => s.totalCents).length);
});

test('o calendário escapa vírgula no nome do cartão', () => {
  const ics = buildCalendar([
    { cardId: 'x', cycleId: '2026-08-20', dueDate: '2026-08-27', closeDate: '2026-08-20', cardName: 'Banco X, S.A.', totalCents: 1000 },
  ]);
  assert.match(ics, /Banco X\\, S\.A\./);
});

// ------------------------------------------------------------------ migração

test('documento antigo sem versão ganha os campos novos sem perder os antigos', async () => {
  const { migrate, CURRENT_VERSION } = await import('../src/data/migrations.js');
  const antigo = {
    profile: { name: 'Leandro' },
    transactions: [{ id: 't1', date: '2026-01-05', amountCents: -1000, description: 'ANTIGO' }],
    cards: [{ id: 'nu', name: 'Nubank', closingDay: 20, dueDay: 27 }],
  };
  const { document: novo, applied } = migrate(antigo);

  assert.deepEqual(applied, [1], 'rodou a migração pendente');
  assert.equal(novo.version, CURRENT_VERSION);
  assert.deepEqual(novo.transactions, antigo.transactions, 'nada foi perdido');
  assert.equal(novo.profile.name, 'Leandro', 'campo antigo preservado');
  assert.equal(novo.profile.emergencyTargetMonths, 6, 'campo novo preenchido com o padrão');
  assert.deepEqual(novo.goals, [], 'coleção nova nasce vazia, não indefinida');
  assert.equal(novo.settings.debtMethod, 'avalanche');
});

test('documento já na versão atual não é mexido', async () => {
  const { migrate } = await import('../src/data/migrations.js');
  const doc = seedDocument(HOJE);
  const { document: saida, applied } = migrate(doc);
  assert.deepEqual(applied, []);
  assert.deepEqual(saida, doc);
});

test('backup de uma versão futura é recusado em vez de adivinhado', async () => {
  const { migrate } = await import('../src/data/migrations.js');
  assert.throws(() => migrate({ ...emptyDocument(), version: 99 }), /Atualize o app/);
});

test('reconhece o que é e o que não é documento do Zero', async () => {
  const { looksLikeDocument } = await import('../src/data/migrations.js');
  assert.ok(looksLikeDocument(seedDocument(HOJE)));
  assert.ok(!looksLikeDocument({ transactions: 'nope' }));
  assert.ok(!looksLikeDocument(null));
});
