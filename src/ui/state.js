// A camada que transforma o documento guardado no que as telas leem.
//
// Toda conta vive no núcleo (src/core). Aqui só se junta: quais faturas
// existem, que eventos de caixa elas geram, e o que cada tela precisa saber.
// As telas não calculam nada — elas desenham o que este arquivo devolve.

import { sum } from '../core/money.js';
import { today, monthKey, addMonthKey, addDays } from '../core/dates.js';
import { cycleFor, openCycle, nextCycle, dueDateOf } from '../core/statements.js';
import { geraFatura, ehCredito, ehBeneficio, valesDe, previsaoDoBeneficio, debitosFuturos } from '../core/cards.js';
import { byPurchase, wall, committed } from '../core/installments.js';
import { buildEvents, daily, monthly, freeToSpend, nextIncomeDate, mensalDoRecorrente } from '../core/projection.js';
import { totalBalance, totalDailyInterest, totalMonthlyInterest, payoffPlan, minimumOnlyPlan, minimumsToday, minimumOf, order, ativa, somenteAtivas } from '../core/debts.js';
import { monthStatus, overall, fixedVsVariable, worst } from '../core/budget.js';
import { scan } from '../core/leaks.js';
import { diagnose } from '../core/health.js';
import { monthlySpend, dailyNet, worstDay, NEUTRAS } from '../core/history.js';
import { versusMedia, avisosDoDia, marcos, fechamentoDoMes } from '../core/insights.js';
import { perfilAtual } from '../core/perfil.js';
import { categorizeAll } from '../core/categorize.js';
import { MERCHANTS } from '../seed/categories.js';
import { PADROES } from '../config.js';

/** Documento → tudo que as telas precisam. Função pura: mesma entrada, mesma saída. */
export function derive(doc, todayISO = today()) {
  const mes = monthKey(todayISO);
  const categorias = doc.categories?.length ? doc.categories : [];
  const catById = Object.fromEntries(categorias.map((c) => [c.id, c]));
  const contaNome = Object.fromEntries(doc.accounts.map((a) => [a.id, a.name]));

  // ---- faturas ----
  const faturas = statementsOf(doc, todayISO);
  const pagas = new Set(doc.faturasPagas || []);
  const todosCartoes = doc.cards.map((card) => cardView(card, doc, faturas, todayISO, pagas));
  // `cartoes` continua sendo só o crédito porque é o que todas as telas de
  // fatura, limite e projeção já esperavam. Débito e vale têm blocos próprios.
  const cartoes = todosCartoes.filter((c) => ehCredito(c));
  const cartoesDebito = todosCartoes.filter((c) => c.kind === 'debit');
  const vales = valesDe(doc, todayISO);

  // ---- parcelas ----
  const parcelas = doc.transactions.filter((t) => t.installment);
  const compras = byPurchase(parcelas, todayISO);
  const muro = wall(parcelas, mes, PADROES.muroMeses);
  const comprometidoCents = committed(parcelas, todayISO);

  // ---- dívidas ----
  // O filtro é aqui e só aqui. Dívida desligada continua no documento e
  // continua aparecendo na tela de Dívidas — o que ela não faz é entrar em
  // conta nenhuma. Filtrar num lugar só é o que garante isso: espalhar o
  // `if (ativa)` por dez funções é como a regra do mínimo virou quatro cópias
  // e uma delas ficou para trás.
  const dividasAtivas = somenteAtivas(doc.debts);
  const dividasDesligadas = doc.debts.filter((d) => !ativa(d));

  const dividas = order(dividasAtivas, doc.settings?.debtMethod || PADROES.metodoDivida);
  const dividaTotalCents = totalBalance(dividasAtivas);
  const jurosDiaCents = totalDailyInterest(dividasAtivas);
  const jurosMesCents = totalMonthlyInterest(dividasAtivas);
  const minimosCents = minimumsToday(dividasAtivas);

  // ---- caixa ----
  // Investimento não é dinheiro do dia a dia — fica de fora do saldo
  // disponível e da reserva, com número próprio na aba Investimentos.
  const saldoCents = sum(doc.accounts.filter((a) => a.type !== 'savings' && a.type !== 'investment').map((a) => a.balanceCents));
  const guardadoCents = sum(doc.accounts.filter((a) => a.type === 'savings').map((a) => a.balanceCents));
  // Reserva de emergência é dinheiro que você alcança num aperto. O que está
  // nos cofrinhos conta: perguntar "quantos meses de reserva você tem?" e
  // ignorar o cofrinho chamado "Reserva de emergência" era responder zero
  // olhando para o dinheiro separado exatamente para isso.
  const emCofrinhosCents = sum((doc.goals || []).map((g) => Math.max(0, g.savedCents || 0)));
  const reservaCents = guardadoCents + emCofrinhosCents;
  const investidoCents = sum(doc.accounts.filter((a) => a.type === 'investment').map((a) => a.balanceCents));

  // Fatura marcada como paga já saiu do bolso — não é mais saída futura,
  // senão a projeção mostraria um dinheiro que já foi embora como se ainda
  // fosse sair de novo.
  const eventos = buildEvents(
    {
      recurring: doc.recurring || [],
      statements: faturas.futuras.filter((s) => !pagas.has(`${s.cardId}|${s.cycleId}`)),
      // Débito agendado para depois de hoje ainda vai sair da conta — o saldo
      // digitado não o contém. Vale nenhum entra aqui: ele não passa na conta.
      scheduled: [...minimosAgendados(dividasAtivas, todayISO), ...debitosFuturos(doc, todayISO)],
    },
    todayISO,
    addDays(todayISO, PADROES.projecaoDias)
  );

  const projecao = daily(saldoCents, eventos, todayISO, PADROES.projecaoDias);
  const porMes = monthly(projecao);
  const proximaEntrada = nextIncomeDate(eventos, todayISO);
  const livre = freeToSpend(saldoCents, eventos, todayISO, proximaEntrada || addDays(todayISO, 30));

  // ---- renda e sobra ----
  // mensalDoRecorrente, e não amountCents: um fixo quinzenal sai duas vezes no
  // mês. Somar uma só faria o app contar metade do que entra e do que sai — e
  // o custo de vida mínimo é justamente o número que não pode mentir para
  // baixo, porque é dele que sai quanto sobra para pagar dívida.
  const rendaFixaCents = sum(
    (doc.recurring || []).filter((r) => r.kind === 'income').map(mensalDoRecorrente)
  );
  const extrasMesCents = sum(
    doc.transactions
      .filter((t) => t.amountCents > 0 && t.extraordinary && (t.competence || monthKey(t.date)) === mes)
      .map((t) => t.amountCents)
  );
  const fixosCents = sum(
    (doc.recurring || []).filter((r) => r.kind === 'expense').map(mensalDoRecorrente)
  );
  // Só os gastos fixos que são essenciais — moradia, contas — servem de base
  // para o custo mínimo enquanto não há 3 meses de histórico. Assinatura e
  // outros fixos não essenciais não entram: custo mínimo é só o que não dá
  // pra cortar.
  const fixosEssenciaisCents = sum(
    (doc.recurring || [])
      .filter((r) => r.kind === 'expense' && catById[r.categoryId]?.essential)
      .map(mensalDoRecorrente)
  );
  // Gasto fixo sem categoria não pode entrar no custo mínimo — não dá para
  // saber se é o aluguel ou o streaming. Mas sumir calado é pior: a pessoa
  // cadastra R$ 1.500 de contas, o custo mínimo continua zero, e nada na tela
  // explica. Estes ficam listados para a tela poder cobrar a categoria.
  const fixosSemCategoria = (doc.recurring || [])
    .filter((r) => r.kind === 'expense' && !catById[r.categoryId])
    .map((r) => ({ id: r.id, label: r.label, amountCents: mensalDoRecorrente(r) }));
  const fixosSemCategoriaCents = sum(fixosSemCategoria.map((r) => r.amountCents));
  const parcelasDoMesCents = muro[0]?.cents || 0;

  // Quanto realmente sobra. Somar só os fixos cadastrados mente para cima:
  // mercado, combustível e farmácia não estão lá e saem todo mês do mesmo
  // jeito. Por isso o custo de vida vem do histórico quando existe histórico,
  // e só cai para os fixos cadastrados quando o app ainda é novo.
  const custo = custoDeVida(doc, mes, fixosCents);
  const sobraCents = rendaFixaCents - custo.cents - parcelasDoMesCents;

  // ---- plano de saída ----
  const orcamentoDivida = doc.settings?.debtBudgetCents ?? Math.max(0, sobraCents);
  const plano = dividasAtivas.length
    ? payoffPlan(dividasAtivas, orcamentoDivida, {
        method: doc.settings?.debtMethod || PADROES.metodoDivida,
        fromMonth: mes,
      })
    : null;
  const planoMinimo = dividasAtivas.length ? minimumOnlyPlan(dividasAtivas, { fromMonth: mes }) : null;

  // ---- orçamento ----
  const comTeto = categorias.map((c) => ({ ...c, limitCents: doc.budgets?.[c.id] || 0 }));
  const orcamento = monthStatus(comTeto, doc.transactions, todayISO);
  // Teto é pra gasto que varia. Categoria fixa (Moradia, Contas da casa...) tem
  // valor e dia certos vindos de Gastos fixos — vira lista informativa em vez
  // de barra de progresso presa em "R$ 0 gasto" pra sempre. O resumo geral
  // também não pode somar teto de categoria fixa — contava um número que não
  // tinha mais barra nenhuma pra explicar de onde vinha.
  const orcamentoVariavel = orcamento.filter((c) => !c.fixed);
  const orcamentoGeral = orcamentoVariavel.length ? overall(orcamentoVariavel, todayISO) : null;
  const gastoFixoPorCategoria = new Map();
  for (const r of doc.recurring || []) {
    if (r.kind !== 'expense' || !r.categoryId) continue;
    gastoFixoPorCategoria.set(r.categoryId, (gastoFixoPorCategoria.get(r.categoryId) || 0) + Math.abs(r.amountCents));
  }
  const categoriasFixas = categorias
    .filter((c) => c.fixed && gastoFixoPorCategoria.has(c.id))
    .map((c) => ({ ...c, fixedCents: gastoFixoPorCategoria.get(c.id) }));
  const fixoVariavel = fixedVsVariable(doc.transactions, categorias, mes);

  // ---- histórico: tendência, não projeção ----
  const historicoMensal = monthlySpend(doc.transactions, todayISO, { months: 6 });
  const { dias: calendarioDias, primeiroDiaSemana } = dailyNet(doc.transactions, mes);
  const piorDiaMes = worstDay(calendarioDias);

  // ---- o que o app tem a dizer sem ser perguntado ----
  const comparativo = versusMedia(doc.transactions, categorias, todayISO);

  // ---- vazamentos e diagnóstico ----
  const vazamentos = scan(doc.transactions, todayISO);
  const saude = diagnose({
    transactions: doc.transactions,
    categories: categorias,
    accounts: doc.accounts,
    // O diagnóstico de saúde também só olha as ativas: juro sobre a renda e
    // comprometimento com uma dívida pausada dariam um retrato pior do que a
    // realidade que a pessoa escolheu acompanhar.
    debts: dividasAtivas,
    incomeCents: rendaFixaCents + extrasMesCents,
    savedCents: reservaCents,
    todayISO,
    minimumCostManualCents: doc.profile?.minimumCostCents || 0,
    minimumCostFixedCents: fixosEssenciaisCents,
    bens: doc.assets || [],
  });

  // ---- fila de revisão ----
  const semCategoria = doc.transactions.filter((t) => !t.categoryId && !t.installment);
  const { transactions: sugeridas, toReview } = categorizeAll(semCategoria, {
    rules: doc.rules || [],
    memory: doc.memory || {},
    merchants: MERCHANTS,
  });
  // A fila mostra primeiro o que o app não soube resolver sozinho.
  const revisao = [...toReview, ...sugeridas.filter((t) => t.categoryId)].slice(0, 40);

  // ---- progresso da saída ----
  const picoCents = Math.max(doc.profile?.debtPeakCents || 0, dividaTotalCents);
  const progresso = picoCents > 0 ? 1 - dividaTotalCents / picoCents : 0;

  // Um app sem nada dentro não tem número para mostrar — quem desenha decide o
  // que fazer com isso, mas quem decide se está vazio é aqui.
  const vazio = !doc.transactions.length && !doc.cards.length
    && !doc.debts.length && !(doc.recurring || []).length;

  return {
    todayISO,
    mes,
    vazio,
    doc,
    catById,
    contaNome,
    categorias,
    fixosSemCategoria,
    fixosSemCategoriaCents,
    cartoes,
    todosCartoes,
    cartoesDebito,
    vales,
    faturas,
    parcelas,
    compras,
    muro,
    comprometidoCents,
    dividas,
    dividasDesligadas,
    debts: doc.debts,
    dividaTotalCents,
    jurosDiaCents,
    jurosMesCents,
    minimosCents,
    picoCents,
    progresso,
    saldoCents,
    guardadoCents,
    emCofrinhosCents,
    reservaCents,
    investidoCents,
    eventos,
    projecao,
    porMes,
    proximaEntrada,
    livre,
    rendaFixaCents,
    extrasMesCents,
    fixosCents,
    parcelasDoMesCents,
    custoVida: custo,
    sobraCents,
    orcamentoDivida,
    plano,
    planoMinimo,
    orcamento,
    orcamentoGeral,
    orcamentoVariavel,
    categoriasFixas,
    piorCategoria: orcamento.length ? worst(orcamento) : null,
    fixoVariavel,
    historicoMensal,
    calendarioDias,
    primeiroDiaSemana,
    piorDiaMes,
    vazamentos,
    saude,
    revisao,
    // "Últimos lançamentos" é o que JÁ aconteceu, do mais recente para trás.
    // Parcela que só vence em dezembro aparecia no topo empurrando o gasto de
    // hoje para baixo — ela é compromisso futuro e o lugar dela é o muro de
    // parcelas, não a lista do que você acabou de fazer.
    lancamentos: [...doc.transactions]
      .filter((t) => t.date <= todayISO)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 12),
    guia: guiaStatus(doc, { custoConhecidoCents: saude.minimumCost.cents }),
    comparativo,
    // "Esse mês fecha?" — pergunta diferente da projeção de 90 dias, que
    // responde "quando fico negativo". As faturas do mês corrente e os fixos
    // contra o que entra.
    fechamento: fechamentoDoMes({
      entradasCents: rendaFixaCents + extrasMesCents,
      faturasCents: sum(
        faturas.futuras
          .filter((s) => monthKey(s.dueDate) === mes && !pagas.has(`${s.cardId}|${s.cycleId}`))
          .map((s) => s.totalCents)
      ),
      parcelasCents: parcelasDoMesCents,
      fixosCents,
      minimosDividaCents: minimosCents,
    }),
    // O perfil é a fase que a pessoa está vivendo, lida do comportamento.
    // O quiz do começo só cobre o vazio, e perde a vez assim que há dado.
    perfil: perfilAtual({
      comportamento: {
        dividaTotalCents,
        jurosMesCents,
        rendaMensalCents: rendaFixaCents,
        reservaMeses: saude.emergency.months,
        sobraCents,
        mesesDeHistorico: custo.months || 0,
      },
      quizRespostas: doc.profile?.quiz || {},
    }),
    // Os avisos precisam da projeção e das faturas já prontas, por isso saem
    // daqui de baixo e não lá de cima.
    avisos: avisosDoDia({
      projecao,
      faturas: faturas.futuras.filter((s) => !pagas.has(`${s.cardId}|${s.cycleId}`)),
      vazamentos,
      revisaoCount: revisao.length,
      backupDiasSem: null,
      todayISO,
    }),
    marcos: marcos({
      dividaTotalCents,
      dividaPicoCents: picoCents,
      reservaMeses: saude.emergency.months,
      faturasPagas: (doc.faturasPagas || []).length,
      categorizados: Object.keys(doc.memory || {}).length,
    }),
  };
}

/**
 * Custo de vida do mês: o que sai de verdade, fora parcelas e dívidas.
 *
 * Prefere o histórico dos meses já fechados — o mês corrente sempre parece
 * barato porque ainda não terminou. Sem pelo menos dois meses fechados, usa os
 * gastos fixos cadastrados e avisa que o número está subestimado.
 */
function custoDeVida(doc, mesAtual, fixosCents) {
  const porMes = new Map();
  for (const t of doc.transactions) {
    if (t.amountCents >= 0) continue;
    if (t.installment) continue;               // parcela entra separada
    if (t.categoryId === 'taxas') continue;    // juros são conta da dívida
    if (NEUTRAS.has(t.categoryId)) continue;   // trocar de bolso não é gastar
    const comp = t.competence || monthKey(t.date);
    if (comp >= mesAtual) continue;            // mês corrente ainda está aberto
    porMes.set(comp, (porMes.get(comp) || 0) + Math.abs(t.amountCents));
  }

  const valores = [...porMes.values()];
  const media = valores.length ? Math.round(sum(valores) / valores.length) : 0;

  // O que já se sabe que sai todo mês é piso, igual no custo mínimo.
  //
  // Isto aqui é mais perigoso que lá: esta função decide quanto "sobra" para
  // atacar dívida. Com dois meses magros de histórico o app dizia que sobravam
  // R$ 4.446 de uma renda de R$ 4.700 — porque achava que viver custava R$ 254.
  // Mandar alguém comprometer isso com dívida é empurrar para o vermelho no
  // mês seguinte.
  if (media < fixosCents) {
    return { cents: fixosCents, source: 'fixos', months: valores.length, confident: false };
  }

  return {
    cents: media,
    source: 'histórico',
    months: valores.length,
    confident: valores.length >= 3,
  };
}

/**
 * Faturas: agrupa os lançamentos de cartão pelo ciclo em que caem.
 *
 * Como cada parcela já nasce com `cycleId` e `dueDate` próprios, agrupar aqui
 * basta — as parcelas futuras entram nas faturas futuras sozinhas.
 */
export function statementsOf(doc, todayISO = today()) {
  const cardById = Object.fromEntries(doc.cards.map((c) => [c.id, c]));
  const grupos = new Map();

  for (const t of doc.transactions) {
    if (!t.cardId) continue;
    const card = cardById[t.cardId];
    if (!card) continue;
    // Débito sai da conta no dia e benefício sai do saldo do vale. Nenhum dos
    // dois vira fatura — agrupá-los aqui criaria uma cobrança futura para um
    // dinheiro que já saiu, ou que nunca vai sair da conta.
    if (!geraFatura(card)) continue;
    const ciclo = t.cycleId ? { id: t.cycleId } : cycleFor(card, t.date);
    const chave = `${card.id}|${ciclo.id}`;
    const g = grupos.get(chave) || {
      id: chave,
      cardId: card.id,
      cardName: card.name,
      cycleId: ciclo.id,
      closeDate: ciclo.id,
      // Recalcula sempre do cartão de hoje, nunca confia no dueDate gravado
      // no lançamento — editar o dia de vencimento do cartão não pode deixar
      // fatura antiga presa na data velha.
      dueDate: dueDateOf(card, ciclo.id),
      totalCents: 0,
      items: [],
    };
    g.totalCents += Math.abs(t.amountCents);
    g.items.push(t);
    grupos.set(chave, g);
  }

  const todas = [...grupos.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return {
    todas,
    futuras: todas.filter((s) => s.dueDate >= todayISO),
    porCartao: (cardId) => todas.filter((s) => s.cardId === cardId),
  };
}

/** A visão de um cartão: fatura aberta, próxima a vencer, limite usado. */
function cardView(card, doc, faturas, todayISO, pagas = new Set()) {
  // Só o crédito tem ciclo. Chamar openCycle num vale devolveria datas
  // inventadas a partir de um closingDay que ninguém preencheu, e a tela
  // mostraria "fecha dia 20" para um cartão que não fecha nunca.
  if (!geraFatura(card)) return semFaturaView(card, doc, todayISO);

  const aberta = openCycle(card, todayISO);
  const doCartao = faturas.porCartao(card.id);
  const atual = doCartao.find((s) => s.cycleId === aberta.id);
  const fechadas = doCartao.filter((s) => s.closeDate < todayISO && s.dueDate >= todayISO);
  const proxima = doCartao.find((s) => s.dueDate >= todayISO);
  const atraso = doc.debts.find((d) => d.cardId === card.id);
  const proximaPaga = proxima ? pagas.has(`${proxima.cardId}|${proxima.cycleId}`) : false;

  // Fatura paga não pesa mais no limite usado — o dinheiro já saiu de verdade.
  const usadoCents =
    sum(doCartao.filter((s) => s.dueDate >= todayISO && !pagas.has(`${s.cardId}|${s.cycleId}`)).map((s) => s.totalCents)) +
    Math.abs(atraso?.balanceCents || 0);

  return {
    ...card,
    cycle: aberta,
    openCents: atual?.totalCents || 0,
    openItems: atual?.items || [],
    closedStatements: fechadas,
    nextStatement: proxima || null,
    nextStatementPaga: proximaPaga,
    overdue: atraso || null,
    usedCents: usadoCents,
    availableCents: Math.max(0, (card.limitCents || 0) - usadoCents),
    usedRatio: card.limitCents ? Math.min(1, usadoCents / card.limitCents) : 0,
  };
}

/**
 * A visão de um cartão que não gera fatura.
 *
 * Devolve os mesmos campos que a tela espera do crédito, zerados, para nenhuma
 * tela precisar perguntar o tipo antes de ler. O que muda é o que tem valor:
 * o débito carrega o saldo da conta de onde sai; o benefício, o saldo do vale.
 */
function semFaturaView(card, doc, todayISO) {
  const vale = ehBeneficio(card) ? previsaoDoBeneficio(card, doc.transactions || [], todayISO) : null;
  const conta = card.accountId ? doc.accounts.find((a) => a.id === card.accountId) : null;

  const gastoNoMes = (doc.transactions || [])
    .filter((t) => t.cardId === card.id && t.amountCents < 0 && monthKey(t.date) === monthKey(todayISO))
    .reduce((total, t) => total + Math.abs(t.amountCents), 0);

  return {
    ...card,
    cycle: null,
    openCents: 0,
    openItems: [],
    closedStatements: [],
    nextStatement: null,
    nextStatementPaga: false,
    overdue: null,
    usedCents: 0,
    availableCents: 0,
    usedRatio: 0,
    // o que de fato importa neste cartão
    vale,
    conta: conta ? { id: conta.id, name: conta.name, balanceCents: conta.balanceCents } : null,
    gastoNoMesCents: gastoNoMes,
  };
}

/**
 * Os mínimos das dívidas viram saídas mensais na projeção de caixa.
 *
 * Usa `minimumOf` do núcleo, e não uma conta própria. Esta função era a quarta
 * cópia da mesma regra: quando as outras três foram unificadas, ela ficou para
 * trás e continuou aceitando mínimo maior que o saldo. O resultado foi a
 * projeção despencar para R$ 650 mil negativos com uma dívida de R$ 10 mil.
 */
function minimosAgendados(debts, todayISO) {
  const out = [];
  for (const d of debts) {
    const minimo = minimumOf(d);
    if (minimo <= 0) continue;
    // O dia do vencimento é o que a pessoa informou. Antes isto usava `since`
    // — a data em que a dívida foi CADASTRADA — como se fosse o dia de pagar.
    // Quem cadastrasse hoje via o app anunciar "sua conta fica negativa hoje",
    // com uma saída que não existia: o app tinha inventado a data.
    const dia = Number(d.dueDay) || 10;
    for (let i = 0; i < 4; i++) {
      const mes = addMonthKey(monthKey(todayISO), i);
      const data = `${mes}-${String(Math.min(dia, 28)).padStart(2, '0')}`;
      if (data >= todayISO) {
        out.push({ id: `${d.id}@${mes}`, date: data, amountCents: -minimo, label: `Mínimo · ${d.name}`, kind: 'debt' });
      }
    }
  }
  return out;
}

/**
 * Os sete passos do "Como usar" — o que já está feito e o que falta.
 *
 * `custoConhecidoCents` é o que o app JÁ calculou a partir dos gastos fixos ou
 * do histórico. Sem ele este checklist ficava cobrando "preencha o custo de
 * vida mínimo" de quem já tinha cadastrado aluguel, luz e internet: o passo só
 * olhava o campo digitado à mão e ignorava a conta que o próprio app tinha
 * acabado de fazer. Passo que cobra o que já está feito ninguém termina.
 */
export function guiaStatus(doc, { custoConhecidoCents = 0 } = {}) {
  const passos = [
    { id: 'cartoes', label: 'Cartões e contas', where: 'em Finanças', hint: 'fechamento, vencimento e limite de cada um', go: 'cartoes', done: doc.cards.length > 0 && doc.accounts.length > 0 },
    { id: 'dividas', label: 'Dívidas e taxas', where: 'em Dívidas', hint: 'o juro vem escrito na fatura e no extrato', go: 'dividas', done: doc.debts.length > 0 },
    { id: 'fixos', label: 'Renda e gastos fixos', where: 'em Tudo', hint: 'salário, aluguel, luz, internet, assinaturas', go: 'tudo', done: (doc.recurring || []).length >= 2 },
    { id: 'tetos', label: 'Tetos por categoria', where: 'em Saúde', hint: 'quanto pode gastar em cada coisa', go: 'analise', done: Object.keys(doc.budgets || {}).length > 0 },
    { id: 'custo', label: 'Custo de vida mínimo', where: 'em Saúde', hint: 'só o que não dá pra cortar. É a base de tudo', go: 'analise',
      done: (doc.profile?.minimumCostCents || 0) > 0 || custoConhecidoCents > 0 },
    { id: 'cofrinhos', label: 'Criar seus cofrinhos', where: 'em Investimentos', hint: 'comece só pela reserva de emergência', go: 'investimentos', done: (doc.goals || []).length > 0 },
    { id: 'backup', label: 'Primeiro backup', where: 'em Tudo', hint: 'sem servidor, o backup é você quem faz', go: 'tudo', done: !!doc.profile?.backupFeito },
  ];
  const feitos = passos.filter((p) => p.done).length;
  return { passos, feitos, total: passos.length, pendentes: passos.filter((p) => !p.done) };
}
