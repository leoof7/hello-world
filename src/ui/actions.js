// O que acontece quando você toca em alguma coisa.
//
// Tudo passa por delegação de evento no container: a tela é redesenhada
// inteira a cada mudança, então pendurar ouvinte em cada botão seria trabalho
// jogado fora. Um ouvinte no topo resolve.

import { app, commit, go, draw } from './app.js';
import { toCents, brl, formatCents, sum } from '../core/money.js';
import { monthKey, formatShort } from '../core/dates.js';
import { parseEntry } from '../core/parse.js';
import { expand } from '../core/installments.js';
import { learn } from '../core/categorize.js';
import { KIND } from '../core/debts.js';
import { MERCHANTS } from '../seed/categories.js';
import * as db from '../data/db.js';
import { buildBackup, readBackup, deliver, backupFilename, backupStatus, markDone, readFile } from '../data/backup.js';
import { phraseToBytes } from '../data/recovery.js';
import * as csv from '../io/csv.js';
import * as ofx from '../io/ofx.js';
import { buildCalendar } from '../io/ics.js';
import { statementsOf } from './state.js';
import { esc, icon, toast, sheet, confirmar } from './dom.js';

export function wire() {
  const raiz = document.getElementById('app');
  raiz.onclick = async (e) => {
    const alvo = e.target.closest('[data-go],[data-act]');
    if (!alvo) return;
    if (alvo.dataset.go) { go(alvo.dataset.go); return; }
    try {
      await executar(alvo.dataset.act, alvo.dataset);
    } catch (err) {
      toast(err?.message || 'Não consegui fazer isso.');
    }
  };
}

async function executar(acao, dados) {
  const fn = ACOES[acao];
  if (fn) await fn(dados);
}

// ----------------------------------------------------------- formulário genérico

/**
 * Abre uma folha com campos e devolve os valores, ou null se cancelar.
 * Campo de dinheiro entra e sai em centavos — nunca em ponto flutuante.
 */
function form(titulo, sub, campos, { ok = 'Salvar', apagar = null } = {}) {
  const corpo = campos.map((c) => {
    const id = `f-${c.name}`;
    if (c.type === 'select') {
      return `<div class="field"><label for="${id}">${esc(c.label)}</label>
        <select id="${id}" name="${c.name}">
          ${c.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(c.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    if (c.type === 'checkbox') {
      return `<div class="field" style="flex-direction:row;align-items:center;gap:10px">
        <input type="checkbox" id="${id}" name="${c.name}" ${c.value ? 'checked' : ''} style="width:22px;height:22px">
        <label for="${id}" style="text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2)">${esc(c.label)}</label></div>`;
    }
    if (c.type === 'textarea') {
      return `<div class="field"><label for="${id}">${esc(c.label)}</label>
        <textarea id="${id}" name="${c.name}" rows="${c.rows || 3}" placeholder="${esc(c.placeholder || '')}">${esc(c.value ?? '')}</textarea>
        ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    const valor = c.type === 'money' ? formatCents(Math.abs(c.value || 0)) : (c.value ?? '');
    const modo = c.type === 'money' ? 'decimal' : c.type === 'number' ? 'numeric' : 'text';
    const tipo = c.type === 'date' ? 'date' : 'text';
    return `<div class="field"><label for="${id}">${esc(c.label)}</label>
      <input type="${tipo}" inputmode="${modo}" id="${id}" name="${c.name}" value="${esc(valor)}"
        placeholder="${esc(c.placeholder || '')}" ${c.type === 'text' ? 'autocapitalize="sentences"' : ''}>
      ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
  }).join('');

  return sheet(
    `<h4>${esc(titulo)}</h4>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
     <form id="frm">${corpo}
       <div class="btns"><button type="submit" class="btn primary">${esc(ok)}</button>
       <button type="button" class="btn ghost" data-x="1">Cancelar</button></div>
       ${apagar ? `<div class="btns"><button type="button" class="btn danger" data-del="1" style="width:100%">${esc(apagar)}</button></div>` : ''}
     </form>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-del]')?.addEventListener('click', () => fechar({ __apagar: true }));
        card.querySelector('#frm').onsubmit = (ev) => {
          ev.preventDefault();
          const out = {};
          for (const c of campos) {
            const el = card.querySelector(`[name="${c.name}"]`);
            if (c.type === 'money') out[c.name] = toCents(el.value);
            else if (c.type === 'number') out[c.name] = Number(el.value) || 0;
            else if (c.type === 'checkbox') out[c.name] = el.checked;
            else out[c.name] = el.value.trim();
          }
          fechar(out);
        };
      },
    }
  );
}

const opcoesCategoria = () => [
  { value: '', label: 'sem categoria' },
  ...app.doc.categories.map((c) => ({ value: c.id, label: c.name })),
];

const opcoesOrigem = () => [
  ...app.doc.accounts.map((a) => ({ value: `ac:${a.id}`, label: `${a.name} (conta)` })),
  ...app.doc.cards.map((c) => ({ value: `cd:${c.id}`, label: `${c.name} (cartão)` })),
];

const novoId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Entrega um arquivo pelo melhor caminho do aparelho. */
async function entregar(conteudo, nome, tipo = 'text/plain') {
  const arquivo = new File([conteudo], nome, { type: tipo });
  if (navigator.canShare?.({ files: [arquivo] })) {
    try { await navigator.share({ files: [arquivo], title: nome }); return 'compartilhado'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelado'; }
  }
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'baixado';
}

/** Abre o seletor de arquivos e devolve o conteúdo em texto. */
function escolherArquivo(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { nome: f.name, texto: await readFile(f) } : null);
    };
    input.click();
  });
}

// -------------------------------------------------------------------- ações

const ACOES = {

  // ---- topo ----
  async tema() {
    const atual = app.doc.settings.theme || 'auto';
    const proximo = atual === 'auto' ? 'dark' : atual === 'dark' ? 'light' : 'auto';
    if (proximo === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = proximo;
    await commit((d) => { d.settings.theme = proximo; });
    toast(proximo === 'auto' ? 'Tema: segue o sistema' : proximo === 'dark' ? 'Tema escuro' : 'Tema claro');
  },

  privacidade() {
    app.privacy = !app.privacy;
    draw();
  },

  // ---- lançamentos ----
  async novo() { await editarLancamento(null); },
  async editar({ id }) { await editarLancamento(id); },

  async falar() {
    const frase = await pedirFrase();
    if (!frase) return;

    const lido = parseEntry(frase, {
      todayISO: app.todayISO,
      merchants: MERCHANTS,
      categories: app.doc.categories,
    });

    if (lido.needs.length) {
      toast(`Faltou ${lido.needs.join(' e ')} — completa aí embaixo.`);
    }
    await editarLancamento(null, {
      description: lido.description || '',
      amountCents: lido.amountCents ?? 0,
      date: lido.date,
      categoryId: lido.categoryId || '',
      count: lido.installmentCount || 1,
      method: lido.method,
    });
  },

  async categorizar({ id }) {
    const tx = app.doc.transactions.find((t) => t.id === id);
    if (!tx) return;
    const sugerida = app.view.revisao.find((t) => t.id === id)?.categoryId || '';
    const r = await form(
      tx.description,
      `${brl(tx.amountCents)} · ${formatShort(tx.date)}`,
      [
        { name: 'categoryId', label: 'Categoria', type: 'select', value: sugerida, options: opcoesCategoria() },
        { name: 'sempre', label: 'Guardar para os próximos desta contraparte', type: 'checkbox', value: true },
      ],
      { ok: 'Categorizar' }
    );
    if (!r) return;

    await commit((d) => {
      const alvo = d.transactions.find((t) => t.id === id);
      if (alvo) alvo.categoryId = r.categoryId || null;
      if (r.sempre && r.categoryId) d.memory = learn(d.memory || {}, tx, { categoryId: r.categoryId });
    });
    toast(r.sempre ? 'Categorizado — não pergunto de novo.' : 'Categorizado.');
  },

  // ---- contas e cartões ----
  async 'nova-conta'() { await editarConta(null); },
  async 'editar-conta'({ id }) { await editarConta(id); },
  async 'novo-cartao'() { await editarCartao(null); },
  async 'editar-cartao'({ id }) { await editarCartao(id); },

  // ---- dívidas ----
  async 'nova-divida'() { await editarDivida(null); },
  async 'editar-divida'({ id }) { await editarDivida(id); },

  async metodo({ v }) {
    await commit((d) => { d.settings.debtMethod = v; });
  },

  async 'orcamento-divida'() {
    const r = await form(
      'Quanto vai para as dívidas',
      `Hoje sobram ${brl(app.view.sobraCents)} depois dos fixos e das parcelas. Os mínimos obrigatórios pedem ${brl(app.view.minimosCents)}.`,
      [{ name: 'valor', label: 'Por mês', type: 'money', value: app.view.orcamentoDivida }],
      { ok: 'Simular' }
    );
    if (!r) return;
    await commit((d) => { d.settings.debtBudgetCents = r.valor; });
  },

  async 'simular-troca'() {
    const cara = app.view.dividas.find((d) => d.monthlyRate > 0.03);
    if (!cara) { toast('Nenhuma dívida cara o bastante para valer a troca.'); return; }

    const r = await form(
      'Trocar por empréstimo mais barato',
      `${cara.name} está a ${(cara.monthlyRate * 100).toFixed(1)}% ao mês. Consignado costuma ficar entre 1,5% e 2,2%.`,
      [{ name: 'taxa', label: 'Taxa do novo empréstimo (% ao mês)', type: 'text', value: '1,8', hint: 'a que o banco te ofereceu de fato' }],
      { ok: 'Ver a diferença' }
    );
    if (!r) return;

    const nova = Number(String(r.taxa).replace(',', '.')) / 100;
    if (!Number.isFinite(nova) || nova <= 0) { toast('Taxa inválida.'); return; }

    const { payoffPlan, refinance } = await import('../core/debts.js');
    const base = payoffPlan(app.doc.debts, app.view.orcamentoDivida, { fromMonth: app.view.mes });
    const trocado = payoffPlan(refinance(app.doc.debts, cara.id, nova), app.view.orcamentoDivida, { fromMonth: app.view.mes });

    const economia = base.totalInterestCents - trocado.totalInterestCents;
    const meses = base.monthsCount - trocado.monthsCount;

    await sheet(`
      <h4>Trocando ${esc(cara.name)}</h4>
      <p class="sub">Mesma parcela mensal de ${esc(brl(app.view.orcamentoDivida))}, só com a taxa menor.</p>
      <div class="panel">
        <div class="ft" style="margin:0"><span style="font-size:12px;color:var(--muted)">Hoje</span>
          <b class="num">${esc(base.done ? `${base.monthsCount} meses` : 'não quita')}</b></div>
        <div class="ft"><span style="font-size:12px;color:var(--muted)">Trocando</span>
          <b class="num" style="color:var(--jade)">${esc(trocado.done ? `${trocado.monthsCount} meses` : 'não quita')}</b></div>
        <div class="ft"><span style="font-size:12px;color:var(--muted)">Juros economizados</span>
          <b class="num" style="color:var(--jade)">${esc(brl(Math.max(0, economia)))}</b></div>
      </div>
      <p class="sub" style="margin-top:14px">
        ${economia > 0
          ? `Sai ${meses} ${meses === 1 ? 'mês' : 'meses'} antes. Só assine se a taxa contratada for essa mesma — e confira o CET, não a taxa da propaganda.`
          : 'Nesta taxa a troca não compensa. Não assine.'}
      </p>
      <div class="btns"><button class="btn primary" data-x="1">Entendi</button></div>`,
      { onMount: (card, fechar) => { card.querySelector('[data-x]').onclick = () => fechar(null); } }
    );
  },

  // ---- cofrinhos ----
  async 'novo-cofrinho'() { await editarCofrinho(null); },
  async 'editar-cofrinho'({ id }) { await editarCofrinho(id); },

  // ---- renda ----
  async 'nova-renda'() { await editarRecorrente(null, 'income'); },
  async 'editar-renda'({ id }) { await editarRecorrente(id, 'income'); },

  async 'novo-avulso'() {
    await editarLancamento(null, { description: '', amountCents: 0, extraordinary: true, entrada: true });
  },

  async fixos() {
    const fixos = app.doc.recurring.filter((r) => r.kind === 'expense');
    await sheet(`
      <h4>Gastos fixos</h4>
      <p class="sub">O que sai todo mês no mesmo dia. É o que a projeção usa para saber
        quanto realmente sobra.</p>
      ${fixos.length ? `<div class="list">${fixos.map((r) => `
        <button class="row" data-act="editar-fixo" data-id="${esc(r.id)}">
          <div class="ic">${icon('relogio')}</div>
          <div class="bd"><div class="t">${esc(r.label)}</div><div class="s">todo dia ${r.dayOfMonth}</div></div>
          <div class="rt"><div class="amt num">${esc(brl(-Math.abs(r.amountCents)))}</div></div>
        </button>`).join('')}</div>` : '<div class="empty">Nenhum gasto fixo cadastrado.</div>'}
      <div class="btns"><button class="btn primary" data-novo="1">${icon('mais')} Adicionar</button>
        <button class="btn ghost" data-x="1">Fechar</button></div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelector('[data-novo]').onclick = () => fechar('novo');
          card.querySelectorAll('[data-act="editar-fixo"]').forEach((b) => {
            b.onclick = () => fechar(b.dataset.id);
          });
        },
      }
    ).then((r) => {
      if (r === 'novo') return editarRecorrente(null, 'expense');
      if (r) return editarRecorrente(r, 'expense');
    });
  },

  async tetos() {
    const campos = app.doc.categories
      .filter((c) => c.id !== 'renda')
      .map((c) => ({ name: c.id, label: c.name, type: 'money', value: app.doc.budgets?.[c.id] || 0 }));

    const r = await form('Tetos por categoria',
      'Zero significa sem teto. Comece só pelas três que mais escapam — teto em tudo vira teto em nada.',
      campos);
    if (!r) return;

    await commit((d) => {
      d.budgets = {};
      for (const [k, v] of Object.entries(r)) if (v > 0) d.budgets[k] = v;
    });
    toast('Tetos salvos.');
  },

  async patrimonio() {
    const campos = app.doc.accounts.map((a) => ({
      name: a.id, label: a.name, type: 'money', value: a.balanceCents,
      hint: a.balanceCents < 0 ? 'negativo — digite sem o sinal e marque abaixo' : '',
    }));
    if (!campos.length) { toast('Cadastre uma conta primeiro, em Cartões.'); return; }

    const r = await form('Atualizar saldos',
      'Abra o app de cada banco e copie o saldo. Trinta segundos por mês — é o que mantém a projeção honesta.',
      campos);
    if (!r) return;

    await commit((d) => {
      for (const a of d.accounts) {
        if (r[a.id] != null) a.balanceCents = a.balanceCents < 0 ? -Math.abs(r[a.id]) : r[a.id];
      }
      d.snapshots = [
        ...(d.snapshots || []).filter((s) => s.month !== app.view.mes),
        { month: app.view.mes, netCents: sum(d.accounts.map((a) => a.balanceCents)) - sum(d.debts.map((x) => Math.abs(x.balanceCents))) },
      ].sort((a, b) => (a.month < b.month ? -1 : 1));
    });
    toast('Saldos atualizados.');
  },

  async projetos() {
    const r = await form('Projetos de vida',
      'Um projeto junta várias categorias para você ver o custo real de uma coisa — "quanto o carro me custa" soma combustível, seguro, manutenção e IPVA.',
      [{ name: 'nome', label: 'Nome do projeto', type: 'text', placeholder: 'Carro' }],
      { ok: 'Criar' });
    if (!r?.nome) return;
    await commit((d) => { d.projects.push({ id: novoId('pj'), name: r.nome, categoryIds: [] }); });
    toast('Projeto criado. Escolha as categorias ao editar um lançamento.');
  },

  async perfil() {
    const p = app.doc.profile;
    const r = await form('Seu perfil', null, [
      { name: 'name', label: 'Nome', type: 'text', value: p.name },
      { name: 'incomeCents', label: 'Renda mensal', type: 'money', value: p.incomeCents },
      { name: 'minimumCostCents', label: 'Custo de vida mínimo', type: 'money', value: p.minimumCostCents,
        hint: 'só o que não dá para cortar. A Análise calcula sozinha com 3 meses de histórico' },
      { name: 'emergencyTargetMonths', label: 'Meses de reserva desejados', type: 'number', value: p.emergencyTargetMonths || 6 },
    ]);
    if (!r) return;
    await commit((d) => { Object.assign(d.profile, r); });
    toast('Perfil salvo.');
  },

  // ---- dados ----
  async backup() {
    const frase = await pedirFraseCurta(
      'Backup',
      'O arquivo é cifrado com as suas doze palavras — não com o Face ID. Um backup que só abre no aparelho que o criou não é backup.'
    );
    if (!frase) return;

    const arquivo = await buildBackup(app.doc, frase);
    const r = await deliver(arquivo, backupFilename(app.todayISO));
    if (r.cancelled) { toast('Backup cancelado.'); return; }

    await markDone(app.todayISO);
    await commit((d) => { d.profile.backupFeito = true; }, { redraw: false });
    app.backup = await backupStatus(app.todayISO);
    draw();
    toast(r.method === 'compartilhamento' ? 'Salve no iCloud Drive ou nos Arquivos.' : 'Backup baixado.');
  },

  async restaurar() {
    const ok = await confirmar({
      titulo: 'Restaurar backup',
      texto: 'Tudo que está neste aparelho será substituído pelo conteúdo do arquivo. Se o que está aqui é mais novo, faça um backup antes.',
      ok: 'Escolher arquivo',
    });
    if (!ok) return;

    const arquivo = await escolherArquivo('.zbk,application/json');
    if (!arquivo) return;

    const frase = await pedirFraseCurta('Doze palavras', 'As mesmas que você anotou quando criou o cofre.');
    if (!frase) return;

    const documento = await readBackup(arquivo.texto, frase);
    app.doc = await db.save(app.key, documento);
    draw();
    toast('Backup restaurado.');
  },

  async importar() {
    const destino = await form('Importar extrato',
      'Exporte no app do banco em CSV ou OFX. OFX é melhor: traz o sinal certo e um identificador que evita duplicar.',
      [
        { name: 'origem', label: 'Entrou onde', type: 'select', value: opcoesOrigem()[0]?.value, options: opcoesOrigem() },
        { name: 'sinal', label: 'Sinal dos valores', type: 'select', value: 'auto',
          options: [
            { value: 'auto', label: 'como está no arquivo' },
            { value: 'expense', label: 'tudo como saída (fatura de cartão)' },
          ] },
      ],
      { ok: 'Escolher arquivo' });
    if (!destino) return;

    const arquivo = await escolherArquivo('.csv,.ofx,.txt,text/csv');
    if (!arquivo) return;

    const [tipo, id] = destino.origem.split(':');
    const alvo = tipo === 'cd' ? { cardId: id } : { accountId: id };

    const lido = ofx.isOFX(arquivo.texto)
      ? ofx.toTransactions(arquivo.texto, alvo)
      : csv.toTransactions(arquivo.texto, { ...alvo, sign: destino.sinal });

    if (!lido.transactions.length) {
      toast('Não achei nenhum lançamento nesse arquivo.');
      return;
    }

    const existentes = new Set(app.doc.transactions.map((t) => t.id));
    const novos = lido.transactions.filter((t) => !existentes.has(t.id));

    const ok = await confirmar({
      titulo: `${novos.length} lançamentos`,
      texto: `${lido.transactions.length - novos.length} já estavam aqui e foram ignorados.${
        lido.problemas.length ? ` ${lido.problemas.length} linhas não deram para ler.` : ''}`,
      ok: 'Importar',
    });
    if (!ok) return;

    await commit((d) => { d.transactions = [...novos, ...d.transactions]; });
    toast(`${novos.length} importados. Revise as categorias.`);
    go('revisao');
  },

  async 'exportar-csv'() {
    const conteudo = csv.fromTransactions(app.doc.transactions, app.doc.categories);
    const r = await entregar(conteudo, `zero-lancamentos-${app.todayISO}.csv`, 'text/csv');
    if (r !== 'cancelado') toast('Planilha pronta.');
  },

  async calendario() {
    const faturas = statementsOf(app.doc, app.todayISO).futuras
      .map((s) => ({ ...s, cardName: app.doc.cards.find((c) => c.id === s.cardId)?.name || '' }));
    if (!faturas.length) { toast('Nenhuma fatura futura para agendar.'); return; }
    await entregar(buildCalendar(faturas), 'zero-vencimentos.ics', 'text/calendar');
  },

  async seguranca() {
    const meta = await db.readMeta();
    const espaco = await db.estimate();
    const persistido = await navigator.storage?.persisted?.().catch(() => false);
    const instalado = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;

    const metodo = {
      passkey: 'Face ID · a chave vem da passkey, o cofre não abre sem ela',
      'passkey-frase': 'Face ID + doze palavras · este aparelho não suporta chave dentro da passkey',
      senha: 'Senha · derivada com PBKDF2, 600 mil iterações',
    }[meta?.unlockMethod] || 'não definido';

    await sheet(`
      <h4>Segurança e espaço</h4>
      <p class="sub">Nada aqui sai deste aparelho. Não há servidor para invadir — e também não há para onde recuperar.</p>
      <div class="panel" style="padding:16px 16px 10px">
        <div class="gi"><span class="bx dot"></span><div><b>Como o cofre abre</b><i>${esc(metodo)}</i></div></div>
        <div class="gi"><span class="bx dot"></span><div><b>Cifra</b><i>AES-256-GCM · o banco inteiro é um bloco opaco, nem os índices ficam legíveis</i></div></div>
        <div class="gi"><span class="bx dot ${instalado ? '' : 'a'}"></span>
          <div><b>${instalado ? 'Instalado na tela inicial' : 'AINDA NÃO instalado na tela inicial'}</b>
          <i>${instalado
            ? 'é o que impede o iOS de apagar os dados por inatividade'
            : 'o Safari apaga os dados de sites não instalados depois de 7 dias sem uso. Compartilhar → Adicionar à Tela de Início. Isto não é opcional.'}</i></div></div>
        <div class="gi"><span class="bx dot ${persistido ? '' : 'a'}"></span>
          <div><b>Armazenamento ${persistido ? 'persistente' : 'não persistente'}</b>
          <i>${espaco ? `${(espaco.usageBytes / 1024).toFixed(0)} KB usados de ${(espaco.quotaBytes / 1048576).toFixed(0)} MB disponíveis` : 'o navegador não informou'}</i></div></div>
        <div class="gi"><span class="bx dot ${app.backup?.due ? 'a' : ''}"></span>
          <div><b>Backup</b><i>${esc(app.backup ? resumoBackup(app.backup) : 'nunca feito')}</i></div></div>
      </div>
      <div class="btns"><button class="btn ghost" data-cal="1">${icon('relogio')} Vencimentos no Calendário</button></div>
      <div class="btns"><button class="btn primary" data-x="1" style="width:100%">Fechar</button></div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelector('[data-cal]').onclick = () => fechar('cal');
        },
      }
    ).then((r) => { if (r === 'cal') return ACOES.calendario(); });
  },

  /**
   * Limpar os dados sem destruir o cofre.
   *
   * É a saída do exemplo, e é diferente de "apagar tudo": a chave, a passkey e
   * as doze palavras continuam valendo, então não há setup nenhum para refazer.
   * Sem isso, sair dos dados de exemplo obrigava a apagar o cofre e passar de
   * novo pelas doze palavras — que é exatamente o loop que não pode existir.
   */
  async limpar() {
    const eraExemplo = !!app.doc.profile?.demo;
    const ok = await confirmar({
      titulo: eraExemplo ? 'Sair do exemplo' : 'Limpar os dados',
      texto: eraExemplo
        ? 'Apaga os lançamentos, cartões e dívidas fictícios e deixa o app pronto para os seus números. Suas doze palavras e o Face ID continuam os mesmos — você não vai refazer nada.'
        : 'Apaga lançamentos, cartões, dívidas, cofrinhos e tetos. O cofre, o Face ID e as doze palavras continuam valendo. Não tem volta sem backup.',
      ok: eraExemplo ? 'Limpar e começar' : 'Limpar tudo',
      perigo: !eraExemplo,
    });
    if (!ok) return;

    if (!eraExemplo) {
      const confirma = await form('Confirmar',
        'Digite LIMPAR para confirmar. Se você quer guardar o que está aqui, cancele e faça um backup antes.',
        [{ name: 'palavra', label: 'Confirmação', type: 'text', placeholder: 'LIMPAR' }],
        { ok: 'Limpar agora' });
      if (confirma?.palavra !== 'LIMPAR') { toast('Nada foi limpo.'); return; }
    }

    const { documentoNovo } = await import('./app.js');
    app.doc = await db.save(app.key, documentoNovo());
    go('painel');
    draw();
    toast(eraExemplo ? 'Pronto. Agora é o seu app.' : 'Dados limpos.');
  },

  async apagar() {
    const ok = await confirmar({
      titulo: 'Apagar tudo, inclusive o cofre',
      texto: 'Apaga o cofre inteiro deste aparelho e a chave junto: você vai refazer as doze palavras do começo. Se você só quer zerar os dados, use "Limpar os dados" — é mais simples e não refaz nada.',
      ok: 'Apagar o cofre',
      perigo: true,
    });
    if (!ok) return;

    const confirma = await form('Tem certeza mesmo?',
      'Digite APAGAR em maiúsculas para confirmar.',
      [{ name: 'palavra', label: 'Confirmação', type: 'text', placeholder: 'APAGAR' }],
      { ok: 'Apagar definitivamente' });
    if (confirma?.palavra !== 'APAGAR') { toast('Nada foi apagado.'); return; }

    await db.wipe();
    location.reload();
  },
};

const resumoBackup = (status) =>
  status.never ? 'nunca feito — sem servidor, ele é a sua única cópia'
    : `último há ${status.daysSince} ${status.daysSince === 1 ? 'dia' : 'dias'}`;

// ------------------------------------------------------------- editores

async function editarLancamento(id, sugestao = {}) {
  const tx = id ? app.doc.transactions.find((t) => t.id === id) : null;

  if (tx?.installment) {
    toast('Parcela não se edita sozinha — apague a compra inteira e lance de novo.');
    return;
  }

  // Todo lançamento sai de algum lugar. Sem conta nem cartão o formulário não
  // teria "onde", e o campo vazio viraria erro na hora de salvar.
  if (!opcoesOrigem().length) {
    const ok = await confirmar({
      titulo: 'Cadastre uma conta primeiro',
      texto: 'Todo lançamento precisa dizer de onde saiu o dinheiro — uma conta ou um cartão. Leva meio minuto.',
      ok: 'Criar conta',
    });
    if (ok) await editarConta(null);
    return;
  }

  const origemAtual = tx?.cardId ? `cd:${tx.cardId}` : tx?.accountId ? `ac:${tx.accountId}` : opcoesOrigem()[0]?.value;
  const entrada = sugestao.entrada ?? (tx ? tx.amountCents > 0 : false);

  const r = await form(
    tx ? 'Editar lançamento' : entrada ? 'Novo recebimento' : 'Novo lançamento',
    null,
    [
      { name: 'description', label: 'O que foi', type: 'text', value: tx?.description ?? sugestao.description ?? '', placeholder: 'Pão de Açúcar' },
      { name: 'valor', label: 'Valor', type: 'money', value: Math.abs(tx?.amountCents ?? sugestao.amountCents ?? 0) },
      { name: 'entrada', label: 'É dinheiro entrando', type: 'checkbox', value: entrada },
      { name: 'date', label: 'Quando', type: 'date', value: tx?.date ?? sugestao.date ?? app.todayISO },
      { name: 'origem', label: 'Onde', type: 'select', value: origemAtual, options: opcoesOrigem() },
      { name: 'categoryId', label: 'Categoria', type: 'select', value: tx?.categoryId ?? sugestao.categoryId ?? '', options: opcoesCategoria() },
      { name: 'count', label: 'Parcelas', type: 'number', value: sugestao.count || 1, hint: '1 para à vista. Vale só para cartão de crédito.' },
      { name: 'extraordinary', label: 'Entrada avulsa (trader, serviço por fora)', type: 'checkbox', value: tx?.extraordinary ?? sugestao.extraordinary ?? false },
    ],
    { ok: tx ? 'Salvar' : 'Lançar', apagar: tx ? 'Apagar lançamento' : null }
  );
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.transactions = d.transactions.filter((t) => t.id !== id); });
    toast('Apagado.');
    return;
  }

  if (!r.valor) { toast('Faltou o valor.'); return; }

  const [tipo, origemId] = r.origem.split(':');
  const cardId = tipo === 'cd' ? origemId : null;
  const accountId = tipo === 'ac' ? origemId : null;
  const sinal = r.entrada ? 1 : -1;

  // Parcelamento é caso à parte: uma compra vira N lançamentos, cada um na sua
  // fatura. Sem isso a projeção mente.
  if (!r.entrada && cardId && r.count > 1) {
    const card = app.doc.cards.find((c) => c.id === cardId);
    const grupo = novoId('cp');
    const parcelas = expand(
      { id: grupo, cardId, date: r.date, totalCents: r.valor, count: r.count, description: r.description, categoryId: r.categoryId || null },
      card
    );
    await commit((d) => {
      if (id) d.transactions = d.transactions.filter((t) => t.id !== id);
      d.transactions = [...parcelas, ...d.transactions];
    });
    toast(`${r.count}x de ${brl(parcelas[1]?.amountCents || parcelas[0].amountCents)} — a primeira vence ${formatShort(parcelas[0].dueDate)}.`);
    return;
  }

  const registro = {
    id: id || novoId('tx'),
    date: r.date,
    competence: monthKey(r.date),
    description: r.description || 'Lançamento',
    amountCents: sinal * Math.abs(r.valor),
    categoryId: r.categoryId || null,
    cardId,
    accountId,
    method: cardId ? 'credit' : tx?.method || null,
    extraordinary: r.entrada && r.extraordinary,
  };

  if (cardId) {
    const card = app.doc.cards.find((c) => c.id === cardId);
    const { cycleFor } = await import('../core/statements.js');
    const ciclo = cycleFor(card, r.date);
    registro.cycleId = ciclo.id;
    registro.dueDate = ciclo.dueDate;
  }

  await commit((d) => {
    d.transactions = id
      ? d.transactions.map((t) => (t.id === id ? registro : t))
      : [registro, ...d.transactions];
  });
  toast(id ? 'Salvo.' : 'Lançado.');
}

async function editarConta(id) {
  const c = id ? app.doc.accounts.find((a) => a.id === id) : null;
  const r = await form(c ? 'Editar conta' : 'Nova conta', null, [
    { name: 'name', label: 'Nome', type: 'text', value: c?.name || '', placeholder: 'Nubank' },
    { name: 'type', label: 'Tipo', type: 'select', value: c?.type || 'checking',
      options: [
        { value: 'checking', label: 'Conta corrente' },
        { value: 'savings', label: 'Reserva / poupança' },
        { value: 'cash', label: 'Dinheiro' },
      ] },
    { name: 'saldo', label: 'Saldo hoje', type: 'money', value: Math.abs(c?.balanceCents || 0) },
    { name: 'negativo', label: 'Está negativo', type: 'checkbox', value: (c?.balanceCents || 0) < 0 },
  ], { ok: 'Salvar', apagar: c ? 'Apagar conta' : null });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.accounts = d.accounts.filter((a) => a.id !== id); });
    toast('Conta apagada.');
    return;
  }

  const registro = {
    id: id || novoId('ac'),
    name: r.name || 'Conta',
    type: r.type,
    balanceCents: (r.negativo ? -1 : 1) * Math.abs(r.saldo),
  };
  await commit((d) => {
    d.accounts = id ? d.accounts.map((a) => (a.id === id ? { ...a, ...registro } : a)) : [...d.accounts, registro];
  });
  toast('Salvo.');
}

async function editarCartao(id) {
  const c = id ? app.doc.cards.find((x) => x.id === id) : null;
  const r = await form(c ? 'Editar cartão' : 'Novo cartão',
    'O dia do fechamento é o que decide em qual fatura cada compra cai. Compra feita NO dia do fechamento já entra na fatura seguinte.',
    [
      { name: 'name', label: 'Nome', type: 'text', value: c?.name || '', placeholder: 'Nubank' },
      { name: 'closingDay', label: 'Fecha dia', type: 'number', value: c?.closingDay || 20 },
      { name: 'dueDay', label: 'Vence dia', type: 'number', value: c?.dueDay || 27 },
      { name: 'limite', label: 'Limite', type: 'money', value: c?.limitCents || 0 },
      { name: 'color', label: 'Cor', type: 'select', value: c?.color || 'blue',
        options: [
          { value: 'red', label: 'Vermelho' }, { value: 'blue', label: 'Azul' },
          { value: 'jade', label: 'Verde' }, { value: 'steel', label: 'Prata' },
        ] },
    ], { ok: 'Salvar', apagar: c ? 'Apagar cartão' : null });
  if (!r) return;

  if (r.__apagar) {
    const temLancamento = app.doc.transactions.some((t) => t.cardId === id);
    if (temLancamento) {
      const ok = await confirmar({
        titulo: 'Este cartão tem lançamentos',
        texto: 'Apagar o cartão deixa os lançamentos sem fatura e a projeção deixa de contá-los.',
        ok: 'Apagar mesmo assim', perigo: true,
      });
      if (!ok) return;
    }
    await commit((d) => { d.cards = d.cards.filter((x) => x.id !== id); });
    toast('Cartão apagado.');
    return;
  }

  const dia = (n, padrao) => Math.min(31, Math.max(1, Number(n) || padrao));
  const registro = {
    id: id || novoId('cd'),
    name: r.name || 'Cartão',
    closingDay: dia(r.closingDay, 20),
    dueDay: dia(r.dueDay, 27),
    limitCents: r.limite,
    color: r.color,
  };
  await commit((d) => {
    d.cards = id ? d.cards.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.cards, registro];
  });
  toast('Salvo.');
}

async function editarDivida(id) {
  const d0 = id ? app.doc.debts.find((x) => x.id === id) : null;
  const r = await form(d0 ? 'Editar dívida' : 'Nova dívida',
    'A taxa vem escrita na fatura e no extrato — procure "juros do rotativo" ou "juros do cheque especial". É ela que decide a ordem de pagamento.',
    [
      { name: 'name', label: 'Nome', type: 'text', value: d0?.name || '', placeholder: 'Fatura atrasada · Nubank' },
      { name: 'kind', label: 'Tipo', type: 'select', value: d0?.kind || KIND.REVOLVING,
        options: [
          { value: KIND.REVOLVING, label: 'Rotativo do cartão' },
          { value: KIND.OVERDRAFT, label: 'Cheque especial' },
          { value: KIND.LOAN, label: 'Empréstimo' },
          { value: KIND.INSTALLMENT, label: 'Parcelamento já contratado' },
        ] },
      { name: 'saldo', label: 'Quanto deve hoje', type: 'money', value: Math.abs(d0?.balanceCents || 0) },
      { name: 'taxa', label: 'Juros ao mês (%)', type: 'text', value: d0 ? String((d0.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
        hint: 'rotativo costuma ficar entre 12% e 16%; cheque especial no teto de 8%' },
      { name: 'minimoPct', label: 'Pagamento mínimo (% do saldo)', type: 'text',
        value: d0?.minPaymentRate ? String((d0.minPaymentRate * 100).toFixed(0)) : '',
        hint: 'cartão costuma exigir 15%. Deixe vazio se for valor fixo' },
      { name: 'minimoFixo', label: 'Ou mínimo fixo por mês', type: 'money', value: d0?.minPaymentCents || 0 },
    ], { ok: 'Salvar', apagar: d0 ? 'Quitei esta dívida' : null });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.debts = d.debts.filter((x) => x.id !== id); });
    toast('Uma a menos. É assim que acaba.');
    return;
  }

  const pct = (v) => {
    const n = Number(String(v).replace('%', '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n / 100 : 0;
  };

  const registro = {
    id: id || novoId('dv'),
    name: r.name || 'Dívida',
    kind: r.kind,
    balanceCents: Math.abs(r.saldo),
    monthlyRate: r.kind === KIND.INSTALLMENT ? 0 : pct(r.taxa),
    minPaymentRate: pct(r.minimoPct),
    minPaymentCents: r.minimoFixo,
    since: d0?.since || app.todayISO,
  };

  await commit((d) => {
    d.debts = id ? d.debts.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.debts, registro];
    const total = d.debts.reduce((a, x) => a + Math.abs(x.balanceCents), 0);
    if (total > (d.profile.debtPeakCents || 0)) d.profile.debtPeakCents = total;
  });
  toast('Salvo.');
}

async function editarCofrinho(id) {
  const g = id ? app.doc.goals.find((x) => x.id === id) : null;
  const r = await form(g ? 'Editar cofrinho' : 'Novo cofrinho', null, [
    { name: 'name', label: 'Para quê', type: 'text', value: g?.name || '', placeholder: 'Reserva de emergência' },
    { name: 'alvo', label: 'Quanto quer juntar', type: 'money', value: g?.targetCents || 0 },
    { name: 'guardado', label: 'Já tem', type: 'money', value: g?.savedCents || 0 },
    { name: 'mensal', label: 'Guarda por mês', type: 'money', value: g?.monthlyCents || 0 },
    { name: 'pausado', label: 'Pausado', type: 'checkbox', value: g?.status === 'pausado' },
  ], { ok: 'Salvar', apagar: g ? 'Apagar cofrinho' : null });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.goals = d.goals.filter((x) => x.id !== id); });
    toast('Apagado.');
    return;
  }

  const registro = {
    id: id || novoId('g'),
    name: r.name || 'Cofrinho',
    targetCents: r.alvo,
    savedCents: r.guardado,
    monthlyCents: r.pausado ? 0 : r.mensal,
    status: r.pausado ? 'pausado' : 'ativo',
    kind: g?.kind,
  };
  await commit((d) => {
    d.goals = id ? d.goals.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.goals, registro];
  });
  toast('Salvo.');
}

async function editarRecorrente(id, kind) {
  const r0 = id ? app.doc.recurring.find((x) => x.id === id) : null;
  const entrada = kind === 'income';
  const r = await form(
    r0 ? 'Editar' : entrada ? 'Nova entrada fixa' : 'Novo gasto fixo',
    entrada ? 'Só o que entra todo mês na mesma data. O avulso vai em Recebimentos → Avulsos.' : null,
    [
      { name: 'label', label: 'Nome', type: 'text', value: r0?.label || '', placeholder: entrada ? 'Salário' : 'Aluguel' },
      { name: 'valor', label: 'Valor', type: 'money', value: Math.abs(r0?.amountCents || 0) },
      { name: 'dia', label: 'Todo dia', type: 'number', value: r0?.dayOfMonth || 5 },
      ...(entrada ? [] : [{ name: 'categoryId', label: 'Categoria', type: 'select', value: r0?.categoryId || '', options: opcoesCategoria() }]),
    ], { ok: 'Salvar', apagar: r0 ? 'Apagar' : null });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.recurring = d.recurring.filter((x) => x.id !== id); });
    toast('Apagado.');
    return;
  }

  const registro = {
    id: id || novoId('rc'),
    label: r.label || (entrada ? 'Entrada' : 'Gasto fixo'),
    amountCents: Math.abs(r.valor),
    dayOfMonth: Math.min(28, Math.max(1, Number(r.dia) || 5)),
    kind,
    categoryId: r.categoryId || null,
    fixed: true,
  };
  await commit((d) => {
    d.recurring = id ? d.recurring.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.recurring, registro];
  });
  toast('Salvo.');
}

/**
 * A folha do lançamento por frase.
 *
 * O ditado por voz só aparece onde o navegador tem `SpeechRecognition` — e o
 * Safari do iPhone não tem. Em vez de prometer um microfone que não funciona,
 * ali o app explica que o ditado do teclado do iOS faz o mesmo trabalho.
 */
function pedirFrase() {
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;

  return sheet(
    `<h4>Lançar por frase</h4>
     <p class="sub">Escreva (ou dite pelo teclado) como você falaria:
       "gastei 85 no mercado ontem", "45,90 no posto no crédito em 3x", "recebi 300 do trader".</p>
     <div class="field">
       <label for="fr-nl">O que aconteceu</label>
       <textarea id="fr-nl" rows="2" placeholder="gastei 85 no mercado ontem"></textarea>
       <span style="font-size:11px;color:var(--muted)">${Reconhecimento
        ? 'Ou toque no microfone abaixo para ditar.'
        : 'Para ditar no iPhone: toque no microfone do próprio teclado. O Safari não dá ao app acesso ao reconhecimento de voz.'}</span>
     </div>
     ${Reconhecimento ? `<div class="btns"><button class="btn ghost" data-mic="1" style="width:100%">${icon('microfone')} Ditar</button></div>` : ''}
     <div class="btns"><button class="btn primary" data-ok="1">Interpretar</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        const campo = card.querySelector('#fr-nl');
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-ok]').onclick = () => fechar(campo.value.trim() || null);

        card.querySelector('[data-mic]')?.addEventListener('click', (ev) => {
          const rec = new Reconhecimento();
          rec.lang = 'pt-BR';
          rec.interimResults = false;
          rec.onresult = (e) => { campo.value = e.results[0][0].transcript; };
          rec.onerror = () => toast('Não consegui ouvir. Digite a frase.');
          try { rec.start(); ev.target.closest('button').textContent = 'ouvindo…'; }
          catch { toast('O microfone não está disponível aqui.'); }
        });
      },
    }
  );
}

/** Pede as doze palavras numa folha. Devolve o array ou null. */
function pedirFraseCurta(titulo, sub) {
  return sheet(
    `<h4>${esc(titulo)}</h4><p class="sub">${esc(sub)}</p>
     <div class="field"><label for="fr12">Suas doze palavras</label>
       <textarea id="fr12" rows="3" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></div>
     <div class="btns"><button class="btn primary" data-ok="1">Continuar</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-ok]').onclick = () => {
          const palavras = card.querySelector('#fr12').value.trim().split(/\s+/);
          try { phraseToBytes(palavras); } catch (e) { toast(e.message); return; }
          fechar(palavras);
        };
      },
    }
  );
}
