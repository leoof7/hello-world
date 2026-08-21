// Dados de exemplo — o cenário que validamos no protótipo.
//
// Um assalariado com rotativo em atraso, cheque especial e parcelas correndo.
// Serve para você ver o app funcionando antes de digitar os seus números.
// TUDO AQUI É FICTÍCIO. O botão "apagar tudo" limpa e você começa do seu jeito.

import { emptyDocument } from '../data/migrations.js';
import { CATEGORIES } from './categories.js';
import { expand } from '../core/installments.js';
import { KIND } from '../core/debts.js';
import { addMonths, monthKey, addMonthKey } from '../core/dates.js';

const NUBANK = { id: 'nu', name: 'Nubank', color: 'red', closingDay: 20, dueDay: 27, limitCents: 1200000 };
const ITAU = { id: 'it', name: 'Itaú Click', color: 'blue', closingDay: 5, dueDay: 12, limitCents: 600000 };
const INTER = { id: 'in', name: 'Inter Gold', color: 'steel', closingDay: 28, dueDay: 5, limitCents: 350000 };

export function seedDocument(todayISO = '2026-08-19') {
  const doc = emptyDocument();
  const mes = monthKey(todayISO);
  const mesAnterior = addMonthKey(mes, -1);
  const dois = addMonthKey(mes, -2);
  const tres = addMonthKey(mes, -3);

  doc.profile = {
    name: 'Leandro',
    incomeCents: 840000,
    minimumCostCents: 418000,
    emergencyTargetMonths: 6,
    // `demo` liga a faixa de aviso em todas as telas e o botão de sair daqui.
    demo: true,
  };

  doc.categories = CATEGORIES.map((c) => ({ ...c }));

  doc.accounts = [
    { id: 'ac-nu', name: 'Nubank', type: 'checking', balanceCents: 535860 },
    { id: 'ac-it', name: 'Itaú', type: 'checking', balanceCents: -320000, overdraftLimitCents: 500000 },
    { id: 'ac-poup', name: 'Reserva', type: 'savings', balanceCents: 1003200 },
  ];

  doc.cards = [NUBANK, ITAU, INTER];

  doc.debts = [
    {
      id: 'dv-rot', name: 'Fatura atrasada · Nubank', kind: KIND.REVOLVING,
      balanceCents: 648000, monthlyRate: 0.149, minPaymentRate: 0.15,
      cardId: 'nu', dueDay: 27, since: '2026-07-27',
    },
    {
      id: 'dv-che', name: 'Cheque especial · Itaú', kind: KIND.OVERDRAFT,
      balanceCents: 320000, monthlyRate: 0.08, minPaymentCents: 0,
      accountId: 'ac-it', dueDay: 10, since: '2026-06-10',
    },
  ];

  doc.recurring = [
    { id: 'rc-sal', label: 'Salário', dayOfMonth: 5, amountCents: 840000, kind: 'income', fixed: true },
    { id: 'rc-alu', label: 'Aluguel', dayOfMonth: 10, amountCents: 180000, kind: 'expense', categoryId: 'moradia' },
    { id: 'rc-cond', label: 'Condomínio', dayOfMonth: 10, amountCents: 62000, kind: 'expense', categoryId: 'moradia' },
    { id: 'rc-luz', label: 'Energia', dayOfMonth: 15, amountCents: 28000, kind: 'expense', categoryId: 'contas' },
    { id: 'rc-net', label: 'Internet', dayOfMonth: 15, amountCents: 9990, kind: 'expense', categoryId: 'contas' },
    { id: 'rc-cel', label: 'Celular', dayOfMonth: 20, amountCents: 7990, kind: 'expense', categoryId: 'contas' },
  ];

  doc.budgets = {
    mercado: 90000, delivery: 30000, combustivel: 40000, lazer: 40000, presentes: 15000,
  };

  doc.goals = [
    { id: 'g-res', name: 'Reserva de emergência', targetCents: 2508000, savedCents: 1003200, monthlyCents: 30000, status: 'ativo', kind: 'reserva' },
    { id: 'g-ipva', name: 'IPVA 2027', targetCents: 168000, savedCents: 42000, monthlyCents: 14000, status: 'ativo', dueMonth: addMonthKey(mes, 5) },
    { id: 'g-cel', name: 'Trocar o celular', targetCents: 350000, savedCents: 20000, monthlyCents: 0, status: 'pausado' },
    { id: 'g-chile', name: 'Chile em 2027', targetCents: 800000, savedCents: 0, monthlyCents: 0, status: 'pausado' },
    { id: 'g-carro', name: 'Carro', targetCents: 0, savedCents: 0, monthlyCents: 0, status: 'ativo', kind: 'projeto', categoryIds: ['combustivel'] },
    { id: 'g-casa', name: 'Casa', targetCents: 0, savedCents: 0, monthlyCents: 0, status: 'ativo', kind: 'projeto', categoryIds: ['moradia', 'contas'] },
  ];

  doc.snapshots = [
    { month: tres, netCents: -1_760_00 * 10 },
    { month: dois, netCents: -1_640_00 * 10 },
    { month: mesAnterior, netCents: -1_566_00 * 10 },
    { month: mes, netCents: -442_000 },
  ];

  // ---- parcelamentos em aberto ----
  const parceladas = [
    { id: 'cp-note', cardId: 'nu', date: addMonths(todayISO, -2).slice(0, 8) + '12', totalCents: 500000, count: 12, description: 'Notebook Dell', categoryId: 'lazer' },
    { id: 'cp-gol', cardId: 'nu', date: addMonths(todayISO, -1).slice(0, 8) + '15', totalCents: 173898, count: 6, description: 'GOL · Florianópolis', categoryId: 'lazer' },
    { id: 'cp-dent', cardId: 'nu', date: addMonths(todayISO, -8).slice(0, 8) + '08', totalCents: 483590, count: 10, description: 'Dentista', categoryId: 'contas' },
  ];

  const transacoes = [];
  for (const compra of parceladas) {
    const card = doc.cards.find((c) => c.id === compra.cardId);
    transacoes.push(...expand(compra, card));
  }

  // ---- lançamentos avulsos ----
  const avulsos = [
    { date: `${mes}-15`, cardId: 'nu', description: 'PAO DE ACUCAR', amountCents: -51230, categoryId: 'mercado', method: 'credit' },
    { date: `${mes}-12`, cardId: 'nu', description: 'IFOOD *CLUB', amountCents: -6890, categoryId: 'delivery', method: 'credit' },
    { date: `${mes}-14`, cardId: 'nu', description: 'PAGSEGURO *AUTOPOSTO', amountCents: -24000, method: 'credit' },
    { date: `${mes}-05`, cardId: 'nu', description: 'NETFLIX', amountCents: -4490, categoryId: 'lazer', method: 'credit' },
    { date: `${mes}-05`, cardId: 'nu', description: 'SPOTIFY', amountCents: -2190, categoryId: 'lazer', method: 'credit' },
    { date: `${mes}-08`, cardId: 'nu', description: 'DROGASIL', amountCents: -8745, categoryId: 'mercado', method: 'credit' },
    { date: `${mes}-16`, accountId: 'ac-nu', description: 'Pix enviado para MARINA COSTA', amountCents: -12000, method: 'pix' },
    { date: `${mes}-11`, accountId: 'ac-nu', description: 'Pix recebido de CLIENTE SERVICO', amountCents: 62000, method: 'pix', extraordinary: true },
    { date: `${mes}-09`, accountId: 'ac-nu', description: 'Trader esportivo', amountCents: 16000, method: 'pix', extraordinary: true },
    { date: `${mes}-05`, accountId: 'ac-nu', description: 'PAGAMENTO SALARIO', amountCents: 840000, categoryId: 'pix-entrada', method: 'transfer' },
    { date: `${mes}-03`, cardId: 'it', description: 'CARREFOUR', amountCents: -34210, categoryId: 'mercado', method: 'credit' },
    { date: `${mes}-01`, cardId: 'it', description: 'UBER *TRIP', amountCents: -3820, categoryId: 'combustivel', method: 'credit' },
    { date: `${mes}-02`, cardId: 'it', description: 'POSTO SHELL BR101', amountCents: -19870, categoryId: 'combustivel', method: 'credit' },
  ];

  // histórico dos meses anteriores, para os gráficos e o custo de vida
  for (const m of [mesAnterior, dois, tres]) {
    avulsos.push(
      { date: `${m}-05`, accountId: 'ac-nu', description: 'PAGAMENTO SALARIO', amountCents: 840000, categoryId: 'pix-entrada', method: 'transfer' },
      { date: `${m}-10`, accountId: 'ac-nu', description: 'ALUGUEL', amountCents: -180000, categoryId: 'moradia', method: 'transfer' },
      { date: `${m}-10`, accountId: 'ac-nu', description: 'CONDOMINIO', amountCents: -62000, categoryId: 'moradia', method: 'transfer' },
      { date: `${m}-15`, accountId: 'ac-nu', description: 'ENEL', amountCents: -28000, categoryId: 'contas', method: 'transfer' },
      { date: `${m}-15`, cardId: 'nu', description: 'PAO DE ACUCAR', amountCents: -48000, categoryId: 'mercado', method: 'credit' },
      { date: `${m}-05`, cardId: 'nu', description: 'NETFLIX', amountCents: m === mes ? -4490 : -3990, categoryId: 'lazer', method: 'credit' },
      { date: `${m}-05`, cardId: 'nu', description: 'SPOTIFY', amountCents: -2190, categoryId: 'lazer', method: 'credit' },
    );
  }
  // a cobrança duplicada que o caça-vazamentos precisa encontrar
  avulsos.push({ date: `${mesAnterior}-07`, cardId: 'nu', description: 'SPOTIFY', amountCents: -2190, categoryId: 'lazer', method: 'credit' });

  avulsos.forEach((t, i) => {
    transacoes.push({
      id: `tx-${i}`,
      ...t,
      competence: monthKey(t.date),
    });
  });

  doc.transactions = transacoes.sort((a, b) => (a.date < b.date ? 1 : -1));
  doc.settings.debtMethod = 'avalanche';

  return doc;
}
