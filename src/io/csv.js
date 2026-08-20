// CSV — o formato que todo banco brasileiro exporta e toda planilha lê.
//
// O parser aqui é o chato de propósito: separador pode ser vírgula ou ponto e
// vírgula (Excel em pt-BR usa ponto e vírgula), valor pode vir "1.234,56" ou
// "1234.56", e a data pode vir em quatro formatos. Errar isso é importar o
// extrato inteiro com o sinal trocado.

import { toCents } from '../core/money.js';
import { monthKey } from '../core/dates.js';

/** Descobre o separador olhando a primeira linha. */
export function detectDelimiter(text) {
  const linha = text.split(/\r?\n/).find((l) => l.trim());
  if (!linha) return ',';
  const ponto = (linha.match(/;/g) || []).length;
  const virgula = (linha.match(/,/g) || []).length;
  const tab = (linha.match(/\t/g) || []).length;
  if (tab > ponto && tab > virgula) return '\t';
  return ponto >= virgula ? ';' : ',';
}

/** Divide uma linha respeitando aspas. */
export function splitLine(line, delimiter) {
  const out = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (aspas && line[i + 1] === '"') { atual += '"'; i++; }
      else aspas = !aspas;
    } else if (c === delimiter && !aspas) {
      out.push(atual); atual = '';
    } else {
      atual += c;
    }
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

export function parseCSV(text) {
  const delimiter = detectDelimiter(text);
  const linhas = text.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { header: [], rows: [] };
  const header = splitLine(linhas[0], delimiter).map((h) => h.replace(/^﻿/, ''));
  const rows = linhas.slice(1).map((l) => splitLine(l, delimiter));
  return { header, rows, delimiter };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const COLUNAS = {
  date: ['data', 'date', 'data lancamento', 'data do lancamento', 'data da compra', 'data de compra'],
  description: ['descricao', 'description', 'historico', 'lancamento', 'estabelecimento', 'titulo', 'memo', 'detalhes'],
  amount: ['valor', 'amount', 'quantia', 'montante', 'valor (r$)', 'valor brl'],
  credit: ['credito', 'entrada', 'receita'],
  debit: ['debito', 'saida', 'despesa'],
};

/** Acha qual coluna é qual. Devolve índices ou -1. */
export function mapColumns(header) {
  const achar = (nomes) => header.findIndex((h) => nomes.includes(norm(h)));
  return {
    date: achar(COLUNAS.date),
    description: achar(COLUNAS.description),
    amount: achar(COLUNAS.amount),
    credit: achar(COLUNAS.credit),
    debit: achar(COLUNAS.debit),
  };
}

/** DD/MM/AAAA, DD-MM-AAAA, AAAA-MM-DD, DD/MM/AA → AAAA-MM-DD */
export function parseDate(raw) {
  const s = String(raw || '').trim();
  let mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mt) return `${mt[1]}-${mt[2]}-${mt[3]}`;
  mt = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!mt) return null;
  const [, d, m, a] = mt;
  const ano = a.length === 2 ? `20${a}` : a;
  return `${ano}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * CSV → lançamentos do Zero.
 *
 * `sign` diz o que fazer quando o arquivo só traz números positivos:
 *   'auto'    respeita o sinal do arquivo
 *   'expense' força tudo como saída (fatura de cartão costuma vir assim)
 */
export function toTransactions(text, { sign = 'auto', cardId = null, accountId = null, prefix = 'imp' } = {}) {
  const { header, rows } = parseCSV(text);
  const col = mapColumns(header);
  const out = [];
  const problemas = [];

  rows.forEach((row, i) => {
    const data = parseDate(row[col.date]);
    const descricao = (col.description >= 0 ? row[col.description] : '').trim();

    let cents = null;
    if (col.amount >= 0 && row[col.amount]) {
      cents = toCents(row[col.amount]);
      if (/^\s*-/.test(row[col.amount])) cents = -Math.abs(cents);
    } else if (col.credit >= 0 || col.debit >= 0) {
      const c = col.credit >= 0 && row[col.credit] ? toCents(row[col.credit]) : 0;
      const d = col.debit >= 0 && row[col.debit] ? toCents(row[col.debit]) : 0;
      cents = c - Math.abs(d);
    }

    if (!data || cents == null || !Number.isFinite(cents) || (!descricao && !cents)) {
      problemas.push({ linha: i + 2, motivo: !data ? 'data ilegível' : 'valor ilegível' });
      return;
    }

    const valor = sign === 'expense' ? -Math.abs(cents) : sign === 'income' ? Math.abs(cents) : cents;

    out.push({
      id: `${prefix}-${data}-${i}`,
      date: data,
      competence: monthKey(data),
      description: descricao || 'Lançamento importado',
      amountCents: valor,
      cardId,
      accountId,
      method: cardId ? 'credit' : null,
      imported: true,
    });
  });

  return { transactions: out, problemas, header };
}

/** Lançamentos → CSV para abrir em qualquer planilha. */
export function fromTransactions(transactions, categories = []) {
  const nome = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const escape = (s) => {
    const v = String(s ?? '');
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const linhas = [['data', 'descricao', 'valor', 'categoria', 'competencia', 'parcela', 'forma'].join(';')];
  for (const t of transactions) {
    linhas.push([
      t.date,
      escape(t.description),
      (t.amountCents / 100).toFixed(2).replace('.', ','),
      escape(nome[t.categoryId] || ''),
      t.competence || monthKey(t.date),
      t.installment ? `${t.installment.n}/${t.installment.of}` : '',
      t.method || '',
    ].join(';'));
  }
  return `﻿${linhas.join('\n')}`;
}
