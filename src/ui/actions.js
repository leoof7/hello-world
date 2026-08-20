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
import { KIND, validateDebt } from '../core/debts.js';
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
 * Máscaras que impedem o campo de aceitar algo diferente do que a pessoa quis.
 *
 * Dinheiro: o valor cresce da direita, como em qualquer app de banco. Digitar
 * "10500" dá R$ 105,00 e "1050000" dá R$ 10.500,00 — sempre, sem depender de
 * onde a pessoa pôs o ponto ou a vírgula.
 *
 * Isso não é enfeite. Antes, texto livre, "10,500" era lido como R$ 10,50: a
 * pessoa queria dez mil e quinhentos e o app guardava dez reais e cinquenta.
 * Erro de mil vezes, calado, num app cuja função é dizer quanto você deve.
 *
 * Porcentagem: só dígitos e uma vírgula. Sem R$, sem ponto de milhar.
 */
function aplicarMascaras(card) {
  for (const el of card.querySelectorAll('[data-money]')) {
    const formatar = () => {
      const digitos = el.value.replace(/\D/g, '').slice(0, 12);
      el.value = formatCents(Number(digitos || 0));
      // o cursor precisa ficar no fim: o valor cresce da direita
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    };
    el.addEventListener('input', formatar);
    // Ao focar num campo zerado, esvazia: ninguém quer apagar "0,00" antes de digitar.
    el.addEventListener('focus', () => { if (Number(el.value.replace(/\D/g, '')) === 0) el.value = ''; });
    el.addEventListener('blur', () => { if (!el.value.trim()) el.value = formatCents(0); });
  }

  for (const el of card.querySelectorAll('[data-percent]')) {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^\d,.]/g, '').replace(/\./g, ',').replace(/,(?=.*,)/g, '');
    });
  }
}

/**
 * Abre uma folha com campos e devolve os valores, ou null se cancelar.
 * Campo de dinheiro entra e sai em centavos — nunca em ponto flutuante.
 */
function form(titulo, sub, campos, { ok = 'Salvar', apagar = null, aoMontar = null } = {}) {
  const corpo = campos.map((c) => {
    const id = `f-${c.name}`;
    if (c.type === 'select') {
      return `<div class="field"><label for="${id}">${esc(c.label)}</label>
        <select id="${id}" name="${c.name}">
          ${c.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(c.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    if (c.type === 'segmento') {
      return `<div class="field"><label>${esc(c.label)}</label>
        <div class="seg">
          ${c.options.map((o) => `<button type="button" class="seg-opt ${String(o.value) === String(c.value) ? 'on' : ''}" data-seg-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
        </div>
        <input type="hidden" name="${c.name}" value="${esc(c.value ?? '')}">
      </div>`;
    }
    if (c.type === 'cores') {
      return `<div class="field"><label>${esc(c.label)}</label>
        <div class="swatches" data-swatches="1">
          ${c.options.map((o) => `<button type="button" class="swatch ${String(o.value) === String(c.value) ? 'on' : ''}"
            data-swatch-value="${esc(o.value)}" style="background:var(--${esc(o.value)})" aria-label="${esc(o.label)}" title="${esc(o.label)}">${icon('check')}</button>`).join('')}
        </div>
        <input type="hidden" name="${c.name}" value="${esc(c.value ?? '')}">
      </div>`;
    }
    if (c.type === 'checkbox') {
      return `<div class="field">
        <div style="display:flex;flex-direction:row;align-items:center;gap:10px">
          <input type="checkbox" id="${id}" name="${c.name}" ${c.value ? 'checked' : ''} style="width:22px;height:22px">
          <label for="${id}" style="text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2)">${esc(c.label)}</label>
        </div>
        ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    if (c.type === 'nota') {
      return `<p style="font-size:12px;color:var(--muted);line-height:1.6;margin:18px 0 12px;
        padding-top:14px;border-top:1px solid var(--line-2)">${esc(c.label)}</p>`;
    }
    if (c.type === 'display') {
      return `<div class="field"><label>${esc(c.label)}</label>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:13px 14px;color:var(--muted);font-size:16px">${esc(c.value)}</div>
        ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    if (c.type === 'textarea') {
      return `<div class="field"><label for="${id}">${esc(c.label)}</label>
        <textarea id="${id}" name="${c.name}" rows="${c.rows || 3}" placeholder="${esc(c.placeholder || '')}">${esc(c.value ?? '')}</textarea>
        ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}</div>`;
    }
    const valor = c.type === 'money' ? formatCents(Math.abs(c.value || 0)) : (c.value ?? '');
    const modo = c.type === 'money' || c.type === 'percent' ? 'decimal'
      : c.type === 'number' ? 'numeric' : 'text';
    const tipo = c.type === 'date' ? 'date' : 'text';
    // Campo de confirmação: o teclado do iPhone não pode "ajudar". Autocapitular
    // e autocorrigir uma palavra-senha é o caminho curto para a pessoa digitar
    // certo e o app dizer que está errado.
    const teclado = c.type === 'senha-confirma'
      ? 'autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"'
      : c.type === 'text' ? 'autocapitalize="sentences"' : '';
    // Campo de número anuncia sua faixa: o teclado do iPhone não impede nada,
    // mas o valor é preso na faixa na leitura, logo abaixo.
    const faixa = c.type === 'number' && (c.min !== undefined || c.max !== undefined)
      ? `min="${c.min ?? ''}" max="${c.max ?? ''}"` : '';
    return `<div class="field"><label for="${id}">${esc(c.label)}</label>
      <input type="${tipo}" inputmode="${modo}" id="${id}" name="${c.name}" value="${esc(valor)}"
        placeholder="${esc(c.placeholder || '')}" ${teclado} ${faixa}
        ${c.type === 'money' ? 'data-money="1"' : ''} ${c.type === 'percent' ? 'data-percent="1"' : ''}>
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
        aplicarMascaras(card);
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-del]')?.addEventListener('click', () => fechar({ __apagar: true }));

        for (const grupo of card.querySelectorAll('.seg')) {
          const escondido = grupo.parentElement.querySelector('input[type="hidden"]');
          grupo.addEventListener('click', (ev) => {
            const botao = ev.target.closest('.seg-opt');
            if (!botao) return;
            grupo.querySelectorAll('.seg-opt').forEach((b) => b.classList.toggle('on', b === botao));
            escondido.value = botao.dataset.segValue;
            escondido.dispatchEvent(new Event('change'));
          });
        }

        for (const grupo of card.querySelectorAll('.swatches')) {
          const escondido = grupo.parentElement.querySelector('input[type="hidden"]');
          grupo.addEventListener('click', (ev) => {
            const botao = ev.target.closest('.swatch');
            if (!botao) return;
            grupo.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b === botao));
            escondido.value = botao.dataset.swatchValue;
            escondido.dispatchEvent(new Event('change'));
          });
        }

        aoMontar?.(card);

        card.querySelector('#frm').onsubmit = (ev) => {
          ev.preventDefault();
          const out = {};
          for (const c of campos) {
            if (c.type === 'nota' || c.type === 'display') continue;
            const el = card.querySelector(`[name="${c.name}"]`);
            if (c.type === 'money') out[c.name] = toCents(el.value);
            else if (c.type === 'number') {
              const n = Math.trunc(Number(el.value)) || 0;
              out[c.name] = Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n));
            }
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

/** Compara duas palavras ignorando caixa, acento e espaço sobrando. */
const igual = (a, b) =>
  String(a ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  === String(b ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

  // ---- antes de começar ----
  async 'pular-onboarding'({ id }) {
    await commit((d) => {
      d.profile.onboarding = d.profile.onboarding || { done: false, steps: {} };
      d.profile.onboarding.steps[id] = 'pulado';
    });
  },

  async tour() {
    if (app.doc.profile.onboarding) {
      await commit((d) => { d.profile.onboarding.tourOferecido = true; }, { redraw: false });
    }
    await tourGuiado(0);
  },
  async 'pular-tour'() {
    await commit((d) => {
      d.profile.onboarding = d.profile.onboarding || { done: false, steps: {} };
      d.profile.onboarding.tourOferecido = true;
      d.profile.onboarding.tourFeito = true;
    });
  },

  // ---- contas e cartões ----
  async 'nova-conta'() { await editarConta(null); },
  async 'editar-conta'({ id }) { await editarConta(id); },
  async 'novo-cartao'() { await editarCartao(null); },
  async 'editar-cartao'({ id }) { await editarCartao(id); },
  async 'marcar-fatura-paga'({ card, cycle }) {
    await commit((d) => {
      d.faturasPagas = d.faturasPagas || [];
      const chave = `${card}|${cycle}`;
      if (!d.faturasPagas.includes(chave)) d.faturasPagas.push(chave);
    });
    toast('Fatura marcada como paga.');
  },
  async 'desmarcar-fatura-paga'({ card, cycle }) {
    await commit((d) => {
      const chave = `${card}|${cycle}`;
      d.faturasPagas = (d.faturasPagas || []).filter((x) => x !== chave);
    });
  },

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
      [{ name: 'taxa', label: 'Taxa do novo empréstimo (% ao mês)', type: 'percent', value: '1,8', hint: 'a que o banco te ofereceu de fato' }],
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
  async 'novo-bem'() { await editarBem(null); },
  async 'editar-bem'({ id }) { await editarBem(id); },

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
    // Teto é para o que VARIA. Categoria fixa (Moradia, Contas da casa...) tem
    // valor e dia certos vindos de Gastos fixos — não entra aqui nem como
    // opção, pra não voltar a virar barra presa em "R$ 0 gasto".
    const variaveis = app.doc.categories.filter((c) => c.id !== 'renda' && !c.fixed);
    const campo = (c) => ({ name: c.id, label: c.name, type: 'money', value: app.doc.budgets?.[c.id] || 0 });

    const r = await form('Tetos por categoria',
      'Teto é para o gasto que varia — mercado, delivery, lazer. Zero significa sem teto, e teto em tudo vira teto em nada: comece pelas três que mais escapam. Moradia, contas e outros gastos fixos não aparecem aqui — eles vêm de Tudo → Gastos fixos.',
      variaveis.map(campo));
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
    if (!campos.length) { toast('Cadastre uma conta primeiro, em Finanças.'); return; }

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
      { name: 'rendaInfo', label: 'Renda mensal', type: 'display', value: brl(app.view.rendaFixaCents),
        hint: 'soma dos recebimentos fixos cadastrados em Tudo → Recebimentos. Edite lá para mudar.' },
      { name: 'minimumCostCents', label: 'Custo de vida mínimo', type: 'money', value: p.minimumCostCents,
        hint: 'só preencha se não tiver gastos fixos essenciais cadastrados — a Saúde já soma Moradia, Contas da casa etc. sozinha' },
      { name: 'emergencyTargetMonths', label: 'Meses de reserva desejados', type: 'number', value: p.emergencyTargetMonths || 6,
        min: 1, max: 24, hint: 'entre 1 e 24. Três a seis é o mais comum' },
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

  /** Instala a versão nova que já está baixada e esperando. */
  async atualizar() {
    const { instalarAtualizacao, forcarAtualizacao } = await import('./app.js');
    toast('Instalando a versão nova…');
    // instalarAtualizacao já recarrega sozinha; o forçar é para o caso de não
    // haver service worker nenhum (aba comum, primeira visita).
    if (!(await instalarAtualizacao())) await forcarAtualizacao();
  },

  /**
   * Procura versão nova na hora.
   *
   * Existe porque um app instalado na tela inicial só checa o servidor de vez
   * em quando, e depois de publicar uma correção é natural querer buscar já.
   */
  async 'buscar-atualizacao'() {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (!registro) { location.reload(); return; }

    toast('Procurando…');
    await registro.update().catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));

    if (registro.waiting || registro.installing) {
      const { instalarAtualizacao } = await import('./app.js');
      await instalarAtualizacao();
      return;
    }

    const ok = await confirmar({
      titulo: 'Você já está na versão mais nova',
      texto: 'Se mesmo assim o app parecer desatualizado, dá para jogar fora a cópia guardada e baixar tudo de novo. Isso NÃO apaga os seus dados — eles ficam no cofre, não no cache.',
      ok: 'Baixar tudo de novo',
    });
    if (!ok) return;
    const { forcarAtualizacao } = await import('./app.js');
    await forcarAtualizacao();
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
        <div class="gi"><span class="bx dot"></span>
          <div><b>Atualizações</b><i>chegam sozinhas quando você abre o app com internet.
            Atualizar troca só o programa — os seus dados ficam no cofre e não são tocados.</i></div></div>
      </div>
      <div class="btns"><button class="btn ghost" data-cal="1">${icon('relogio')} Vencimentos no Calendário</button></div>
      <div class="btns"><button class="btn ghost" data-upd="1">${icon('download')} Buscar atualização</button></div>
      <div class="btns"><button class="btn primary" data-x="1" style="width:100%">Fechar</button></div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelector('[data-cal]').onclick = () => fechar('cal');
          card.querySelector('[data-upd]').onclick = () => fechar('upd');
        },
      }
    ).then((r) => {
      if (r === 'cal') return ACOES.calendario();
      if (r === 'upd') return ACOES['buscar-atualizacao']();
    });
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

    // Limpar os dados não destrói o cofre e um backup traz tudo de volta, então
    // a folha de confirmação já basta. Pedir para digitar uma palavra aqui seria
    // fricção teatral.
    if (!eraExemplo) {
      const mesmo = await confirmar({
        titulo: 'Confirmando',
        texto: 'Isto apaga os seus lançamentos, cartões, dívidas, cofrinhos e tetos. Se você quer guardar o que está aqui, cancele e faça um backup antes.',
        ok: 'Sim, limpar agora',
        perigo: true,
      });
      if (!mesmo) { toast('Nada foi limpo.'); return; }
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
      'Escreva a palavra apagar para confirmar. Depois disso só o seu arquivo de backup traz os dados de volta.',
      [{ name: 'palavra', label: 'Escreva: apagar', type: 'senha-confirma', placeholder: 'apagar' }],
      { ok: 'Apagar definitivamente' });
    if (!confirma) return;

    // Comparação tolerante de propósito. A versão anterior exigia "APAGAR" em
    // maiúsculas, e o teclado do iPhone entrega "Apagar" — a pessoa digitava
    // certo, o app recusava e só dizia "Nada foi apagado". Confirmação tem de
    // ser barreira contra o toque distraído, não contra o autocorretor.
    if (igual(confirma.palavra, 'apagar')) {
      await db.wipe();
      location.reload();
      return;
    }
    toast('A palavra não confere — nada foi apagado.');
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

  // Débito e crédito nunca se confundem porque são coisas diferentes no
  // modelo: "onde" já É a resposta — conta é débito, cartão é crédito. O que
  // faltava era deixar isso escrito, e parar de pedir parcelas ou "entrada
  // avulsa" quando isso não faz sentido pro que está sendo lançado agora.
  // Cartão com conta vinculada é físico-único mas função dupla: crédito vai
  // pra fatura, débito desconta na hora da conta ligada a ele.
  const opcoesOrigemSaida = () => [
    ...app.doc.accounts.map((a) => ({ value: `ac:${a.id}`, label: `${a.name} — débito` })),
    ...app.doc.cards.flatMap((c) => [
      { value: `cd:${c.id}`, label: `${c.name} — crédito` },
      ...(c.accountId ? [{ value: `ac:${c.accountId}`, label: `${c.name} — débito` }] : []),
    ]),
  ];
  const opcoesOrigemEntrada = () => app.doc.accounts.map((a) => ({ value: `ac:${a.id}`, label: a.name }));

  const entradaInicial = sugestao.entrada ?? (tx ? tx.amountCents > 0 : false);
  const origemAtual = tx?.cardId ? `cd:${tx.cardId}`
    : tx?.accountId ? `ac:${tx.accountId}`
    : (entradaInicial ? opcoesOrigemEntrada() : opcoesOrigemSaida())[0]?.value;

  const r = await form(
    tx ? 'Editar lançamento' : entradaInicial ? 'Novo recebimento' : 'Novo lançamento',
    null,
    [
      { name: 'entrada', label: 'Tipo', type: 'segmento', value: entradaInicial ? 'entrada' : 'saida',
        options: [{ value: 'saida', label: 'Saída' }, { value: 'entrada', label: 'Entrada' }] },
      { name: 'description', label: 'O que foi', type: 'text', value: tx?.description ?? sugestao.description ?? '', placeholder: 'Pão de Açúcar' },
      { name: 'valor', label: 'Valor', type: 'money', value: Math.abs(tx?.amountCents ?? sugestao.amountCents ?? 0) },
      { name: 'date', label: 'Quando', type: 'date', value: tx?.date ?? sugestao.date ?? app.todayISO },
      { name: 'origem', label: entradaInicial ? 'Entrou onde' : 'Onde — débito ou crédito', type: 'select',
        value: origemAtual, options: entradaInicial ? opcoesOrigemEntrada() : opcoesOrigemSaida() },
      { name: 'categoryId', label: 'Categoria', type: 'select', value: tx?.categoryId ?? sugestao.categoryId ?? '', options: opcoesCategoria() },
      { name: 'count', label: 'Parcelas', type: 'number', value: sugestao.count || 1, min: 1, max: 48,
        hint: '1 para à vista. Só existe pagando no crédito.' },
      { name: 'extraordinary', label: 'Entrada avulsa (trader, serviço por fora)', type: 'checkbox', value: tx?.extraordinary ?? sugestao.extraordinary ?? false,
        hint: 'marque se não é o seu salário de sempre. Entra na soma do mês, mas a projeção não conta com ela se repetir mês que vem' },
    ],
    {
      ok: tx ? 'Salvar' : 'Lançar',
      apagar: tx ? 'Apagar lançamento' : null,
      aoMontar: (card) => {
        const hiddenEntrada = card.querySelector('[name="entrada"]');
        const campoOrigem = card.querySelector('#f-origem');
        const rotuloOrigem = card.querySelector('label[for="f-origem"]');
        const linhaParcelas = card.querySelector('[name="count"]').closest('.field');
        const linhaAvulsa = card.querySelector('[name="extraordinary"]').closest('.field');

        const atualizar = () => {
          const ehEntrada = hiddenEntrada.value === 'entrada';
          const opcoes = ehEntrada ? opcoesOrigemEntrada() : opcoesOrigemSaida();
          const atual = campoOrigem.value;
          campoOrigem.innerHTML = opcoes.map((o) =>
            `<option value="${esc(o.value)}" ${o.value === atual ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
          if (!opcoes.some((o) => o.value === atual)) campoOrigem.value = opcoes[0]?.value || '';
          rotuloOrigem.textContent = ehEntrada ? 'Entrou onde' : 'Onde — débito ou crédito';
          const cartaoEscolhido = !ehEntrada && campoOrigem.value.startsWith('cd:');
          linhaParcelas.style.display = cartaoEscolhido ? '' : 'none';
          linhaAvulsa.style.display = ehEntrada ? '' : 'none';
        };

        hiddenEntrada.addEventListener('change', atualizar);
        campoOrigem.addEventListener('change', atualizar);
        atualizar();
      },
    }
  );
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.transactions = d.transactions.filter((t) => t.id !== id); });
    toast('Apagado.');
    return;
  }

  if (!r.valor) { toast('Faltou o valor.'); return; }

  const entradaFinal = r.entrada === 'entrada';
  const [tipo, origemId] = r.origem.split(':');
  const cardId = tipo === 'cd' ? origemId : null;
  const accountId = tipo === 'ac' ? origemId : null;
  const sinal = entradaFinal ? 1 : -1;

  // Só barra em lançamento novo: editar um já existente compara valor novo
  // contra limite que já conta o valor antigo, e isso merece conta própria
  // que não vale a pena agora.
  if (!id && !entradaFinal) {
    if (cardId) {
      const cartao = app.view.cartoes.find((c) => c.id === cardId);
      if (cartao?.limitCents && Math.abs(r.valor) > cartao.availableCents) {
        toast(`Passa do limite — só ${brl(cartao.availableCents)} disponível no ${cartao.name}.`);
        return;
      }
    }
    if (accountId) {
      const conta = app.doc.accounts.find((a) => a.id === accountId);
      if (conta && conta.balanceCents >= 0 && Math.abs(r.valor) > conta.balanceCents) {
        const ok = await confirmar({
          titulo: 'Isso deixa a conta negativa',
          texto: `${conta.name} tem ${brl(conta.balanceCents)} disponível. Lançar ${brl(Math.abs(r.valor))} deixa o saldo em ${brl(conta.balanceCents - Math.abs(r.valor))}.`,
          ok: 'Lançar assim mesmo',
        });
        if (!ok) return;
      }
    }
  }

  // Parcelamento é caso à parte: uma compra vira N lançamentos, cada um na sua
  // fatura. Sem isso a projeção mente.
  if (!entradaFinal && cardId && r.count > 1) {
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
    extraordinary: entradaFinal && r.extraordinary,
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
  // Conta negativa costuma SER uma dívida (cheque especial) — sem isso o app
  // via um número negativo mudo e nunca contava o juro em lugar nenhum.
  const dividaLigada = id ? app.doc.debts.find((x) => x.kind === KIND.OVERDRAFT && x.accountId === id) : null;

  const r = await form(c ? 'Editar conta' : 'Nova conta', null, [
    { name: 'name', label: 'Nome', type: 'text', value: c?.name || '', placeholder: 'Nubank' },
    { name: 'type', label: 'Tipo', type: 'select', value: c?.type || 'checking',
      options: [
        { value: 'checking', label: 'Conta corrente' },
        { value: 'savings', label: 'Reserva / poupança' },
        { value: 'cash', label: 'Dinheiro' },
        { value: 'investment', label: 'Investimento' },
      ] },
    { name: 'saldo', label: 'Saldo hoje', type: 'money', value: Math.abs(c?.balanceCents || 0) },
    { name: 'negativo', label: 'Está negativo', type: 'checkbox', value: (c?.balanceCents || 0) < 0 },
    { name: 'chequeEspecial', label: 'É cheque especial (cobra juro)', type: 'checkbox', value: !!dividaLigada },
    { name: 'taxaChequeEspecial', label: 'Juros ao mês (%)', type: 'percent',
      value: dividaLigada ? String((dividaLigada.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
      hint: 'a taxa vem escrita no extrato. Cadastra (ou atualiza) a dívida em Dívidas sozinho, sem digitar de novo lá' },
  ], {
    ok: 'Salvar',
    apagar: c ? 'Apagar conta' : null,
    aoMontar: (card) => {
      const negativo = card.querySelector('[name="negativo"]');
      const cheque = card.querySelector('[name="chequeEspecial"]');
      const linhaCheque = cheque.closest('.field');
      const linhaTaxa = card.querySelector('[name="taxaChequeEspecial"]').closest('.field');
      const atualizar = () => {
        linhaCheque.style.display = negativo.checked ? '' : 'none';
        linhaTaxa.style.display = negativo.checked && cheque.checked ? '' : 'none';
      };
      negativo.addEventListener('change', atualizar);
      cheque.addEventListener('change', atualizar);
      atualizar();
    },
  });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => {
      d.accounts = d.accounts.filter((a) => a.id !== id);
      d.debts = d.debts.filter((x) => !(x.kind === KIND.OVERDRAFT && x.accountId === id));
    });
    toast('Conta apagada.');
    return;
  }

  const registro = {
    id: id || novoId('ac'),
    name: r.name || 'Conta',
    type: r.type,
    balanceCents: (r.negativo ? -1 : 1) * Math.abs(r.saldo),
  };
  const ehChequeEspecial = r.negativo && r.chequeEspecial;

  await commit((d) => {
    d.accounts = id ? d.accounts.map((a) => (a.id === id ? { ...a, ...registro } : a)) : [...d.accounts, registro];

    d.debts = d.debts.filter((x) => !(x.kind === KIND.OVERDRAFT && x.accountId === registro.id));
    if (ehChequeEspecial) {
      d.debts.push({
        id: dividaLigada?.id || novoId('dv'),
        name: `Cheque especial · ${registro.name}`,
        kind: KIND.OVERDRAFT,
        accountId: registro.id,
        balanceCents: Math.abs(r.saldo),
        monthlyRate: pctParaFracao(r.taxaChequeEspecial),
        minPaymentRate: dividaLigada?.minPaymentRate || 0,
        minPaymentCents: dividaLigada?.minPaymentCents || 0,
        since: dividaLigada?.since || app.todayISO,
      });
    }
  });
  toast(ehChequeEspecial ? 'Salvo — a dívida do cheque especial também foi atualizada.' : 'Salvo.');
}

async function editarCartao(id) {
  const c = id ? app.doc.cards.find((x) => x.id === id) : null;
  const r = await form(c ? 'Editar cartão' : 'Novo cartão',
    'O dia do fechamento é o que decide em qual fatura cada compra cai. Compra feita NO dia do fechamento já entra na fatura seguinte.',
    [
      { name: 'name', label: 'Nome', type: 'text', value: c?.name || '', placeholder: 'Nubank' },
      { name: 'closingDay', label: 'Fecha dia', type: 'number', value: c?.closingDay || 20, min: 1, max: 31 },
      { name: 'dueDay', label: 'Vence dia', type: 'number', value: c?.dueDay || 27, min: 1, max: 31 },
      { name: 'limite', label: 'Limite', type: 'money', value: c?.limitCents || 0 },
      { name: 'color', label: 'Cor', type: 'cores', value: c?.color || 'blue',
        options: [
          { value: 'red', label: 'Vermelho' }, { value: 'blue', label: 'Azul' },
          { value: 'jade', label: 'Verde' }, { value: 'steel', label: 'Prata' },
          { value: 'amber', label: 'Âmbar' }, { value: 'violet', label: 'Roxo' },
          { value: 'graphite', label: 'Grafite' },
        ] },
      { name: 'accountId', label: 'Também é débito de', type: 'select', value: c?.accountId || '',
        options: [{ value: '', label: 'Não — só crédito' }, ...app.doc.accounts.map((a) => ({ value: a.id, label: a.name }))],
        hint: 'se o mesmo cartão físico debita direto de uma conta, escolha ela aqui — o Lançar passa a oferecer as duas opções' },
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
    accountId: r.accountId || null,
  };
  await commit((d) => {
    d.cards = id ? d.cards.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.cards, registro];
  });
  toast('Salvo.');
}

const pctParaFracao = (v) => {
  const n = Number(String(v).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n / 100 : 0;
};

/**
 * Traduz o motivo que o núcleo apontou numa frase que diz o que fazer.
 *
 * O engano que isto barra: digitar reais no campo de por cento. Foi assim que
 * uma dívida de R$ 3.732 passou a exigir R$ 136.232 de mínimo — "3650" lido
 * como 3650% do saldo.
 */
function conferirDivida(r) {
  const motivo = validateDebt({
    balanceCents: Math.abs(r.saldo || 0),
    monthlyRate: r.kind === KIND.INSTALLMENT ? 0 : pctParaFracao(r.taxa),
    minPaymentRate: pctParaFracao(r.minimoPct),
    minPaymentCents: r.minimoFixo,
  });

  return {
    'minimo-acima-de-100': `${r.minimoPct}% do saldo não existe — o máximo é 100. Se ${r.minimoPct} é um valor em reais, apague daqui e use o campo de baixo.`,
    'juros-acima-de-100': `${r.taxa}% ao mês custaria mais que a dívida inteira todo mês. Rotativo fica perto de 15.`,
    'minimo-maior-que-saldo': 'O mínimo fixo ficou maior que o saldo devedor. Confira os dois valores.',
  }[motivo] || null;
}

async function editarDivida(id) {
  const d0 = id ? app.doc.debts.find((x) => x.id === id) : null;

  // Começa com o que já está salvo e passa a valer o que a pessoa digitou: se
  // um campo estiver errado, a folha volta com tudo preenchido. Fechar o
  // formulário e jogar fora seis campos por causa de um número é o tipo de
  // coisa que faz desistir de cadastrar.
  let atual = {
    name: d0?.name || '',
    kind: d0?.kind || KIND.REVOLVING,
    saldo: Math.abs(d0?.balanceCents || 0),
    taxa: d0 ? String((d0.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
    minimoPct: d0?.minPaymentRate ? String((d0.minPaymentRate * 100).toFixed(0)) : '',
    minimoFixo: d0?.minPaymentCents || 0,
  };
  let erro = null;

  while (true) {
    const r = await form(d0 ? 'Editar dívida' : 'Nova dívida',
      erro || 'A taxa vem escrita na fatura e no extrato — procure "juros do rotativo" ou "juros do cheque especial". É ela que decide a ordem de pagamento.',
      [
        { name: 'name', label: 'Nome', type: 'text', value: atual.name, placeholder: 'Fatura atrasada · Nubank' },
        { name: 'kind', label: 'Tipo', type: 'select', value: atual.kind,
          options: [
            { value: KIND.REVOLVING, label: 'Rotativo do cartão' },
            { value: KIND.OVERDRAFT, label: 'Cheque especial' },
            { value: KIND.LOAN, label: 'Empréstimo' },
            { value: KIND.INSTALLMENT, label: 'Parcelamento já contratado' },
          ] },
        { name: 'saldo', label: 'Quanto deve hoje', type: 'money', value: atual.saldo },
        { name: 'taxa', label: 'Juros ao mês (%)', type: 'percent', value: atual.taxa,
          hint: 'só o número. Rotativo costuma ficar entre 12 e 16; cheque especial no teto de 8' },
        { name: 'minimoPct', label: 'Mínimo: quantos POR CENTO do saldo', type: 'percent', value: atual.minimoPct,
          hint: 'só o número, sem R$. Cartão costuma exigir 15. Se o seu mínimo é um valor fixo em reais, deixe vazio e use o campo abaixo' },
        { name: 'minimoFixo', label: 'Ou mínimo fixo por mês, em reais', type: 'money', value: atual.minimoFixo },
      ], { ok: 'Salvar', apagar: d0 ? 'Quitei esta dívida' : null });

    if (!r) return;

    if (r.__apagar) {
      await commit((d) => { d.debts = d.debts.filter((x) => x.id !== id); });
      toast('Uma a menos. É assim que acaba.');
      return;
    }

    atual = r;
    erro = conferirDivida(r);
    if (erro) { toast(erro); continue; }

    const registro = {
      id: id || novoId('dv'),
      name: r.name || 'Dívida',
      kind: r.kind,
      balanceCents: Math.abs(r.saldo),
      monthlyRate: r.kind === KIND.INSTALLMENT ? 0 : pctParaFracao(r.taxa),
      minPaymentRate: pctParaFracao(r.minimoPct),
      minPaymentCents: r.minimoFixo,
      since: d0?.since || app.todayISO,
    };

    await commit((d) => {
      d.debts = id ? d.debts.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.debts, registro];
      const total = d.debts.reduce((a, x) => a + Math.abs(x.balanceCents), 0);
      if (total > (d.profile.debtPeakCents || 0)) d.profile.debtPeakCents = total;
    });
    toast('Salvo.');
    return;
  }
}

async function editarCofrinho(id) {
  const g = id ? app.doc.goals.find((x) => x.id === id) : null;
  const r = await form(g ? 'Editar meta' : 'Nova meta ou cofrinho', null, [
    { name: 'name', label: 'Para quê', type: 'text', value: g?.name || '', placeholder: 'Reserva de emergência' },
    { name: 'alvo', label: 'Quanto quer juntar', type: 'money', value: g?.targetCents || 0 },
    { name: 'guardado', label: 'Já tem', type: 'money', value: g?.savedCents || 0 },
    { name: 'mensal', label: 'Guarda por mês', type: 'money', value: g?.monthlyCents || 0 },
    { name: 'prazo', label: 'Prazo (opcional)', type: 'date', value: g?.deadline || '' },
    { name: 'pausado', label: 'Pausado', type: 'checkbox', value: g?.status === 'pausado' },
  ], { ok: 'Salvar', apagar: g ? 'Apagar' : null });
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
    deadline: r.prazo || null,
    kind: g?.kind,
  };
  await commit((d) => {
    d.goals = id ? d.goals.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.goals, registro];
  });
  toast('Salvo.');
}

async function editarBem(id) {
  const b = id ? app.doc.assets.find((x) => x.id === id) : null;
  const r = await form(b ? 'Editar bem' : 'Novo bem', 'Carro, moto, casa — o que é seu além do que está em conta.', [
    { name: 'name', label: 'O que é', type: 'text', value: b?.name || '', placeholder: 'Carro' },
    { name: 'valor', label: 'Valor estimado', type: 'money', value: b?.valueCents || 0 },
  ], { ok: 'Salvar', apagar: b ? 'Apagar' : null });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.assets = (d.assets || []).filter((x) => x.id !== id); });
    toast('Apagado.');
    return;
  }

  const registro = { id: id || novoId('bem'), name: r.name || 'Bem', valueCents: r.valor };
  await commit((d) => {
    d.assets = id
      ? (d.assets || []).map((x) => (x.id === id ? { ...x, ...registro } : x))
      : [...(d.assets || []), registro];
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
      { name: 'dia', label: 'Todo dia', type: 'number', value: r0?.dayOfMonth || 5, min: 1, max: 28,
        hint: 'até 28, para o dia existir em todos os meses' },
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
 * O botão de ditado aparece sempre que o navegador expõe `SpeechRecognition`
 * — inclusive no Safari do iPhone em versões recentes. Mas o reconhecimento
 * do Safari é instável: às vezes concede a permissão e nunca dispara
 * `onresult` nem `onerror`, o que travava o botão em "ouvindo…" para sempre e
 * só saía apagando a permissão de áudio na mão, no Ajustes do iPhone. Por
 * isso: `interimResults` liga para mostrar o texto sendo reconhecido ao vivo
 * (a pessoa vê que está ouvindo de verdade, não só confia num rótulo), o
 * próprio botão vira "Parar" enquanto ouve — tocar de novo encerra na hora —
 * e um tempo limite força o reset mesmo se nada disso disparar.
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
        : 'Para ditar no iPhone: toque no microfone do próprio teclado. Este navegador não dá ao app acesso ao reconhecimento de voz.'}</span>
     </div>
     ${Reconhecimento ? `<div class="btns"><button class="btn ghost" data-mic="1" style="width:100%">${icon('microfone')} Ditar</button></div>` : ''}
     <div class="btns"><button class="btn primary" data-ok="1">Registrar</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        const campo = card.querySelector('#fr-nl');
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-ok]').onclick = () => fechar(campo.value.trim() || null);

        const botaoMic = card.querySelector('[data-mic]');
        botaoMic?.addEventListener('click', (ev) => {
          const botao = ev.target.closest('button');

          // Já está ouvindo: o toque agora é "parar", não começar de novo.
          if (botao.dataset.ouvindo) {
            try { botao._rec?.stop(); } catch { /* já parado */ }
            return;
          }

          const rec = new Reconhecimento();
          botao._rec = rec;
          rec.lang = 'pt-BR';
          rec.interimResults = true;

          let resolvido = false;
          const encerrar = () => {
            if (resolvido) return;
            resolvido = true;
            clearTimeout(tempoLimite);
            delete botao.dataset.ouvindo;
            botao._rec = null;
            botao.innerHTML = `${icon('microfone')} Ditar`;
          };
          const tempoLimite = setTimeout(() => {
            try { rec.stop(); } catch { /* já parado */ }
            encerrar();
            toast('Não consegui ouvir a tempo. Digite a frase.');
          }, 12000);

          // Interim ou final, mostra o que já reconheceu — assim dá para ver
          // que o microfone está de fato captando, em vez de confiar cego
          // num rótulo "ouvindo…" que pode estar travado por trás.
          rec.onresult = (e) => { campo.value = e.results[0][0].transcript; };
          rec.onerror = () => toast('Não consegui ouvir. Digite a frase.');
          rec.onend = encerrar;

          try {
            rec.start();
            botao.dataset.ouvindo = '1';
            botao.innerHTML = `${icon('microfone')} Toque para parar`;
          } catch {
            encerrar();
            toast('O microfone não está disponível aqui.');
          }
        });
      },
    }
  );
}

/**
 * O tour guiado: passa pelas abas de verdade, uma de cada vez, com uma folha
 * explicando o que aquela tela mostra. Não é texto imaginando a tela — a
 * pessoa já está olhando pra ela enquanto lê.
 */
const TOUR_PASSOS = [
  { screen: 'painel', titulo: 'Painel', texto: 'Sua tela de todo dia. Lança o gasto na hora, vê o resumo do momento e quanto falta para sair das dívidas.' },
  { screen: 'cartoes', titulo: 'Finanças', texto: 'Suas contas e cartões, a fatura aberta de cada um, e o muro de parcelas — quanto já está comprometido nos próximos meses.' },
  { screen: 'investimentos', titulo: 'Investimentos', texto: 'Contas de investimento, cofrinhos e metas com prazo, e os bens que também contam no seu patrimônio — carro, moto, casa.' },
  { screen: 'analise', titulo: 'Saúde', texto: 'Seu diagnóstico financeiro: custo de vida mínimo, reserva de emergência, e os tetos do mês por categoria.' },
  { screen: 'tudo', titulo: 'Tudo', texto: 'Dívidas, recebimentos, gastos fixos, importar extrato do banco e fazer backup — o que não cabe nas outras abas.' },
];

async function tourGuiado(indice = 0) {
  if (indice >= TOUR_PASSOS.length) {
    if (app.doc.profile.onboarding) {
      await commit((d) => { d.profile.onboarding.tourFeito = true; }, { redraw: false });
    }
    toast('Tour terminado — agora é usar.');
    return;
  }

  const passo = TOUR_PASSOS[indice];
  go(passo.screen);

  const r = await sheet(
    `<h4>${esc(passo.titulo)}</h4>
     <p class="sub">${esc(passo.texto)}</p>
     <div class="btns"><button class="btn primary" data-ok="1">${indice === TOUR_PASSOS.length - 1 ? 'Terminar' : 'Próximo'}</button>
       <button class="btn ghost" data-x="1">Pular tour</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-ok]').onclick = () => fechar('proximo');
        card.querySelector('[data-x]').onclick = () => fechar(null);
      },
    }
  );

  if (r === 'proximo') return tourGuiado(indice + 1);

  if (app.doc.profile.onboarding) {
    await commit((d) => { d.profile.onboarding.tourFeito = true; }, { redraw: false });
  }
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
