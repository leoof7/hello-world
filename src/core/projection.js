// Projeção de fluxo de caixa — regime de CAIXA, não de competência.
//
// A distinção que faz a projeção ser honesta: uma compra de R$ 1.200 em 12x
// feita hoje não tira R$ 1.200 da conta hoje. O dinheiro sai quando a fatura
// vence, R$ 100 por vez. Por isso a projeção trabalha com vencimentos de
// fatura, não com transações soltas.

import { sum } from './money.js';
import { addDays, daysBetween, clampedDay, parts, monthKey, addMonthKey, min as minDate } from './dates.js';

/**
 * Em que dias do mês este lançamento fixo acontece.
 *
 * Nem tudo que repete repete uma vez por mês. Diarista, pensão e mesada
 * costumam ser de quinze em quinze dias, e o Pix agendado segue o mesmo
 * ritmo. Cadastrar isso como mensal fazia o app contar METADE do que sai —
 * e o custo de vida mínimo é justamente o número que não pode mentir para
 * baixo, porque é dele que sai quanto sobra para pagar dívida.
 *
 * A quinzena é modelada como dois dias do mês, e não como "a cada 14 dias",
 * porque é assim que acontece na vida: dia 5 e dia 20. Um contador de dias
 * corridos iria escorregando pelo calendário e nunca bateria com o extrato.
 */
export function diasDoRecorrente(r) {
  const primeiro = Math.min(28, Math.max(1, Number(r?.dayOfMonth) || 5));
  if (r?.every !== 'quinzena') return [primeiro];

  const segundo = Math.min(28, Math.max(1, Number(r?.dayOfMonth2) || ((primeiro + 15) % 28 || 28)));
  return segundo === primeiro ? [primeiro] : [primeiro, segundo].sort((a, b) => a - b);
}

/** Quanto este fixo custa por mês somando todas as vezes que ele acontece. */
export const mensalDoRecorrente = (r) => Math.abs(r?.amountCents || 0) * diasDoRecorrente(r).length;

/**
 * Os gastos fixos de um mês, na forma de lançamento.
 *
 * Existe porque as telas de GASTO liam só `transactions`, e aluguel, luz e
 * internet moram em `recurring`. O resultado é que a projeção conhecia esses
 * R$ 1.170 por mês e a Saúde não: "fixo contra variável" dizia 0% fixo, a
 * tendência mensal mostrava só as compras avulsas, e o "para onde foi" perdia
 * a maior fatia do mês. Três telas discordando do resto do app sobre o mesmo
 * dinheiro.
 *
 * No mês corrente entram só as ocorrências cujo dia já passou. Contar o
 * aluguel do dia 10 no dia 3 faria o mês nascer quase todo gasto — e a pessoa
 * abriria o app no começo do mês achando que já torrou tudo.
 */
export function lancamentosDeFixos(recurring = [], mesKey, todayISO, jaLancados = []) {
  const saida = [];
  const [ano, mes] = String(mesKey).split('-').map(Number);
  const mesCorrente = mesKey === String(todayISO).slice(0, 7);

  // Em que categorias a pessoa JÁ lançou gasto neste mês.
  //
  // É a regra que decide entre contar duas vezes e não contar: quem tem o
  // aluguel como fixo e também registra o pagamento veria dois aluguéis no
  // mês, e um app que conta o mesmo dinheiro duas vezes é pior que um que
  // não conta.
  //
  // O critério é a CATEGORIA, não o valor. Comparar valor é frágil — o
  // aluguel sobe, a luz varia todo mês — e erra dos dois lados. Categoria
  // responde a pergunta certa: se você lança gastos de Moradia, o app confia
  // no que você lançou; se não lança nada de Moradia, ele usa o fixo que você
  // cadastrou. Um dos dois sempre vale, nunca os dois.
  const categoriasLancadas = new Set(
    jaLancados
      .filter((t) => t.amountCents < 0 && !t.derivado
        && (t.competence || String(t.date).slice(0, 7)) === mesKey)
      .map((t) => t.categoryId || null)
  );

  for (const r of recurring) {
    if (r.kind !== 'expense') continue;
    if (categoriasLancadas.has(r.categoryId || null)) continue;
    // Fixo pago no vale não sai da conta, mas É gasto: aparece na categoria
    // dele como qualquer compra. Quem decide o que entra no caixa é a
    // projeção; aqui o assunto é "quanto eu gastei".
    for (const dia of diasDoRecorrente(r)) {
      const data = clampedDay(ano, mes, dia);
      if (mesCorrente && data > todayISO) continue;
      saida.push({
        id: `fixo:${r.id}:${data}`,
        date: data,
        competence: mesKey,
        amountCents: -Math.abs(r.amountCents),
        description: r.label,
        categoryId: r.categoryId || null,
        cardId: r.cardId || null,
        // Marca que é derivado. Nada que edita, revisa ou categoriza pode
        // topar com isto achando que é um lançamento de verdade.
        derivado: true,
      });
    }
  }
  return saida;
}

/** Os fixos de vários meses de uma vez — para a tendência e as médias. */
export function fixosDeVariosMeses(recurring = [], meses = [], todayISO, jaLancados = []) {
  return meses.flatMap((m) => lancamentosDeFixos(recurring, m, todayISO, jaLancados));
}

/**
 * Gera os eventos de caixa entre duas datas.
 *
 * recurring: [{ id, label, dayOfMonth, amountCents, kind:'income'|'expense',
 *               every?: 'mes'|'quinzena', dayOfMonth2? }]
 * statements: [{ dueDate, totalCents, cardName }]  — faturas a pagar
 * scheduled: [{ date, amountCents, label }]        — boletos e avulsos
 */
export function buildEvents({ recurring = [], statements = [], scheduled = [] }, fromISO, toISO) {
  const events = [];

  for (const r of recurring) {
    // Fixo que sai do vale não passa pela conta corrente.
    //
    // É o caso de quem paga água, luz e internet no cartão de benefício: o
    // dinheiro é do vale e nunca esteve na conta. Descontar aqui faria o app
    // prever furo de caixa por dinheiro que não vai sair de lá — o mesmo erro
    // que já foi corrigido para as compras avulsas no vale.
    if (r.foraDoCaixa) continue;

    const dias = diasDoRecorrente(r);
    let key = monthKey(fromISO);
    for (let i = 0; i < 24; i++) {
      const [y, m] = key.split('-').map(Number);
      let passouDoFim = false;

      for (const dia of dias) {
        const date = clampedDay(y, m, dia);
        if (date >= fromISO && date <= toISO) {
          events.push({
            date,
            amountCents: r.kind === 'income' ? Math.abs(r.amountCents) : -Math.abs(r.amountCents),
            label: r.label,
            kind: r.kind,
            sourceId: r.id,
          });
        }
        if (date > toISO) passouDoFim = true;
      }

      if (passouDoFim) break;
      key = addMonthKey(key, 1);
    }
  }

  for (const s of statements) {
    if (s.dueDate >= fromISO && s.dueDate <= toISO && s.totalCents !== 0) {
      events.push({
        date: s.dueDate,
        amountCents: -Math.abs(s.totalCents),
        label: `Fatura ${s.cardName || ''}`.trim(),
        kind: 'statement',
        sourceId: s.id,
      });
    }
  }

  for (const s of scheduled) {
    if (s.date >= fromISO && s.date <= toISO) {
      events.push({
        date: s.date,
        amountCents: s.amountCents,
        label: s.label,
        kind: s.kind || 'scheduled',
        sourceId: s.id,
      });
    }
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Saldo dia a dia.
 * Devolve { days, min, max, firstNegative, endBalanceCents }.
 */
export function daily(startBalanceCents, events, fromISO, days = 90) {
  const toISO = addDays(fromISO, days);
  const porDia = new Map();
  for (const e of events) {
    if (e.date < fromISO || e.date > toISO) continue;
    porDia.set(e.date, [...(porDia.get(e.date) || []), e]);
  }

  const out = [];
  let saldo = startBalanceCents;
  let menor = { date: fromISO, cents: saldo };
  let maior = { date: fromISO, cents: saldo };
  let primeiroNegativo = null;

  for (let i = 0; i <= days; i++) {
    const date = addDays(fromISO, i);
    const doDia = porDia.get(date) || [];
    saldo += sum(doDia.map((e) => e.amountCents));

    if (saldo < menor.cents) menor = { date, cents: saldo };
    if (saldo > maior.cents) maior = { date, cents: saldo };
    if (saldo < 0 && !primeiroNegativo) primeiroNegativo = { date, cents: saldo };

    out.push({ date, balanceCents: saldo, events: doDia });
  }

  return {
    days: out,
    min: menor,
    max: maior,
    firstNegative: primeiroNegativo,
    endBalanceCents: saldo,
  };
}

/** Fecha a projeção diária em meses, para a visão de 12 meses. */
export function monthly(projection) {
  const buckets = new Map();
  for (const d of projection.days) {
    const key = monthKey(d.date);
    const b = buckets.get(key) || { month: key, inCents: 0, outCents: 0, endBalanceCents: 0 };
    for (const e of d.events) {
      if (e.amountCents > 0) b.inCents += e.amountCents;
      else b.outCents += Math.abs(e.amountCents);
    }
    b.endBalanceCents = d.balanceCents;
    buckets.set(key, b);
  }
  return [...buckets.values()];
}

/**
 * "Livre para gastar" até a próxima entrada relevante.
 *
 * Não é o saldo. É o que sobra depois de honrar tudo que já está contratado
 * até lá: faturas, contas fixas e parcelas.
 */
export function freeToSpend(startBalanceCents, events, fromISO, untilISO) {
  // A janela é FECHADA no início e ABERTA no fim: "livre até o dia 5" significa
  // até a véspera do dia 5. O salário do dia 5 pertence ao próximo período —
  // contá-lo aqui seria gastar dinheiro que ainda não entrou.
  const dentro = (e) => e.date >= fromISO && e.date < untilISO;
  const compromissos = events.filter((e) => dentro(e) && e.amountCents < 0);
  const entradas = events.filter((e) => dentro(e) && e.amountCents > 0 && e.kind === 'income');
  const cents = startBalanceCents + sum(entradas.map((e) => e.amountCents)) - sum(compromissos.map((e) => Math.abs(e.amountCents)));
  const dias = Math.max(1, daysBetween(fromISO, untilISO));
  return {
    cents,
    days: dias,
    perDayCents: Math.round(cents / dias),
    untilISO,
    commitments: compromissos,
  };
}

/** Data da próxima entrada de renda depois de hoje. */
export function nextIncomeDate(events, fromISO) {
  const prox = events.find((e) => e.date > fromISO && e.kind === 'income');
  return prox ? prox.date : null;
}

export { minDate };
