// O que o app tem para te dizer sem você perguntar.
//
// Regra que vale para tudo aqui: só fala quando tem o que dizer, e sempre com
// o número que sustenta a frase. Aviso sem número vira barulho, e app que faz
// barulho é app que a pessoa silencia — e um app silenciado não avisa nem
// quando importa.
//
// Nada disto vai para servidor nenhum: é conta feita sobre o que já está no
// aparelho.

import { sum } from './money.js';
import { monthKey, addMonthKey, daysBetween } from './dates.js';

/**
 * Você contra você mesmo: o mês corrente comparado com a sua própria média.
 *
 * Comparar com "a média dos brasileiros" não ajuda ninguém — cada vida tem um
 * custo. Comparar com os seus últimos meses ajuda, porque a diferença é sua e
 * a causa também.
 *
 * O mês corrente é PARCIAL: comparar 10 dias contra meses inteiros acusaria
 * economia que não existe. Por isso a média vira proporcional aos dias já
 * corridos, e a comparação só existe depois de dois meses fechados.
 */
export function versusMedia(transactions, categories, todayISO, { months = 3, diaDoMes = null } = {}) {
  const atual = monthKey(todayISO);
  const desde = addMonthKey(atual, -months);
  const dia = diaDoMes || Number(todayISO.slice(8, 10));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const porMesCategoria = new Map();
  const mesesFechados = new Set();

  for (const t of transactions) {
    if (t.amountCents >= 0 || !t.categoryId) continue;
    if (catById[t.categoryId]?.neutra) continue;
    const comp = t.competence || monthKey(t.date);
    if (comp < desde || comp > atual) continue;
    if (comp !== atual) mesesFechados.add(comp);

    const chave = `${comp}|${t.categoryId}`;
    porMesCategoria.set(chave, (porMesCategoria.get(chave) || 0) + Math.abs(t.amountCents));
  }

  if (mesesFechados.size < 2) return [];

  const achados = [];
  for (const cat of categories) {
    if (cat.fixed || cat.neutra) continue; // fixo não varia; neutro não é gasto

    const anteriores = [...mesesFechados].map((mes) => porMesCategoria.get(`${mes}|${cat.id}`) || 0);
    const media = Math.round(sum(anteriores) / anteriores.length);
    if (media <= 0) continue;

    const gastoAtual = porMesCategoria.get(`${atual}|${cat.id}`) || 0;
    // proporcional: no dia 10 de um mês de 30, já deveria ter gasto um terço
    const esperado = Math.round((media * dia) / 30);
    if (esperado <= 0) continue;

    const variacao = (gastoAtual - esperado) / esperado;
    if (Math.abs(variacao) < 0.25) continue; // ruído não é notícia

    achados.push({
      categoryId: cat.id,
      name: cat.name,
      spentCents: gastoAtual,
      expectedCents: esperado,
      averageCents: media,
      ratio: variacao,
      direction: variacao > 0 ? 'acima' : 'abaixo',
    });
  }

  return achados.sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio));
}

/**
 * O que um hábito custa de verdade.
 *
 * R$ 400 por mês não assusta ninguém. R$ 4.800 por ano assusta. E "três meses
 * da sua reserva" assusta mais ainda, porque troca dinheiro por tempo — que é
 * o que a pessoa realmente está gastando.
 */
export function custoDoHabito(monthlyCents, { minimumCostCents = 0 } = {}) {
  const anual = monthlyCents * 12;
  const mesesDeReserva = minimumCostCents > 0 ? anual / minimumCostCents : null;
  return {
    monthlyCents,
    yearlyCents: anual,
    reserveMonths: mesesDeReserva,
  };
}

/**
 * "Posso comprar isso?" — a pergunta que o app tem dado para responder e não
 * respondia.
 *
 * Devolve o veredito de cada forma de pagamento, com o motivo. Não é conselho
 * moral: é aritmética sobre a projeção que já existe.
 */
export function podeComprar({
  valorCents,
  parcelas = 1,
  projecao,
  cartao = null,
  saldoCents = 0,
  reservaCents = 0,
  todayISO,
}) {
  const parcela = Math.ceil(valorCents / Math.max(1, parcelas));

  // À vista sai do saldo hoje; a projeção diz o que acontece depois.
  const piorDepois = projecao?.min?.cents ?? 0;
  const sobraAVista = saldoCents - valorCents;
  const projecaoAVista = piorDepois - valorCents;

  const cabeNoLimite = !cartao || !cartao.limitCents || valorCents <= cartao.availableCents;

  const motivos = [];
  if (sobraAVista < 0) motivos.push(`à vista não cabe: você tem ${saldoCents} e a compra é ${valorCents}`);
  if (projecaoAVista < 0) motivos.push('à vista te deixa negativo antes da próxima entrada');
  if (!cabeNoLimite) motivos.push(`passa do limite do ${cartao.name}`);

  return {
    parcelaCents: parcela,
    aVista: {
      cabe: sobraAVista >= 0 && projecaoAVista >= 0,
      saldoDepoisCents: sobraAVista,
      piorDiaDepoisCents: projecaoAVista,
    },
    parcelado: {
      cabe: cabeNoLimite,
      parcelaCents: parcela,
      disponivelCents: cartao?.availableCents ?? null,
    },
    comprometeReserva: reservaCents > 0 && valorCents > reservaCents,
    motivos,
    todayISO,
  };
}

/**
 * Marcos que merecem ser comemorados — os de verdade.
 *
 * Nada de ponto por abrir o app: isso premia hábito vazio e envelhece mal num
 * app de dinheiro. Aqui só entra o que mudou a vida da pessoa de fato, e cada
 * um só é dado uma vez (o chamador guarda os já comemorados).
 */
export function marcos({ dividaTotalCents, dividaPicoCents, reservaMeses, faturasPagas = 0, categorizados = 0 }) {
  const lista = [];

  if (dividaPicoCents > 0 && dividaTotalCents === 0) {
    lista.push({ id: 'livre-divida', titulo: 'Livre de dívidas', texto: 'Nenhuma dívida cadastrada. Você saiu.' });
  } else if (dividaPicoCents > 0) {
    const pago = 1 - dividaTotalCents / dividaPicoCents;
    if (pago >= 0.5) lista.push({ id: 'metade-divida', titulo: 'Metade do caminho', texto: 'Você já pagou mais da metade do que devia no pior momento.' });
    if (pago >= 0.25 && pago < 0.5) lista.push({ id: 'quarto-divida', titulo: 'Um quarto pago', texto: 'A dívida já é 25% menor que no pico.' });
  }

  if (reservaMeses >= 1) lista.push({ id: 'reserva-1', titulo: 'Um mês de reserva', texto: 'Você aguenta um mês sem renda. O primeiro é o mais difícil.' });
  if (reservaMeses >= 3) lista.push({ id: 'reserva-3', titulo: 'Três meses de reserva', texto: 'Aqui um imprevisto deixa de virar dívida.' });
  if (reservaMeses >= 6) lista.push({ id: 'reserva-6', titulo: 'Seis meses de reserva', texto: 'Reserva completa. Poucos brasileiros chegam aqui.' });

  if (faturasPagas >= 1) lista.push({ id: 'fatura-1', titulo: 'Fatura em dia', texto: 'Pagou a fatura sem entrar no rotativo.' });
  if (categorizados >= 50) lista.push({ id: 'ensinou-50', titulo: 'O Zé já te conhece', texto: '50 lançamentos categorizados — ele erra cada vez menos.' });

  return lista;
}

/**
 * O que vale um toque no ombro hoje, em ordem de urgência.
 *
 * Devolve no máximo `limite` avisos: notificação demais é notificação
 * desligada, e aí a que importava também não chega.
 */
export function avisosDoDia({
  projecao,
  faturas = [],
  vazamentos = { findings: [] },
  revisaoCount = 0,
  backupDiasSem = null,
  todayISO,
  limite = 3,
}) {
  const avisos = [];

  const furo = projecao?.firstNegative;
  if (furo) {
    const dias = daysBetween(todayISO, furo.date);
    if (dias >= 0 && dias <= 10) {
      avisos.push({
        id: `caixa-${furo.date}`,
        urgencia: 100 - dias,
        titulo: dias === 0 ? 'Sua conta fica negativa hoje' : `Sua conta fica negativa em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
        texto: `Faltam ${Math.abs(furo.cents)} nesse dia. Dá para adiar, antecipar entrada ou cortar agora.`,
        tela: 'analise',
      });
    }
  }

  for (const f of faturas) {
    const dias = daysBetween(todayISO, f.dueDate);
    if (dias < 0 || dias > 3) continue;
    avisos.push({
      id: `fatura-${f.cardId}-${f.cycleId}`,
      urgencia: 90 - dias,
      titulo: dias === 0 ? `Fatura do ${f.cardName} vence hoje` : `Fatura do ${f.cardName} vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
      texto: `${f.totalCents} a pagar. Entrar no rotativo é o juro mais caro que existe.`,
      tela: 'faturas',
    });
  }

  for (const f of (vazamentos.findings || []).slice(0, 2)) {
    avisos.push({
      id: `vazamento-${f.type}-${f.name}`,
      urgencia: 60,
      titulo: f.type === 'duplicada' ? `${f.name} cobrou duas vezes` : `${f.name} aumentou de preço`,
      texto: `${f.yearlyCents} por ano se continuar assim.`,
      tela: 'analise',
    });
  }

  if (revisaoCount >= 10) {
    avisos.push({
      id: `revisao-${revisaoCount}`,
      urgencia: 40,
      titulo: `${revisaoCount} lançamentos esperando`,
      texto: 'Dois minutos de revisão e os números do mês voltam a ser verdade.',
      tela: 'revisao',
    });
  }

  if (backupDiasSem !== null && backupDiasSem >= 30) {
    avisos.push({
      id: `backup-${Math.floor(backupDiasSem / 30)}`,
      urgencia: 30,
      titulo: `${backupDiasSem} dias sem backup`,
      texto: 'Sem servidor, o backup é a sua única cópia.',
      tela: 'tudo',
    });
  }

  return avisos.sort((a, b) => b.urgencia - a.urgencia).slice(0, limite);
}
