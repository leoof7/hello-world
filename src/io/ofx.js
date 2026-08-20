// OFX — o formato de extrato que os bancos brasileiros oferecem no
// "exportar para o gerenciador financeiro". É melhor que CSV: traz o sinal
// certo, um identificador único por lançamento e a data sem ambiguidade.
//
// O arquivo é SGML, não XML: muitas tags não fecham. Por isso o parser aqui é
// por expressão regular, e não por DOMParser — que engasga na primeira tag
// aberta sem par.

import { monthKey } from '../core/dates.js';

const campo = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}>([^<\r\n]*)`, 'i'));
  return m ? m[1].trim() : '';
};

/** AAAAMMDD[HHMMSS] → AAAA-MM-DD */
export function ofxDate(raw) {
  const s = String(raw || '').replace(/\[.*$/, '').trim();
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function isOFX(text) {
  return /<OFX>|OFXHEADER/i.test(text);
}

/**
 * OFX → lançamentos do Zero.
 * `fitid` vira parte do id, então reimportar o mesmo arquivo não duplica nada.
 */
export function toTransactions(text, { cardId = null, accountId = null } = {}) {
  const blocos = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const out = [];
  const problemas = [];

  blocos.forEach((bloco, i) => {
    const data = ofxDate(campo(bloco, 'DTPOSTED'));
    const bruto = campo(bloco, 'TRNAMT').replace(/\./g, '.').replace(',', '.');
    const valor = Number(bruto);
    const memo = campo(bloco, 'MEMO') || campo(bloco, 'NAME') || 'Lançamento importado';
    const fitid = campo(bloco, 'FITID') || String(i);

    if (!data || !Number.isFinite(valor)) {
      problemas.push({ linha: i + 1, motivo: 'lançamento sem data ou valor' });
      return;
    }

    out.push({
      id: `ofx-${fitid}`,
      date: data,
      competence: monthKey(data),
      description: memo,
      amountCents: Math.round(valor * 100),
      cardId,
      accountId,
      method: cardId ? 'credit' : null,
      imported: true,
    });
  });

  const saldo = text.match(/<BALAMT>([^<\r\n]*)/i);
  return {
    transactions: out,
    problemas,
    balanceCents: saldo ? Math.round(Number(saldo[1].replace(',', '.')) * 100) : null,
  };
}
