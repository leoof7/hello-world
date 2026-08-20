// Categorização em cascata — sem treinar modelo nenhum.
//
// A ordem importa: regra que você criou vence tudo; depois o que o app já
// aprendeu daquela contraparte; depois o dicionário de comércios brasileiros;
// e o que sobrar vai para a fila de revisão em vez de ser chutado.
//
// Chutar categoria errado é pior que não categorizar: o usuário perde a
// confiança nos números e para de usar o app.

const norm = (s) =>
  String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Limpa o lixo que os bancos põem na descrição. */
export function cleanDescription(raw) {
  let s = String(raw || '');
  s = s.replace(/^(compra\s+)?(cartao|cartão|debito|débito|credito|crédito)\s+/i, '');
  s = s.replace(/\b(pagseguro|pagsegur|mercadopago|mercpago|cielo|rede|getnet|stone|sumup|pag\*)\b\s*\*?/gi, '');
  s = s.replace(/\*/g, ' ');
  s = s.replace(/\b\d{2}\/\d{2}\b/g, '');
  s = s.replace(/\bparc\s*\d+\/\d+\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || String(raw || '').trim();
}

/** Extrai a contraparte de um Pix a partir da descrição do extrato. */
export function pixCounterparty(raw) {
  const s = String(raw || '');
  const m = s.match(/pix\s*(?:enviado|recebido|transf\.?|transferencia|transferência)?\s*(?:para|de)?\s*[-:]?\s*(.+)/i);
  if (!m) return null;
  return cleanDescription(m[1]).replace(/\s+\d{3}\.\d{3}\.\d{3}-\d{2}.*$/, '').trim() || null;
}

/**
 * Decide a categoria.
 *
 * rules:    [{ match, categoryId, projectId, priority }] — criadas pelo usuário
 * memory:   { 'CONTRAPARTE NORMALIZADA': { categoryId, projectId } } — aprendido
 * merchants:[{ match, categoryId, essential }] — dicionário embutido
 */
export function categorize(tx, { rules = [], memory = {}, merchants = [] } = {}) {
  const desc = cleanDescription(tx.description);
  const alvo = norm(desc);
  const pix = tx.method === 'pix' ? pixCounterparty(tx.description) : null;
  const chaveMemoria = norm(pix || desc);

  // 1. regra explícita do usuário
  const ordenadas = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const r of ordenadas) {
    if (matches(alvo, r.match)) {
      return { categoryId: r.categoryId, projectId: r.projectId, source: 'regra', confidence: 1 };
    }
  }

  // 2. memória: você já categorizou essa contraparte antes
  if (memory[chaveMemoria]) {
    return { ...memory[chaveMemoria], source: 'memória', confidence: 0.95 };
  }

  // 3. dicionário de comércios
  for (const m of merchants) {
    if (matches(alvo, m.match)) {
      return { categoryId: m.categoryId, projectId: m.projectId, source: 'dicionário', confidence: 0.8 };
    }
  }

  // 4. fila de revisão — melhor admitir que não sabe
  return { categoryId: null, source: 'revisão', confidence: 0 };
}

function matches(alvoNormalizado, padrao) {
  if (!padrao) return false;
  if (padrao instanceof RegExp) return padrao.test(alvoNormalizado);
  return alvoNormalizado.includes(norm(padrao));
}

/** Aprende com uma correção do usuário. Devolve a memória atualizada. */
export function learn(memory, tx, { categoryId, projectId }) {
  const chave = norm(pixCounterparty(tx.description) || cleanDescription(tx.description));
  if (!chave) return memory;
  return { ...memory, [chave]: { categoryId, projectId } };
}

/** Cria uma regra a partir de uma transação — "sempre que aparecer isso, é X". */
export function ruleFrom(tx, categoryId, { projectId, priority = 10 } = {}) {
  const base = pixCounterparty(tx.description) || cleanDescription(tx.description);
  return {
    id: `r_${Date.now().toString(36)}`,
    match: base,
    categoryId,
    projectId,
    priority,
    createdFrom: tx.id,
  };
}

/** Aplica a cascata numa lista inteira e separa o que ficou sem categoria. */
export function categorizeAll(transactions, context) {
  const out = [];
  const revisar = [];
  for (const tx of transactions) {
    if (tx.categoryId) { out.push(tx); continue; }
    const r = categorize(tx, context);
    const novo = { ...tx, categoryId: r.categoryId, projectId: r.projectId ?? tx.projectId, categorySource: r.source };
    out.push(novo);
    if (!r.categoryId) revisar.push(novo);
  }
  return { transactions: out, toReview: revisar };
}

export { norm };
