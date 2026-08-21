// O cadastro em forma de conversa.
//
// Por que existe: formulário com quinze campos é onde a pessoa desiste. Não
// porque digitar é difícil, mas porque ver quinze campos de uma vez cansa
// antes do primeiro.
//
// Por que NÃO é um chat livre: este app não tem servidor nem modelo de
// linguagem. Tudo aqui é regra escrita à mão. Um chat que promete entender
// qualquer coisa e erra três vezes destrói a confiança no app inteiro — muito
// mais do que um formulário chato jamais destruiria. Formulário feio a pessoa
// xinga e preenche.
//
// Então o desenho é o inverso do que parece: quem dirige é o app. Ele pergunta
// UMA coisa por vez, e por saber o que perguntou, sabe o papel do que vier.
// "Fecha dia 20" só vira R$ 20,00 quando ninguém sabe que a pergunta era sobre
// cartão. Aqui cada pergunta tem seu próprio leitor.
//
// O que a pessoa ganha por falar demais: se ela responder "ganho 4700 e pago
// 1200 de aluguel", as duas coisas são guardadas e a pergunta do aluguel some
// mais para frente. Quanto mais ela conta, menos o app pergunta.
//
// O que fica de fora: cartão, dívida, cofrinho, teto e backup. O mínimo para o
// app não mentir são renda, uma conta com saldo e os gastos fixos — sem esses
// três a projeção e o custo de vida não existem. O resto vira aviso na hora em
// que faz falta, que é onde aviso funciona.

import { extractAmount, splitEntries, maskDates } from './parse.js';

const norm = (t) => String(t ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const NAO = ['nao', 'nenhum', 'nenhuma', 'zero', 'ainda nao', 'nada', 'pular', 'depois', 'n'];

/** A pessoa disse que não tem / não quer responder agora. */
export const dispensou = (texto) => {
  const t = norm(texto);
  return !t || NAO.some((n) => t === n || t.startsWith(`${n} `));
};

// --------------------------------------------------------------- leitores
//
// Um por pergunta. Cada um devolve { valor, eco } quando entendeu, ou null.
// `eco` é o que a tela mostra de volta para a pessoa confirmar ou corrigir.

/** Nome: a primeira palavra que pareça nome, sem o "meu nome é" na frente. */
export function lerNome(texto) {
  // O "é" acentuado precisa estar aqui: casar só com "e" fazia
  // "meu nome é Leandro" virar o nome "Meu".
  const limpo = String(texto ?? '')
    .replace(/^\s*(?:meu\s+nome\s+[eé]|me\s+chamo|eu\s+sou|sou|aqui\s+[eé])\s+/i, '')
    .replace(/^\s*(?:o|a)\s+/i, '') // "sou O João" — o artigo não é o nome
    .replace(/[.!,;]+$/, '')
    .trim();
  if (!limpo) return null;

  // Só o primeiro nome: "Leandro de Oliveira Felisberto" vira "Leandro".
  // O app cumprimenta, não emite documento.
  const primeiro = limpo.split(/\s+/)[0];
  if (primeiro.length < 2 || /\d/.test(primeiro)) return null;

  const nome = primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase();
  return { valor: nome, eco: nome };
}

/** Idade: um número entre 12 e 110. Fora disso não é idade, é outra coisa. */
export function lerIdade(texto) {
  const m = norm(texto).match(/\b(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 12 || n > 110) return null;
  return { valor: n, eco: `${n} anos` };
}

/**
 * Renda: o valor da frase.
 *
 * Aqui o app já sabe que o número é dinheiro que entra, então não precisa
 * adivinhar papel nenhum — que é exatamente o que um chat livre não teria.
 */
export function lerRenda(texto) {
  if (dispensou(texto)) return null;
  const cents = extractAmount(maskDates(texto));
  if (!cents || cents <= 0) return null;
  return { valor: cents, eco: cents };
}

/** Saldo da conta: aceita "tá zerada" como zero de verdade. */
export function lerSaldo(texto) {
  const t = norm(texto);
  if (/\b(zerad|zero|nada|no vermelho|negativ)/.test(t)) {
    const cents = extractAmount(maskDates(texto)) || 0;
    const negativo = /\b(no vermelho|negativ)/.test(t);
    return { valor: negativo ? -Math.abs(cents) : 0, eco: negativo ? -Math.abs(cents) : 0 };
  }
  const cents = extractAmount(maskDates(texto));
  if (cents === null) return null;
  return { valor: cents, eco: cents };
}

/**
 * Gastos fixos: uma frase vira vários.
 *
 * "aluguel 1200, luz 180, internet 120" tem que virar três registros. É a
 * pergunta que mais rende do roteiro inteiro — e a que mais justifica aceitar
 * texto solto em vez de um campo por conta.
 */
export function lerFixos(texto) {
  if (dispensou(texto)) return { valor: [], eco: 'nenhum por enquanto' };

  const partes = splitEntries(String(texto ?? ''));
  const itens = [];

  for (const parte of partes) {
    const cents = extractAmount(maskDates(parte));
    if (!cents || cents <= 0) continue;
    const nome = nomeDoFixo(parte);
    itens.push({ label: nome, amountCents: cents });
  }

  if (!itens.length) return null;
  return { valor: itens, eco: itens };
}

/** O que sobra da frase depois de tirar o valor vira o nome da conta. */
function nomeDoFixo(parte) {
  const limpo = String(parte)
    .replace(/(?:r\$\s*)?\d+(?:[.,]\d+)*\s*(?:mil|k|milhoes|milhões)?/gi, ' ')
    .replace(/\b(reais|real|conto|pila|por mes|por mês|todo mes|todo mês|de|do|da|pago|pagando|é|e)\b/gi, ' ')
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo) return 'Gasto fixo';
  return limpo[0].toUpperCase() + limpo.slice(1);
}

// ---------------------------------------------------------------- roteiro

export const PASSOS = [
  {
    id: 'nome',
    pergunta: 'Oi. Antes de tudo — como eu te chamo?',
    ajuda: 'Só o primeiro nome já basta.',
    placeholder: 'Leandro',
    ler: lerNome,
    tipo: 'texto',
    obrigatorio: false,
  },
  {
    id: 'idade',
    pergunta: (ctx) => `Prazer, ${ctx.nome || 'tudo bem'}. Quantos anos você tem?`,
    ajuda: 'Serve para eu calibrar o tamanho da reserva que faz sentido pra você.',
    placeholder: '34',
    ler: lerIdade,
    tipo: 'numero',
    obrigatorio: false,
  },
  {
    id: 'renda',
    pergunta: 'Quanto entra por mês, no total?',
    ajuda: 'Salário, pró-labore, aposentadoria — o que entra todo mês. Pode falar torto: "uns quatro mil e setecentos" eu entendo.',
    placeholder: 'ganho 4700 por mês',
    ler: lerRenda,
    tipo: 'dinheiro',
    obrigatorio: true,
    porQue: 'Sem isso não existe projeção nem "quanto sobra".',
  },
  {
    id: 'conta',
    pergunta: 'E quanto você tem na conta hoje?',
    ajuda: 'O saldo de agora, o que estiver no app do banco. Se estiver zerada, é só dizer.',
    placeholder: '21,73',
    ler: lerSaldo,
    tipo: 'dinheiro',
    obrigatorio: true,
    porQue: 'A projeção de caixa parte daqui — sem saldo ela começa do zero e não quer dizer nada.',
  },
  {
    id: 'fixos',
    pergunta: 'Quais contas saem todo mês?',
    ajuda: 'Pode listar tudo de uma vez: "aluguel 1200, luz 180, internet 120". Se não tiver nenhuma, diga não.',
    placeholder: 'aluguel 1200, luz 180, internet 120',
    ler: lerFixos,
    tipo: 'lista',
    obrigatorio: true,
    porQue: 'É o que sustenta o custo de vida mínimo. Sem isso ele fica em R$ 0 e o app diz que sobra mais do que sobra.',
  },
];

/** O passo atual: o primeiro que ainda não foi respondido. */
export function proximoPasso(respostas = {}) {
  return PASSOS.find((p) => !(p.id in respostas)) || null;
}

/** Quantos passos faltam — o número que a tela mostra para a pessoa se situar. */
export function quantosFaltam(respostas = {}) {
  return PASSOS.filter((p) => !(p.id in respostas)).length;
}

/** Já dá para o app funcionar sem mentir? */
export const completo = (respostas = {}) =>
  PASSOS.filter((p) => p.obrigatorio).every((p) => p.id in respostas);

/** O texto da pergunta, que pode depender do que já foi respondido. */
export const textoDaPergunta = (passo, ctx = {}) =>
  typeof passo.pergunta === 'function' ? passo.pergunta(ctx) : passo.pergunta;

/**
 * As respostas viram documento.
 *
 * Mora no núcleo, e não na tela, por dois motivos: aqui dá para testar sem
 * navegador, e é o único jeito de garantir que o chat grave EXATAMENTE nos
 * mesmos campos que os formulários. Um caminho paralelo de gravação é como
 * duas telas passam a discordar sobre o mesmo dinheiro.
 *
 * `novoId` entra por parâmetro para o teste poder prever os ids.
 */
export function aplicarConversa(doc, respostas = {}, { novoId = idPadrao } = {}) {
  const novo = { ...doc, profile: { ...doc.profile } };

  if (respostas.nome) novo.profile.name = respostas.nome;
  if (respostas.idade) novo.profile.idade = respostas.idade;

  novo.recurring = [...(doc.recurring || [])];
  novo.accounts = [...(doc.accounts || [])];

  if (respostas.renda > 0) {
    novo.recurring.push({
      id: novoId('rc'), label: 'Renda', kind: 'income',
      amountCents: respostas.renda, dayOfMonth: 5, every: 'mes', dayOfMonth2: null,
      categoryId: null, fixed: true,
    });
  }

  // `!= null` e não `> 0`: conta zerada é resposta legítima, e conta negativa
  // também. Só a ausência de resposta é que não vira conta.
  if (respostas.conta != null) {
    novo.accounts.push({
      id: novoId('ac'), name: 'Conta', type: 'checking',
      balanceCents: respostas.conta, monthlyRate: 0,
    });
  }

  for (const fixo of respostas.fixos || []) {
    novo.recurring.push({
      id: novoId('rc'), label: fixo.label, kind: 'expense',
      amountCents: -Math.abs(fixo.amountCents), dayOfMonth: 10, every: 'mes', dayOfMonth2: null,
      // Sem categoria de propósito. Chutar "moradia" para tudo que a pessoa
      // listou encheria o custo de vida mínimo de palpite, e esse é o número
      // que decide quanto sobra para pagar dívida. A Saúde já cobra os fixos
      // sem categoria — cobrar é mais honesto que adivinhar.
      categoryId: null, fixed: true,
    });
  }

  return novo;
}

const idPadrao = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
