// Migrações do documento.
//
// Duas regras que não se quebram:
//   1. migração nunca APAGA, só transforma;
//   2. antes de aplicar qualquer uma, o db.js grava a versão anterior.
//
// Parece detalhe de engenheiro. É o motivo pelo qual metade dos apps pequenos
// perde os dados dos usuários na terceira atualização.

export const CURRENT_VERSION = 1;

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
    goals: [],         // cofrinhos
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
