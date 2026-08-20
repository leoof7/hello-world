// Histórico: tendência mês a mês e o dia a dia dentro de um mês.
//
// Custo mínimo e a projeção de caixa olham pra frente. Isto olha pra trás —
// responde "estou gastando mais ou menos que antes" e "em que dia do mês o
// dinheiro escorre mais".

import { monthKey, addMonthKey, parts, lastDayOfMonth } from './dates.js';

/** Gasto total por mês, dos últimos `months` meses (o corrente entra em aberto). */
export function monthlySpend(transactions, todayISO, { months = 6 } = {}) {
  const atual = monthKey(todayISO);
  const desde = addMonthKey(atual, -(months - 1));
  const porMes = new Map();

  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    const comp = t.competence || monthKey(t.date);
    if (comp < desde || comp > atual) continue;
    porMes.set(comp, (porMes.get(comp) || 0) + Math.abs(t.amountCents));
  }

  const lista = [];
  let cursor = desde;
  while (cursor <= atual) {
    lista.push({ month: cursor, cents: porMes.get(cursor) || 0, aberto: cursor === atual });
    cursor = addMonthKey(cursor, 1);
  }
  return lista;
}

/** Saldo líquido de cada dia de um mês — positivo entrou mais, negativo saiu mais. */
export function dailyNet(transactions, monthKeyStr) {
  const [y, m] = monthKeyStr.split('-').map(Number);
  const dias = lastDayOfMonth(y, m);
  const porDia = new Map();

  for (const t of transactions) {
    const comp = t.competence || monthKey(t.date);
    if (comp !== monthKeyStr) continue;
    const dia = parts(t.date).d;
    porDia.set(dia, (porDia.get(dia) || 0) + t.amountCents);
  }

  // dia da semana do dia 1, pro calendário alinhar sob o cabeçalho certo
  const primeiroDiaSemana = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

  const lista = [];
  for (let d = 1; d <= dias; d++) lista.push({ day: d, cents: porDia.get(d) || 0 });
  return { dias: lista, primeiroDiaSemana };
}

/** O dia que mais gastou dentro do mês — o que a pessoa quer ver de cara. */
export function worstDay(diasDoMes) {
  const gastos = diasDoMes.filter((d) => d.cents < 0);
  if (!gastos.length) return null;
  return gastos.reduce((pior, d) => (d.cents < pior.cents ? d : pior));
}
