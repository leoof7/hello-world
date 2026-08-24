// Notificação de banco vira lançamento.
//
// A entrada aqui é texto cru saído do OCR de um print da central de
// notificações. A saída é uma lista de lançamentos candidatos — candidatos,
// nunca lançados: nada de dinheiro entra no documento sem alguém confirmar.
//
// Por que um arquivo separado de `parse.js`: são idiomas diferentes. O
// `parse.js` entende gente falando ("gastei 50 no mercado ontem"), com tudo
// que isso tem de solto. Notificação de banco é máquina falando com gente, e
// é formulaica ao ponto de caber em meia dúzia de padrões. Misturar os dois
// pioraria os dois: o interpretador de fala ficaria cheio de casos de borda de
// banco, e o de banco herdaria a tolerância que ali é virtude e aqui é erro.
//
// O que este arquivo NÃO faz, de propósito:
//
//   - não decide a data. Print de notificação quase nunca traz o dia — traz
//     "há 2 h". Quem chama passa o dia de hoje, e a tela deixa corrigir.
//   - não inventa categoria. Isso é do `categorize.js`, que aprende com o que
//     a pessoa já classificou.
//   - não desempata cartão por nome de banco. Faz melhor: usa os quatro
//     dígitos finais, que vêm em quase toda notificação de compra.

import { toCents } from './money.js';

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase();

/**
 * Linhas que são ruído de sistema operacional, não notificação de banco.
 *
 * Print de central de notificações vem com relógio, data por extenso, nome de
 * operadora, "Central de Notificações", "Limpar tudo". Sem essa varrida, o
 * "12:45" do relógio vira um lançamento de R$ 12,45 — e um app que inventa
 * gasto é pior que um app que perde gasto.
 */
const RUIDO = [
  /^\s*\d{1,2}:\d{2}\s*$/,                      // relógio
  /^\s*(seg|ter|qua|qui|sex|sab|dom)[a-z]*[,.]/i,
  /central de notificac/i,
  /limpar tudo|apagar tudo|mostrar menos|mostrar mais/i,
  /^\s*(agora|ha \d+ ?(min|h|d)|\d+ ?(min|h|d) atras)\s*$/i,
  /^\s*[|\-—_·.]+\s*$/,
  /vivo|claro|tim|oi\b|wi-?fi|bateria/i,
];

/**
 * Os padrões de notificação dos bancos brasileiros.
 *
 * Cada um diz se é entrada ou saída. A ordem importa: o primeiro que casar
 * ganha, então os mais específicos vêm antes. "Pix enviado" tem que ser
 * testado antes de "pix", senão todo Pix vira entrada.
 *
 * Os textos vêm do que os apps realmente mandam — Nubank, Itaú, Bradesco, C6,
 * Inter, PicPay, Mercado Pago. Não é lista fechada: o que não casar com nada
 * ainda cai no `parse.js`, que é mais solto.
 */
const PADROES = [
  // ---- saídas
  { re: /compra (?:aprovada|autorizada|realizada)/i, direcao: 'out' },
  { re: /compra no (?:debito|credito)/i, direcao: 'out' },
  { re: /pix (?:enviado|realizado|efetuado)/i, direcao: 'out' },
  { re: /voce (?:enviou|pagou|transferiu)/i, direcao: 'out' },
  { re: /pagamento (?:de conta|aprovado|realizado|efetuado)/i, direcao: 'out' },
  { re: /(?:boleto|fatura|conta) paga/i, direcao: 'out' },
  { re: /saque (?:aprovado|realizado)/i, direcao: 'out' },
  { re: /debito automatico/i, direcao: 'out' },
  { re: /assinatura (?:renovada|cobrada)/i, direcao: 'out' },

  // ---- entradas
  { re: /pix recebido/i, direcao: 'in' },
  { re: /voce recebeu/i, direcao: 'in' },
  { re: /(?:transferencia|deposito|ted|doc) recebid[ao]/i, direcao: 'in' },
  { re: /(?:salario|pagamento) (?:caiu|creditado|recebido)/i, direcao: 'in' },
  { re: /estorno|reembolso|devolucao/i, direcao: 'in' },
  { re: /(?:credito|valor) na sua conta/i, direcao: 'in' },
];

/** Palavras que aparecem coladas no estabelecimento e não fazem parte dele. */
const SOBRAS = /\b(no seu cartao|no cartao|com final|final|cartao|credito|debito|em ate|parcelas?|x de|aprovada|aprovado|realizada|realizado|voce|para|de|em|no|na)\b/gi;

/**
 * Quebra o texto do print em linhas de notificação.
 *
 * Uma notificação costuma vir em duas linhas — título ("Compra aprovada") e
 * corpo ("R$ 45,90 em PADARIA CENTRAL"). O OCR entrega as duas separadas, e
 * ler cada uma por si perderia metade da informação de cada notificação.
 * Então linhas que não têm valor são coladas na seguinte, que tem.
 */
export function linhasDeNotificacao(texto) {
  const cruas = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2)
    .filter((l) => !RUIDO.some((r) => r.test(l)));

  const saida = [];
  let pendente = '';

  for (const linha of cruas) {
    const temValor = /r\$\s*\d|\d+,\d{2}/i.test(linha);
    if (temValor) {
      saida.push(pendente ? `${pendente} ${linha}` : linha);
      pendente = '';
    } else {
      // Guarda no máximo uma linha de título. Duas seguidas sem valor quer
      // dizer que a primeira não era título de nada.
      pendente = linha;
    }
  }
  return saida;
}

/** O valor em centavos de uma linha de notificação. Null quando não há. */
export function valorDaLinha(linha) {
  const t = String(linha || '');

  // Só o formato com centavos, e sempre precedido de R$ ou do padrão 0,00.
  // Aceitar inteiro solto aqui — como o parse.js faz para fala humana — leria
  // o "1234" de "cartão final 1234" como R$ 1.234,00.
  const m = t.match(/r\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i)
    || t.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
  if (!m) return null;

  const cents = toCents(m[1]);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/**
 * Os quatro dígitos finais do cartão.
 *
 * É o dado mais valioso da notificação e o mais fácil de perder: com ele o
 * lançamento vai para o cartão certo sozinho, sem a pessoa escolher nada. Sem
 * ele, todo gasto cai no primeiro cartão da lista e ela corrige um por um.
 */
export function finalDoCartao(linha) {
  const m = String(linha || '').match(/(?:final|term(?:ina|inado)?(?: em)?|\bn[o°º]?\.?)\s*[:\-]?\s*(\d{4})\b/i);
  return m ? m[1] : null;
}

/**
 * Entrada ou saída. Saída é o padrão: notificação de banco quase sempre é gasto.
 *
 * A comparação é com o texto SEM acento. Os padrões são escritos sem acento de
 * propósito — assim "Transferência recebida" e "Transferencia recebida" caem no
 * mesmo lugar, e o OCR, que come acento com frequência, não muda o sinal do
 * dinheiro. Trocar entrada por saída é o erro mais caro que este arquivo pode
 * cometer: erra o valor em dobro e para o lado errado.
 */
export function direcaoDaLinha(linha) {
  const t = norm(linha);
  const achado = PADROES.find((p) => p.re.test(t));
  return achado ? achado.direcao : 'out';
}

/** Quantas parcelas, quando a notificação diz "em 3x" ou "3 parcelas". */
export function parcelasDaLinha(linha) {
  const t = norm(linha);
  const m = t.match(/(?:em\s*)?(\d{1,2})\s*(?:x\b|parcelas?|vezes)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return n >= 2 && n <= 48 ? n : 1;
}

/**
 * O nome do estabelecimento.
 *
 * Sai do que vem depois de "em" / "para" / "no", que é onde todo banco põe.
 * Quando não dá para isolar, devolve null em vez de chutar: descrição errada
 * é pior que descrição vazia, porque o `categorize.js` aprende com ela e passa
 * a errar sozinho nas próximas.
 */
export function estabelecimentoDaLinha(linha) {
  const t = String(linha || '');

  // depois do valor: "R$ 45,90 em PADARIA CENTRAL"
  const depoisDoValor = t.match(/r\$\s*[\d.,]+\s+(?:em|no|na|para|de)\s+(.+)$/i)
    || t.match(/\b\d+,\d{2}\s+(?:em|no|na|para|de)\s+(.+)$/);
  let bruto = depoisDoValor?.[1];

  // antes do valor: "PADARIA CENTRAL - R$ 45,90"
  if (!bruto) {
    const antesDoValor = t.match(/^(.+?)\s*[-–—:]\s*r\$/i);
    bruto = antesDoValor?.[1];
  }

  if (!bruto) return null;

  const limpo = bruto
    .replace(/\bhá?\s*\d+\s*(min|h|d|hora|horas|dia|dias)\b.*/i, '')
    .replace(/\b\d{1,2}[:/]\d{2}\b.*/, '')
    .replace(/\b(?:com\s+)?final\s*\d{4}\b/gi, '')
    .replace(/\bem\s+\d{1,2}\s*x\b/gi, '')
    .replace(/[|·•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:\-–—]+$/, '');

  if (limpo.length < 2) return null;
  // Uma linha inteira de sobra ("no seu cartão de crédito") não é nome de
  // lugar nenhum.
  if (!limpo.replace(SOBRAS, '').replace(/\s+/g, '')) return null;

  return bonito(limpo);
}

/** "PADARIA CENTRAL LTDA" → "Padaria Central". Caixa alta grita na lista. */
function bonito(nome) {
  const semRuidoDeCnpj = nome
    .replace(/\b(ltda|me|epp|eireli|s\/?a|comercio|com|servicos)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = semRuidoDeCnpj.length >= 3 ? semRuidoDeCnpj : nome;

  if (base !== base.toUpperCase()) return base;
  // Só os conectores ficam minúsculos. A regra antiga era "palavra de até
  // duas letras", que resolvia o "do" e estragava o nome: MERCADO DO ZE
  // virava "Mercado do ze".
  const CONECTORES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na']);
  return base
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && CONECTORES.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/**
 * O print inteiro vira lançamentos candidatos.
 *
 * `cards` serve para casar os quatro dígitos finais. Cada candidato traz
 * `confianca`, que a tela usa para decidir o que já vem marcado: linha com
 * valor, estabelecimento e cartão identificado é quase certeza; linha com só
 * um valor solto precisa de olho humano.
 */
export function lancamentosDoPrint(texto, { cards = [], todayISO } = {}) {
  const porFinal = new Map();
  for (const c of cards) {
    const f = String(c.last4 || '').trim();
    if (/^\d{4}$/.test(f)) porFinal.set(f, c);
  }

  const saida = [];
  for (const linha of linhasDeNotificacao(texto)) {
    const valorCents = valorDaLinha(linha);
    if (!valorCents) continue;

    const direcao = direcaoDaLinha(linha);
    const final = finalDoCartao(linha);
    const cartao = final ? porFinal.get(final) : null;
    const descricao = estabelecimentoDaLinha(linha);
    const parcelas = parcelasDaLinha(linha);

    // Quanto o app confia nisto. Cada peça que ele conseguiu isolar sozinho
    // vale um ponto; a tela marca por padrão só o que passa de 0,6.
    let confianca = 0.35;
    if (PADROES.some((p) => p.re.test(norm(linha)))) confianca += 0.3;
    if (descricao) confianca += 0.2;
    if (cartao) confianca += 0.15;

    saida.push({
      linha,
      amountCents: direcao === 'in' ? valorCents : -valorCents,
      description: descricao,
      date: todayISO,
      cardId: cartao?.id || null,
      accountId: cartao ? null : null,
      installments: parcelas,
      final,
      confianca: Math.min(1, confianca),
    });
  }
  return saida;
}

/**
 * Este lançamento já existe?
 *
 * O mesmo gasto chega duas vezes com facilidade: pela notificação hoje e pelo
 * extrato OFX no fim do mês, ou por dois prints da mesma tela. Duplicar gasto
 * é pior que perder: o app passa a acusar um rombo que não existe e a pessoa
 * perde a confiança no número.
 *
 * O critério é valor exato mais proximidade de data — três dias, porque a
 * notificação chega na hora da compra e o extrato só lança quando processa.
 * Estabelecimento não entra: o OCR erra letra, o extrato abrevia, e exigir que
 * os dois batam deixaria passar quase toda duplicata de verdade.
 */
export function jaExiste(candidato, transactions = [], janelaDias = 3) {
  const dia = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  const alvo = dia(candidato.date);

  return transactions.some((t) => {
    if (t.amountCents !== candidato.amountCents) return false;
    const d = dia(t.date);
    return Number.isFinite(d) && Math.abs(d - alvo) <= janelaDias;
  });
}
