// Quanto rende, e quando chega.
//
// Sem rendimento, "faltam R$ 5.000 guardando R$ 500" é uma divisão: dez meses.
// Com rendimento, o próprio dinheiro trabalha e o prazo encurta — ignorar isso
// faz o app prometer uma data pior que a real, e a pessoa desistir de uma meta
// que já estava mais perto do que parecia.
//
// A taxa é MENSAL, como a das dívidas. Misturar taxa ao ano num campo e ao mês
// noutro é como se erra por um fator de doze sem ninguém perceber.

/** O que este saldo rende num mês, em reais. */
export function monthlyYield(balanceCents, monthlyRate = 0) {
  if (!balanceCents || monthlyRate <= 0) return 0;
  return Math.round(balanceCents * monthlyRate);
}

/**
 * Em quantos meses a meta é alcançada.
 *
 * Mês a mês em vez de fórmula fechada: a fórmula de valor futuro de uma
 * anuidade é curta de escrever e comprida de depurar, e aqui o laço diz
 * exatamente o que acontece — rende, deposita, confere.
 *
 * Devolve 0 se já chegou, e null quando não chega nunca (sem aporte e sem
 * rendimento, ou tão devagar que passa de cinquenta anos).
 */
export function monthsToGoal({ savedCents = 0, monthlyCents = 0, targetCents = 0, monthlyRate = 0, maxMonths = 600 } = {}) {
  if (targetCents <= 0) return null;
  if (savedCents >= targetCents) return 0;
  if (monthlyCents <= 0 && monthlyRate <= 0) return null;

  let saldo = savedCents;
  for (let mes = 1; mes <= maxMonths; mes++) {
    saldo = Math.round(saldo * (1 + monthlyRate)) + monthlyCents;
    if (saldo >= targetCents) return mes;
  }
  return null;
}

/**
 * Quanto uma meta rende junto até ser atingida — o que o dinheiro fez sozinho.
 * Serve para mostrar que guardar num lugar que rende chega antes.
 */
export function goalProjection({ savedCents = 0, monthlyCents = 0, targetCents = 0, monthlyRate = 0 } = {}) {
  const meses = monthsToGoal({ savedCents, monthlyCents, targetCents, monthlyRate });
  if (meses === null) return { months: null, depositedCents: 0, yieldCents: 0 };

  const depositado = monthlyCents * meses;
  let saldo = savedCents;
  for (let m = 0; m < meses; m++) saldo = Math.round(saldo * (1 + monthlyRate)) + monthlyCents;

  return {
    months: meses,
    depositedCents: depositado,
    yieldCents: Math.max(0, saldo - savedCents - depositado),
    finalCents: saldo,
  };
}
