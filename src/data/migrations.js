// Migrações do documento.
//
// Duas regras que não se quebram:
//   1. migração nunca APAGA, só transforma;
//   2. antes de aplicar qualquer uma, o db.js grava a versão anterior.
//
// Parece detalhe de engenheiro. É o motivo pelo qual metade dos apps pequenos
// perde os dados dos usuários na terceira atualização.

export const CURRENT_VERSION = 4;

/** Documento zerado — a forma canônica de tudo que o app guarda. */
export function emptyDocument() {
  return {
    version: CURRENT_VERSION,
    profile: {
      name: '',
      incomeCents: 0,
      minimumCostCents: 0,
      emergencyTargetMonths: 6,
      onboarding: { done: false, steps: {} },
    },
    accounts: [],      // conta corrente, poupança, dinheiro
    cards: [],         // cartões de crédito
    debts: [],         // rotativo, cheque especial, empréstimos
    transactions: [],
    recurring: [],     // salário, aluguel, assinaturas
    categories: [],
    projects: [],      // carro, casa, pet
    rules: [],         // regras de categorização do usuário
    memory: {},        // contraparte → categoria aprendida
    budgets: {},       // categoriaId → teto em centavos
    goals: [],         // cofrinhos e metas com prazo
    assets: [],        // bens: carro, moto, casa — valor estimado, entram no patrimônio
    faturasPagas: [],  // "cardId|cycleId" das faturas que a pessoa confirmou ter pago
    snapshots: [],     // patrimônio mês a mês, digitado à mão
    settings: {
      theme: 'auto',
      debtMethod: 'avalanche',
      backupEveryDays: 7,
    },
  };
}

/**
 * Cada migração recebe o documento e devolve o documento na versão seguinte.
 * A chave é a versão de DESTINO.
 */
const MIGRATIONS = {
  // 1: versão inicial. Existe para o mecanismo já nascer exercitado —
  // documentos sem `version` (de uma instalação anterior ao versionamento)
  // recebem os campos que faltam sem perder nada do que já tinham.
  1: (doc) => {
    const base = emptyDocument();
    return {
      ...base,
      ...doc,
      profile: { ...base.profile, ...(doc.profile || {}) },
      settings: { ...base.settings, ...(doc.settings || {}) },
      version: 1,
    };
  },
  // 2: Projetos de vida e Cofrinhos eram duas coisas separadas que faziam a
  // pessoa cadastrar "Carro" duas vezes — uma pra ver quanto custa, outra pra
  // guardar dinheiro. Viram uma coisa só: toda meta pode opcionalmente somar
  // categorias de gasto, e os projetos existentes entram como metas sem
  // valor-alvo (só o acompanhamento de categoria que já tinham).
  2: (doc) => {
    const projetosComoMetas = (doc.projects || []).map((p) => ({
      id: p.id,
      name: p.name,
      targetCents: 0,
      savedCents: 0,
      monthlyCents: 0,
      status: 'ativo',
      deadline: null,
      kind: 'projeto',
      categoryIds: p.categoryIds || [],
    }));
    return {
      ...doc,
      goals: [...(doc.goals || []).map((g) => ({ categoryIds: [], ...g })), ...projetosComoMetas],
      projects: [],
      version: 2,
    };
  },
  // 3: lista de categorias enxuta, mais as três de Pix.
  //
  // Dezoito categorias faziam a pessoa desistir de classificar. Ficam as que
  // se usa de verdade; o resto se cria em um toque quando fizer falta.
  //
  // Migração não apaga: o que estava categorizado no que saiu volta para a
  // fila de revisão, com o nome original preservado em `categoriaAnterior`
  // para você reconhecer o que era. Moradia e Contas da casa ficam de fora do
  // corte de propósito — os gastos fixos apontam para elas e o custo de vida
  // mínimo sai da soma delas.
  3: (doc) => {
    const removidas = new Set([
      'transporte', 'saude', 'farmacia', 'assinaturas',
      'vestuario', 'educacao', 'eletronicos', 'viagem', 'renda',
    ]);
    const nomeAntigo = Object.fromEntries((doc.categories || []).map((c) => [c.id, c.name]));

    const novas = [
      { id: 'pix-entrada', name: 'Pix recebido', color: 'jade', essential: false, fixed: false },
      { id: 'pix-saida', name: 'Pix saída', color: 'red', essential: false, fixed: false },
      { id: 'pix-interno', name: 'Pix entre contas', color: 'steel', essential: false, fixed: false, neutra: true },
    ];
    const jaTem = new Set((doc.categories || []).map((c) => c.id));

    return {
      ...doc,
      categories: [
        ...(doc.categories || []).filter((c) => !removidas.has(c.id)),
        ...novas.filter((c) => !jaTem.has(c.id)),
      ],
      transactions: (doc.transactions || []).map((t) =>
        removidas.has(t.categoryId)
          ? { ...t, categoryId: null, categoriaAnterior: nomeAntigo[t.categoryId] || t.categoryId }
          : t),
      // Gasto fixo apontando para categoria que saiu fica sem categoria, mas
      // continua existindo: o valor e o dia é que sustentam a projeção.
      recurring: (doc.recurring || []).map((r) =>
        removidas.has(r.categoryId) ? { ...r, categoryId: null } : r),
      budgets: Object.fromEntries(
        Object.entries(doc.budgets || {}).filter(([id]) => !removidas.has(id))),
      version: 3,
    };
  },

  /**
   * Cartão ganha tipo: crédito, débito ou benefício.
   *
   * Até aqui todo cartão era de crédito por definição — tinha fechamento,
   * vencimento e fatura. Quem já cadastrou continua exatamente como estava:
   * `kind: 'credit'` só torna explícito o que já era implícito. Nenhum campo
   * some, porque migração não apaga.
   */
  4(doc) {
    return {
      ...doc,
      cards: (doc.cards || []).map((c) => ({ ...c, kind: c.kind || 'credit' })),
      version: 4,
    };
  },
};

/**
 * Leva o documento da versão em que ele está até a atual.
 * Devolve também quais migrações rodaram, para o db.js saber se precisa salvar.
 */
export function migrate(doc) {
  let atual = doc && typeof doc === 'object' ? doc : emptyDocument();
  let versao = Number(atual.version) || 0;
  const applied = [];

  while (versao < CURRENT_VERSION) {
    const proxima = versao + 1;
    const fn = MIGRATIONS[proxima];
    if (!fn) throw new Error(`falta a migração para a versão ${proxima}`);
    atual = fn(atual);
    atual.version = proxima;
    applied.push(proxima);
    versao = proxima;
  }

  if (versao > CURRENT_VERSION) {
    // O documento veio de uma versão mais nova do app (backup restaurado de um
    // aparelho atualizado). Não dá para adivinhar o formato futuro.
    throw new Error(
      `este backup é da versão ${versao} e o app está na ${CURRENT_VERSION}. Atualize o app antes de restaurar.`
    );
  }

  return { document: atual, applied };
}

/** Confere se um objeto tem cara de documento do Zero. */
export function looksLikeDocument(obj) {
  return !!obj
    && typeof obj === 'object'
    && Array.isArray(obj.transactions)
    && Array.isArray(obj.cards)
    && typeof obj.profile === 'object';
}
