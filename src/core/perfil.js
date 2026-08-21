// Que fase você está vivendo com o seu dinheiro.
//
// Não é personalidade nem signo: é o retrato de uma SITUAÇÃO, e situação muda.
// Por isso ele se recalcula sozinho — a graça é ver o rótulo mudar porque a
// dívida caiu, não porque você respondeu bonito num questionário.
//
// Um quiz sozinho não serviria: as pessoas respondem como gostariam de ser.
// Ele existe só como chute inicial, enquanto não há comportamento para ler, e
// é substituído no instante em que houver.

/**
 * As fases, da mais apertada para a mais folgada. A ordem importa: a primeira
 * que bater é a resposta, porque quem está apagando incêndio não se beneficia
 * de ouvir que também poderia investir melhor.
 */
export const FASES = {
  INCENDIO: {
    id: 'incendio',
    nome: 'Apagando incêndio',
    texto: 'Juro caro corroendo o mês. Aqui só existe uma prioridade: parar a sangria.',
    foco: 'Ataque a dívida mais cara primeiro. Cada dia parado custa dinheiro.',
    cor: 'red',
  },
  APERTO: {
    id: 'aperto',
    nome: 'No aperto',
    texto: 'Fecha o mês, mas sem folga — qualquer imprevisto vira dívida nova.',
    foco: 'Um mês de reserva muda tudo: é o que impede o próximo susto de virar rotativo.',
    cor: 'amber',
  },
  RESPIRANDO: {
    id: 'respirando',
    nome: 'Respirando',
    texto: 'Sobra alguma coisa e você já tem um colchão para o primeiro tombo.',
    foco: 'Levar a reserva até três meses antes de pensar em qualquer outra coisa.',
    cor: 'blue',
  },
  CONSTRUINDO: {
    id: 'construindo',
    nome: 'Construindo',
    texto: 'Reserva de pé e sem dívida cara. O dinheiro começa a trabalhar para você.',
    foco: 'Reserva completa e aporte constante. Agora o tempo joga a seu favor.',
    cor: 'jade',
  },
  LIVRE: {
    id: 'livre',
    nome: 'Livre',
    texto: 'Sem dívida e com seis meses de reserva. Você comprou a sua tranquilidade.',
    foco: 'Manter, e decidir com calma o que fazer com o que sobra.',
    cor: 'violet',
  },
};

/**
 * Lê a fase a partir do comportamento.
 *
 * `confianca` diz o quanto dá para levar a sério: sem histórico, o app prefere
 * admitir que ainda não conhece a pessoa a cravar um rótulo com base em nada.
 */
export function perfilPorComportamento({
  dividaTotalCents = 0,
  jurosMesCents = 0,
  rendaMensalCents = 0,
  reservaMeses = 0,
  sobraCents = 0,
  mesesDeHistorico = 0,
} = {}) {
  const semDado = rendaMensalCents <= 0 && dividaTotalCents <= 0 && reservaMeses <= 0;
  if (semDado) return { fase: null, confianca: 0, motivo: 'ainda não conheço seus números' };

  const pesoDoJuro = rendaMensalCents > 0 ? jurosMesCents / rendaMensalCents : 0;
  const confianca = mesesDeHistorico >= 3 ? 1 : mesesDeHistorico >= 1 ? 0.6 : 0.3;

  // Juro comendo mais de 5% da renda é incêndio, independente do resto.
  if (dividaTotalCents > 0 && pesoDoJuro >= 0.05) {
    return { fase: FASES.INCENDIO, confianca, motivo: `juros consomem ${Math.round(pesoDoJuro * 100)}% da sua renda` };
  }

  if (dividaTotalCents > 0 && reservaMeses < 1) {
    return { fase: FASES.APERTO, confianca, motivo: 'tem dívida e ainda não tem reserva' };
  }

  if (reservaMeses < 1) {
    return { fase: FASES.APERTO, confianca, motivo: 'menos de um mês de reserva' };
  }

  if (dividaTotalCents === 0 && reservaMeses >= 6) {
    return { fase: FASES.LIVRE, confianca, motivo: 'sem dívida e com seis meses de reserva' };
  }

  if (reservaMeses >= 3 && pesoDoJuro < 0.02) {
    return { fase: FASES.CONSTRUINDO, confianca, motivo: `${reservaMeses.toFixed(1)} meses de reserva e sem juro caro` };
  }

  return {
    fase: FASES.RESPIRANDO,
    confianca,
    motivo: sobraCents > 0 ? 'sobra dinheiro no mês e já existe um colchão' : 'tem reserva, mas o mês fecha justo',
  };
}

/**
 * As três perguntas do começo. Existem só para o app não abrir mudo — cada uma
 * mapeia para um número que ele depois vai medir sozinho.
 */
export const QUIZ = [
  {
    id: 'divida',
    pergunta: 'Hoje você tem dívida com juros?',
    opcoes: [
      { valor: 'muita', label: 'Sim, e me aperta', fase: 'incendio' },
      { valor: 'pouca', label: 'Um pouco, sob controle', fase: 'aperto' },
      { valor: 'nenhuma', label: 'Nenhuma', fase: 'respirando' },
    ],
  },
  {
    id: 'reserva',
    pergunta: 'Se a renda parasse hoje, quanto tempo você aguentaria?',
    opcoes: [
      { valor: 'nada', label: 'Menos de um mês', fase: 'aperto' },
      { valor: 'pouco', label: 'Um a três meses', fase: 'respirando' },
      { valor: 'muito', label: 'Mais de três meses', fase: 'construindo' },
    ],
  },
  {
    id: 'sobra',
    pergunta: 'No fim do mês, normalmente:',
    opcoes: [
      { valor: 'falta', label: 'Falta dinheiro', fase: 'aperto' },
      { valor: 'zera', label: 'Fica no zero a zero', fase: 'respirando' },
      { valor: 'sobra', label: 'Sobra e eu guardo', fase: 'construindo' },
    ],
  },
];

/** Traduz as respostas do quiz na fase mais apertada que elas indicam. */
export function perfilPorQuiz(respostas = {}) {
  const ordem = ['incendio', 'aperto', 'respirando', 'construindo', 'livre'];
  let pior = null;

  for (const pergunta of QUIZ) {
    const escolha = pergunta.opcoes.find((o) => o.valor === respostas[pergunta.id]);
    if (!escolha) continue;
    if (pior === null || ordem.indexOf(escolha.fase) < ordem.indexOf(pior)) pior = escolha.fase;
  }

  if (!pior) return { fase: null, confianca: 0, motivo: 'quiz não respondido' };
  const fase = Object.values(FASES).find((f) => f.id === pior);
  return { fase, confianca: 0.4, motivo: 'pelo que você respondeu no começo', origem: 'quiz' };
}

/**
 * O perfil que a tela mostra: comportamento manda, quiz só cobre o vazio.
 * Assim o rótulo deixa de ser opinião no instante em que existe fato.
 */
export function perfilAtual({ comportamento, quizRespostas }) {
  const real = perfilPorComportamento(comportamento || {});
  if (real.fase) return { ...real, origem: 'comportamento' };
  return perfilPorQuiz(quizRespostas || {});
}
