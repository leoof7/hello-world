// Os três tipos de cartão, e de onde o dinheiro sai em cada um.
//
// A distinção não é cosmética — ela decide o que entra na projeção de caixa:
//
//   crédito    a compra vira fatura. O dinheiro sai da conta no vencimento,
//              não no dia da compra. É o que projection.js já sabia fazer.
//   débito     o dinheiro sai da conta no mesmo dia. Sem fatura, sem limite.
//   benefício  o dinheiro sai do saldo do próprio vale, que a empresa
//              recarrega. Nunca passa pela conta corrente.
//
// O benefício é o caso que quebra tudo se for tratado como gasto comum: passa
// na maquininha como crédito, mas não gera fatura nenhuma, e descontar R$ 500
// de VA do saldo da conta faria o app prever furo de caixa por dinheiro que
// nunca esteve lá. Por isso ele tem carteira própria.
//
// A outra metade da mesma verdade: mercado pago no VA CONTINUA sendo gasto de
// mercado. O cartão é a origem do dinheiro, não a categoria da compra — quem
// olha "quanto gastei com comida" tem que ver os dois juntos, e quem olha
// "quanto sai da minha conta" tem que ver só um.

import { parts, clampedDay, addMonths, iso, daysBetween, addDays, monthKey, monthStart } from './dates.js';

export const KIND = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  BENEFIT: 'benefit',
};

export const TIPOS = [
  {
    id: KIND.CREDIT,
    nome: 'Crédito',
    sub: 'fecha, vence e vira fatura',
    campos: ['closingDay', 'dueDay', 'limitCents'],
  },
  {
    id: KIND.DEBIT,
    nome: 'Débito',
    sub: 'sai da conta na hora',
    campos: ['accountId'],
  },
  {
    id: KIND.BENEFIT,
    nome: 'Benefício',
    sub: 'vale alimentação, refeição, transporte, combustível',
    campos: ['balanceCents', 'reloadCents', 'reloadDay'],
  },
];

export const ehCredito = (card) => (card?.kind || KIND.CREDIT) === KIND.CREDIT;
export const ehDebito = (card) => card?.kind === KIND.DEBIT;
export const ehBeneficio = (card) => card?.kind === KIND.BENEFIT;

/** Só o crédito gera fatura. Débito e benefício saem na hora. */
export const geraFatura = (card) => ehCredito(card);

/** Só o crédito permite parcelar. Não dá para dividir um débito em 12x. */
export const permiteParcelar = (card) => ehCredito(card);

/**
 * Valida um cartão antes de salvar. Devolve a lista de problemas, vazia quando
 * está tudo certo — quem chama decide se bloqueia ou só avisa.
 */
export function validarCartao(card, { accounts = [] } = {}) {
  const erros = [];
  if (!card?.name?.trim()) erros.push('o cartão precisa de um nome');

  if (ehDebito(card)) {
    // Débito sem conta é um cartão que debita do nada. A tela resolve isso
    // criando a conta junto, mas a regra mora aqui para o núcleo não depender
    // de ninguém ter lembrado de fazer isso.
    if (!card.accountId) erros.push('cartão de débito precisa de uma conta');
    else if (!accounts.some((a) => a.id === card.accountId)) {
      erros.push('a conta desse cartão de débito não existe mais');
    }
  }

  if (ehBeneficio(card)) {
    const dia = Number(card.reloadDay);
    if (card.reloadCents > 0 && (!dia || dia < 1 || dia > 31)) {
      erros.push('a recarga precisa de um dia do mês entre 1 e 31');
    }
  }

  if (ehCredito(card)) {
    for (const [campo, rotulo] of [['closingDay', 'fechamento'], ['dueDay', 'vencimento']]) {
      const dia = Number(card[campo]);
      if (!dia || dia < 1 || dia > 31) erros.push(`o dia de ${rotulo} precisa ficar entre 1 e 31`);
    }
  }

  return erros;
}

/**
 * O que sobrou no vale hoje.
 *
 * O saldo digitado vale a partir da data em que foi digitado — não do começo
 * dos tempos. Sem esse corte, atualizar o saldo à mão descontaria de novo as
 * compras já refletidas nele, e o vale iria a zero sozinho a cada correção.
 */
export function saldoDoBeneficio(card, transactions = [], todayISO) {
  const desde = card.balanceAsOf || null;
  const gastos = transactions.filter((t) =>
    t.cardId === card.id
    && t.amountCents < 0
    && (!desde || t.date > desde)
    && (!todayISO || t.date <= todayISO));

  const gastoCents = gastos.reduce((total, t) => total + Math.abs(t.amountCents), 0);
  return {
    saldoCents: (card.balanceCents || 0) - gastoCents,
    gastoCents,
    desde,
  };
}

/** A próxima data de recarga, a partir de hoje. Null quando não tem recarga. */
export function proximaRecarga(card, todayISO) {
  const dia = Number(card?.reloadDay);
  if (!card?.reloadCents || !dia) return null;

  const { y, m } = parts(todayISO);
  const desteMes = clampedDay(y, m, dia);
  if (desteMes > todayISO) return desteMes;

  const seguinte = parts(addMonths(iso(y, m, 1), 1));
  return clampedDay(seguinte.y, seguinte.m, dia);
}

/**
 * O vale aguenta até a próxima recarga?
 *
 * O ritmo vem do que já foi gasto no ciclo corrente, não de uma média de meses
 * — vale é dinheiro de mês fechado, e o mês passado não paga o almoço de hoje.
 */
export function previsaoDoBeneficio(card, transactions = [], todayISO) {
  const { saldoCents, gastoCents } = saldoDoBeneficio(card, transactions, todayISO);
  const recarga = proximaRecarga(card, todayISO);

  const base = {
    cardId: card.id, nome: card.name, saldoCents, gastoCents,
    proximaRecarga: recarga, diasAteRecarga: recarga ? daysBetween(todayISO, recarga) : null,
  };

  if (saldoCents <= 0) return { ...base, situacao: 'acabou', diasQueAinda: 0, acabaEm: todayISO };
  if (!recarga) return { ...base, situacao: 'sem-recarga', diasQueAinda: null, acabaEm: null };

  // Quanto tempo o ciclo corrente já rodou: do último dia de recarga até hoje.
  const inicioDoCiclo = card.balanceAsOf || recargaAnterior(card, todayISO);
  const diasCorridos = Math.max(1, daysBetween(inicioDoCiclo, todayISO));
  const porDia = gastoCents / diasCorridos;

  if (porDia <= 0) return { ...base, situacao: 'folgado', diasQueAinda: null, acabaEm: null };

  const diasQueAinda = Math.floor(saldoCents / porDia);
  const diasAteRecarga = base.diasAteRecarga;
  return {
    ...base,
    porDiaCents: Math.round(porDia),
    diasQueAinda,
    acabaEm: addDays(todayISO, diasQueAinda),
    situacao: diasQueAinda >= diasAteRecarga ? 'folgado' : 'aperta',
  };
}

/** A recarga mais recente que já passou. Serve de início do ciclo corrente. */
function recargaAnterior(card, todayISO) {
  const dia = Number(card?.reloadDay);
  if (!dia) return monthStart(monthKey(todayISO));
  const { y, m } = parts(todayISO);
  const desteMes = clampedDay(y, m, dia);
  if (desteMes <= todayISO) return desteMes;
  const anterior = parts(addMonths(iso(y, m, 1), -1));
  return clampedDay(anterior.y, anterior.m, dia);
}

/**
 * Todos os vales, prontos para a tela.
 * Ordena pelo que está mais perto de acabar — é a informação que faz agir.
 */
export function valesDe(doc, todayISO) {
  return (doc.cards || [])
    .filter(ehBeneficio)
    .map((c) => ({ ...previsaoDoBeneficio(c, doc.transactions || [], todayISO), color: c.color }))
    .sort((a, b) => {
      const pa = a.diasQueAinda ?? 9999;
      const pb = b.diasQueAinda ?? 9999;
      return pa - pb;
    });
}

/**
 * Quanto cada conta perde por causa dos cartões de débito, dia a dia.
 *
 * O débito já sai da conta no dia da compra, então o saldo digitado pela pessoa
 * normalmente já reflete isso. Esta função existe para o caso oposto: compras
 * de débito lançadas com data futura (agendadas), que ainda vão sair.
 */
export function debitosFuturos(doc, todayISO) {
  const debito = new Set((doc.cards || []).filter(ehDebito).map((c) => c.id));
  if (!debito.size) return [];

  return (doc.transactions || [])
    .filter((t) => t.cardId && debito.has(t.cardId) && t.date > todayISO && t.amountCents < 0)
    .map((t) => ({
      id: t.id,
      date: t.date,
      amountCents: t.amountCents,
      label: t.description || 'Débito',
      kind: 'debito',
    }));
}
