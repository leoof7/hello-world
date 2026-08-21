// O que acontece quando você toca em alguma coisa.
//
// Tudo passa por delegação de evento no container: a tela é redesenhada
// inteira a cada mudança, então pendurar ouvinte em cada botão seria trabalho
// jogado fora. Um ouvinte no topo resolve.

import { app, commit, go, draw } from './app.js';
import { toCents, brl, formatCents, sum } from '../core/money.js';
import { monthKey, formatShort, formatMonthKey } from '../core/dates.js';
import { parseEntry, splitEntries } from '../core/parse.js';
import { expand } from '../core/installments.js';
import { diasDoRecorrente, mensalDoRecorrente } from '../core/projection.js';
import { learn } from '../core/categorize.js';
import { KIND as KIND_DIVIDA, validateDebt, ativa, somenteAtivas } from '../core/debts.js';
import { KIND, TIPOS, validarCartao, permiteParcelar, ehBeneficio, ehDebito } from '../core/cards.js';
import { podeComprar, custoDoHabito } from '../core/insights.js';
import * as avisos from '../data/avisos.js';
import { QUIZ } from '../core/perfil.js';
import { CORES, aplicarCor } from './tema.js';
import { MERCHANTS } from '../seed/categories.js';
import * as db from '../data/db.js';
import { buildBackup, readBackup, openEnvelope, deliver, backupFilename, backupStatus, markDone, readFile } from '../data/backup.js';
import { phraseToBytes, limparFrase } from '../data/recovery.js';
import * as csv from '../io/csv.js';
import * as ofx from '../io/ofx.js';
import { buildCalendar } from '../io/ics.js';
import { statementsOf } from './state.js';
import { esc, icon, toast, sheet, confirmar, entregar, colunaDia, pilulasDaLinha } from './dom.js';
import { botaoColar, colarNoCampo } from './frase.js';

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
    if (c.type === 'pilulas') {
      return `<div class="field"><label>${esc(c.label)}</label>
        <div class="pilulas" data-pilulas="1">
          ${c.options.map((o) => `<button type="button" class="pilula c-${esc(o.cor || 'chip')} ${String(o.value) === String(c.value) ? 'on' : ''}"
            data-pilula-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
        </div>
        <input type="hidden" name="${c.name}" value="${esc(c.value ?? '')}">
      </div>`;
    }
    if (c.type === 'cores') {
      return `<div class="field"><label>${esc(c.label)}</label>
        <div class="swatches" data-swatches="1">
          ${c.options.map((o) => `<button type="button" class="swatch ${String(o.value) === String(c.value) ? 'on' : ''}"
            data-swatch-value="${esc(o.value)}" style="background:${o.hex ? esc(o.hex) : `var(--${esc(o.value)})`}" aria-label="${esc(o.label)}" title="${esc(o.label)}">${icon('check')}</button>`).join('')}
        </div>
        <input type="hidden" name="${c.name}" value="${esc(c.value ?? '')}">
      </div>`;
    }
    if (c.type === 'cor-livre') {
      return `<div class="field"><label for="${id}">${esc(c.label)}</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="color" id="${id}" name="${c.name}" value="${esc(c.value || '#0a7b5a')}"
            style="width:56px;height:44px;padding:2px;border-radius:12px;border:1px solid var(--line);background:var(--surface)">
          <button type="button" class="btn ghost" data-limpar-cor="${c.name}" style="flex:1;padding:11px">Usar uma das prontas</button>
        </div>
        ${c.hint ? `<span style="font-size:11px;color:var(--muted)">${esc(c.hint)}</span>` : ''}
        <input type="hidden" name="${c.name}__usar" value="${c.value ? '1' : ''}">
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

        for (const grupo of card.querySelectorAll('.pilulas')) {
          const escondido = grupo.parentElement.querySelector('input[type="hidden"]');
          grupo.addEventListener('click', (ev) => {
            const botao = ev.target.closest('.pilula');
            if (!botao) return;
            grupo.querySelectorAll('.pilula').forEach((b) => b.classList.toggle('on', b === botao));
            escondido.value = botao.dataset.pilulaValue;
            escondido.dispatchEvent(new Event('change'));
          });
        }

        // Escolher um preset desliga a cor livre, e mexer na cor livre desliga
        // o preset — senão os dois ficam "ligados" e ninguém sabe qual vale.
        for (const botao of card.querySelectorAll('[data-limpar-cor]')) {
          botao.onclick = () => {
            const usar = card.querySelector(`[name="${botao.dataset.limparCor}__usar"]`);
            if (usar) usar.value = '';
            botao.textContent = 'Usando uma das prontas';
          };
        }
        for (const entrada of card.querySelectorAll('input[type="color"]')) {
          entrada.addEventListener('input', () => {
            const usar = card.querySelector(`[name="${entrada.name}__usar"]`);
            if (usar) usar.value = '1';
            const limpar = card.querySelector(`[data-limpar-cor="${entrada.name}"]`);
            if (limpar) limpar.textContent = 'Usar uma das prontas';
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
            if (c.type === 'cor-livre') {
              const usar = card.querySelector(`[name="${c.name}__usar"]`)?.value;
              out[c.name] = usar ? card.querySelector(`[name="${c.name}"]`).value : '';
              continue;
            }
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

/**
 * Um item da fila. Devolve true se categorizou (a fila segue) e false se a
 * pessoa cancelou (a fila para).
 */
async function categorizarUm(id) {
  const tx = app.doc.transactions.find((t) => t.id === id);
  if (!tx) return false;

  const sugerida = app.view.revisao.find((t) => t.id === id)?.categoryId || '';
  const naFila = app.view.revisao.length;
  const entrada = tx.amountCents > 0;

  const r = await form(
    tx.description,
    `${entrada ? 'Entrou' : 'Saiu'} ${brl(Math.abs(tx.amountCents))} · ${formatShort(tx.date)}${naFila > 1 ? ` · ${naFila} na fila` : ''}`,
    [
      { name: 'categoryId', label: 'Categoria', type: 'pilulas', value: sugerida, options: opcoesCategoriaComCor() },
      { name: 'sempre', label: 'Guardar para os próximos desta contraparte', type: 'checkbox', value: true },
    ],
    { ok: 'Categorizar' }
  );
  if (!r) return false;

  const categoryId = r.categoryId === NOVA_CATEGORIA ? await resolverCategoria(r.categoryId) : r.categoryId;
  if (r.categoryId === NOVA_CATEGORIA && !categoryId) return false; // desistiu de criar

  await commit((d) => {
    const alvo = d.transactions.find((t) => t.id === id);
    if (alvo) alvo.categoryId = categoryId || null;
    if (r.sempre && categoryId) d.memory = learn(d.memory || {}, tx, { categoryId });
  });
  return true;
}

/** `__nova` abre o campo de criar na hora — categorizar sem sair pra outra tela. */
const NOVA_CATEGORIA = '__nova';

const opcoesCategoria = () => [
  { value: '', label: 'sem categoria' },
  ...app.doc.categories.map((c) => ({ value: c.id, label: c.name })),
  { value: NOVA_CATEGORIA, label: '+ Criar categoria…' },
];

/** As mesmas opções, mas carregando a cor de cada categoria para as pílulas. */
const opcoesCategoriaComCor = () => [
  ...app.doc.categories.map((c) => ({ value: c.id, label: c.name, cor: c.color || 'chip' })),
  { value: NOVA_CATEGORIA, label: '+ Criar', cor: 'nova' },
];

/**
 * Troca `__nova` pela categoria recém-criada. Devolve o id final, ou null se
 * a pessoa desistiu — quem chama decide o que fazer com isso.
 */
async function resolverCategoria(valor) {
  if (valor !== NOVA_CATEGORIA) return valor;

  const r = await form('Nova categoria', 'O nome é seu — "Pix", "Vó", "Bicicleta", o que fizer sentido.', [
    { name: 'nome', label: 'Nome', type: 'text', placeholder: 'Pix' },
    { name: 'essential', label: 'É essencial (não dá pra cortar)', type: 'checkbox', value: false,
      hint: 'entra no custo de vida mínimo, que é a base da reserva de emergência' },
  ], { ok: 'Criar' });
  if (!r?.nome?.trim()) return null;

  const nome = r.nome.trim();
  const existente = app.doc.categories.find((c) => igual(c.name, nome));
  if (existente) { toast(`"${existente.name}" já existe.`); return existente.id; }

  const nova = {
    id: novoId('cat'),
    name: nome,
    color: 'jade',
    essential: !!r.essential,
    fixed: false,
    custom: true,
  };
  await commit((d) => { d.categories = [...d.categories, nova]; }, { redraw: false });
  return nova.id;
}

// Usada na importação de extrato: ali qualquer origem serve, inclusive o
// extrato do vale. O rótulo diz o tipo porque "(cartão)" num vale-refeição
// faz a pessoa achar que escolheu errado.
const opcoesOrigem = () => [
  ...app.doc.accounts.map((a) => ({ value: `ac:${a.id}`, label: `${a.name} (conta)` })),
  ...app.doc.cards.map((c) => ({
    value: `cd:${c.id}`,
    label: `${c.name} (${ehBeneficio(c) ? 'vale' : ehDebito(c) ? 'débito' : 'cartão'})`,
  })),
];

const novoId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** "todo dia 5" ou "dias 5 e 20 · 2x no mês" — o que a pessoa precisa conferir. */
function quandoRepete(r) {
  const dias = diasDoRecorrente(r);
  return dias.length > 1 ? `dias ${dias.join(' e ')} · 2x no mês` : `todo dia ${dias[0]}`;
}

/** Compara duas palavras ignorando caixa, acento e espaço sobrando. */
const igual = (a, b) =>
  String(a ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  === String(b ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Abre o seletor de arquivos e devolve o conteúdo em texto. */
function escolherArquivo(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // `accept` só quando quem chama pediu. Filtro herdado de uma chamada
    // anterior esconderia o arquivo certo sem ninguém entender por quê.
    if (accept) input.accept = accept;
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
  /**
   * Escolher o tema, não adivinhar qual vem depois.
   *
   * Antes isto era um ciclo auto → escuro → claro a cada toque: para sair do
   * escuro no meio da noite a pessoa tinha que passar pelo claro. Agora é uma
   * folha com as três opções, e a que está valendo aparece marcada.
   */
  async tema() {
    const atual = app.doc.settings.theme || 'auto';
    const opcoes = [
      { id: 'auto', ic: 'engrenagem', nome: 'Seguir o sistema', sub: 'muda junto com o iPhone' },
      { id: 'light', ic: 'grafico', nome: 'Claro', sub: 'papel quente, com um fio da sua cor' },
      { id: 'dark', ic: 'lua', nome: 'Escuro', sub: 'fundo puxado para a sua cor' },
    ];

    const escolha = await sheet(
      `<h4>Tema</h4><p class="sub">Vale para o app inteiro. A sua cor continua a mesma nos dois.</p>
       <div class="list">${opcoes.map((o) => `
         <button class="row" data-tema="${o.id}">
           <div class="ic ${o.id === atual ? 'j' : ''}">${icon(o.ic)}</div>
           <div class="bd"><div class="t">${esc(o.nome)}</div><div class="s">${esc(o.sub)}</div></div>
           ${o.id === atual ? `<span class="arr">${icon('check')}</span>` : ''}
         </button>`).join('')}</div>
       <div class="btns"><button class="btn ghost" data-x="1" style="width:100%">Fechar</button></div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelectorAll('[data-tema]').forEach((b) => {
            b.onclick = () => fechar(b.dataset.tema);
          });
        },
      }
    );

    if (!escolha || escolha === atual) return;

    if (escolha === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = escolha;
    // A mesma cor precisa de tom diferente em fundo claro e escuro — sem isto,
    // trocar o tema deixaria a cor escolhida sumindo ou berrando.
    aplicarCor({ corId: app.doc.settings?.corId, corLivre: app.doc.settings?.corLivre });
    await commit((d) => { d.settings.theme = escolha; });
    toast(escolha === 'auto' ? 'Tema: segue o sistema' : escolha === 'dark' ? 'Tema escuro' : 'Tema claro');
  },

  privacidade() {
    app.privacy = !app.privacy;
    draw();
  },

  /**
   * Tira o aviso da tela — sem apagar o problema.
   *
   * Ele continua contando na campainha. Quem some com um aviso de conta
   * ficando negativa não quer que o problema suma; quer que a tela pare de
   * gritar enquanto resolve. Apagar de verdade seria o app esconder dinheiro.
   */
  async 'dispensar-aviso'({ id }) {
    if (!id) return;
    await commit((d) => {
      const lista = new Set(d.avisosDispensados || []);
      lista.add(id);
      // Não deixa crescer para sempre: aviso é do dia, e id que não existe
      // mais só ocupa espaço no cofre.
      d.avisosDispensados = [...lista].slice(-60);
    });
    toast('Fora da tela. Continua na campainha.');
  },

  /** A campainha: tudo que está valendo hoje, inclusive o que saiu da tela. */
  async 'central-avisos'() {
    const v = app.view;
    if (!v.avisos.length) {
      toast(v.revisao.length ? `${v.revisao.length} lançamentos esperando revisão.` : 'Nenhum aviso agora.');
      if (v.revisao.length) go('revisao');
      return;
    }

    const escolha = await sheet(
      `<h4>Avisos</h4>
       <p class="sub">O que está valendo hoje. Os que você tirou da tela continuam aqui.</p>
       <div class="list">${v.avisos.map((a) => `
         <button class="row" data-ir="${esc(a.tela)}">
           <div class="ic ${a.urgencia >= 90 ? 'r' : 'a'}">${icon(a.urgencia >= 90 ? 'alerta' : 'sino')}</div>
           <div class="bd"><div class="t">${esc(a.titulo)}</div>
             <div class="s">${pilulasDaLinha([
               a.texto,
               v.avisosDispensados.some((x) => x.id === a.id) ? 'fora da tela' : null,
             ])}</div></div>
           <span class="arr">${icon('seta')}</span>
         </button>`).join('')}</div>
       <div class="btns">
         ${v.avisosDispensados.length ? '<button class="btn ghost" data-voltar="1">Trazer todos de volta</button>' : ''}
         <button class="btn ghost" data-x="1">Fechar</button>
       </div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelector('[data-voltar]')?.addEventListener('click', () => fechar('voltar'));
          card.querySelectorAll('[data-ir]').forEach((b) => { b.onclick = () => fechar(b.dataset.ir); });
        },
      }
    );

    if (!escolha) return;
    if (escolha === 'voltar') {
      await commit((d) => { d.avisosDispensados = []; });
      toast('Todos de volta na tela.');
      return;
    }
    go(escolha);
  },

  // ---- lançamentos ----
  async novo() { await editarLancamento(null); },
  async editar({ id }) { await editarLancamento(id); },

  async falar() {
    const frase = await pedirFrase();
    if (!frase) return;
    await interpretarFrase(frase);
  },

  /**
   * A fila de revisão: categorizou um, o próximo já sobe.
   *
   * Antes cada item abria e fechava sozinho, e com dezenove para revisar era
   * dezenove vezes procurar o próximo na lista. Agora só para quando você
   * cancela ou quando a fila acaba.
   */
  async categorizar({ id }) {
    let atual = id;
    let feitos = 0;

    while (atual) {
      const ok = await categorizarUm(atual, feitos);
      if (!ok) break;
      feitos++;
      // o que acabou de sair não pode voltar como "próximo" — se a pessoa
      // escolheu "sem categoria", ele continua na fila e prenderia o laço
      atual = app.view.revisao.find((t) => t.id !== atual)?.id || null;
    }

    if (feitos === 0) return;
    toast(app.view.revisao.length
      ? `${feitos} categorizado${feitos === 1 ? '' : 's'} · faltam ${app.view.revisao.length}`
      : 'Fila vazia — tudo categorizado.');
  },

  /**
   * "Posso comprar isso?" — a pergunta que o app tinha tudo para responder e
   * não respondia. Projeção, limite e reserva já existiam; faltava juntar.
   */
  async simular() {
    const opcoes = [
      { value: 'ac', label: 'À vista, da conta' },
      ...app.doc.cards.map((c) => ({ value: `cd:${c.id}`, label: `No ${c.name}` })),
    ];

    const r = await form('Posso comprar isso?',
      'O app já sabe seu saldo, sua projeção e seu limite. Diz aí o que você quer comprar.',
      [
        { name: 'valor', label: 'Quanto custa', type: 'money', value: 0 },
        { name: 'como', label: 'Como pagaria', type: 'select', value: opcoes[0]?.value, options: opcoes },
        { name: 'parcelas', label: 'Em quantas vezes', type: 'number', value: 1, min: 1, max: 24 },
      ], { ok: 'Consultar' });
    if (!r?.valor) return;

    const cartaoId = r.como.startsWith('cd:') ? r.como.slice(3) : null;
    const cartao = cartaoId ? app.view.cartoes.find((c) => c.id === cartaoId) : null;
    const veredito = podeComprar({
      valorCents: r.valor,
      parcelas: cartao ? r.parcelas : 1,
      projecao: app.view.projecao,
      cartao,
      saldoCents: app.view.saldoCents,
      reservaCents: app.view.reservaCents,
      todayISO: app.todayISO,
    });

    const cabe = cartao ? veredito.parcelado.cabe : veredito.aVista.cabe;
    const linhas = cartao
      ? [
          ['Parcela', `${r.parcelas}x de ${brl(veredito.parcelaCents)}`],
          ['Limite livre', brl(cartao.availableCents)],
          ['Depois da compra', brl(Math.max(0, cartao.availableCents - r.valor))],
        ]
      : [
          ['Saldo hoje', brl(app.view.saldoCents)],
          ['Depois da compra', brl(veredito.aVista.saldoDepoisCents)],
          ['Pior dia dos 90', brl(veredito.aVista.piorDiaDepoisCents)],
        ];

    await sheet(
      `<h4>${cabe ? 'Cabe' : 'Não cabe'}</h4>
       <p class="sub">${cabe
        ? 'Pelos seus números, essa compra passa sem te deixar no vermelho.'
        : esc(veredito.motivos[0] ? `Não cabe porque ${veredito.motivos[0]}.` : 'Essa compra te deixa negativo.')}</p>
       <div class="ze-resumo">
         ${linhas.map(([rotulo, valor]) => `<div class="ft" style="margin:0 0 6px">
           <span style="font-size:11.5px;color:var(--muted)">${esc(rotulo)}</span>
           <span class="num" style="font-size:13px">${esc(valor)}</span></div>`).join('')}
       </div>
       ${!cabe && veredito.motivos.length > 1 ? `<p class="sub">${esc(veredito.motivos.slice(1).join(' · '))}</p>` : ''}
       <div class="btns"><button class="btn ${cabe ? 'primary' : 'ghost'}" data-x="1" style="width:100%">Entendi</button></div>`,
      { onMount: (card, fechar) => { card.querySelector('[data-x]').onclick = () => fechar(null); } }
    );
  },

  /** A cor do app. Cinco prontas mais a sua, com o texto por cima calculado. */
  async cor() {
    const atualId = app.doc.settings?.corId || 'jade';
    const atualLivre = app.doc.settings?.corLivre || '';

    const r = await form('Cor do app',
      'A cor pinta botões, gráficos e destaques. A "sua cor" aceita qualquer tom — o app escolhe sozinho se o texto por cima fica claro ou escuro, para nada ficar ilegível.',
      [
        { name: 'corId', label: 'Cores prontas', type: 'cores', value: atualLivre ? '' : atualId,
          options: CORES.map((c) => ({ value: c.id, label: c.nome, hex: c.base })) },
        { name: 'corLivre', label: 'Ou a sua cor', type: 'cor-livre', value: atualLivre,
          hint: 'deixe vazio para usar uma das prontas' },
      ]);
    if (!r) return;

    await commit((d) => {
      d.settings.corId = r.corId || 'jade';
      d.settings.corLivre = r.corLivre || null;
    }, { redraw: false });

    aplicarCor({ corId: app.doc.settings.corId, corLivre: app.doc.settings.corLivre });
    draw();
    toast('Cor trocada.');
  },

  /**
   * Foto de perfil. Vira data URI e entra no cofre cifrado como todo o resto —
   * é reduzida antes porque uma foto de celular tem megabytes e o cofre inteiro
   * é cifrado e decifrado a cada gravação.
   */
  async foto() {
    if (app.doc.profile.foto) {
      const trocar = await confirmar({
        titulo: 'Trocar a foto?',
        texto: 'Você já tem uma foto. Pode escolher outra ou remover a atual.',
        ok: 'Escolher outra',
      });
      if (!trocar) {
        await commit((d) => { delete d.profile.foto; });
        toast('Foto removida.');
        return;
      }
    }

    const arquivo = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
    if (!arquivo) return;

    try {
      const dataUri = await reduzirImagem(arquivo, 256);
      await commit((d) => { d.profile.foto = dataUri; });
      toast('Foto salva — ela fica cifrada aqui dentro.');
    } catch {
      toast('Não consegui ler essa imagem.');
    }
  },

  /** As três perguntas do começo. Só chute inicial — os números mandam depois. */
  async quiz() {
    const respostas = { ...(app.doc.profile.quiz || {}) };

    for (const pergunta of QUIZ) {
      const r = await form(pergunta.pergunta, null, [
        { name: 'resposta', label: 'Escolha', type: 'pilulas', value: respostas[pergunta.id] || '',
          options: pergunta.opcoes.map((o) => ({ value: o.valor, label: o.label, cor: 'chip' })) },
      ], { ok: 'Próxima' });
      if (!r) return;
      respostas[pergunta.id] = r.resposta;
    }

    await commit((d) => { d.profile.quiz = respostas; });
    const p = app.view.perfil;
    if (p.fase) {
      await sheet(
        `<h4>${esc(p.fase.nome)}</h4>
         <p class="sub">${esc(p.fase.texto)}</p>
         <div class="ze-resumo"><div class="ze-desc">${esc(p.fase.foco)}</div>
           <div class="ze-meta">${esc(p.origem === 'quiz' ? 'a partir do que você respondeu' : `a partir dos seus números · ${p.motivo}`)}</div></div>
         <div class="btns"><button class="btn primary" data-x="1" style="width:100%">Entendi</button></div>`,
        { onMount: (card, fechar) => { card.querySelector('[data-x]').onclick = () => fechar(null); } }
      );
    }
  },

  /** Liga ou desliga os avisos. A permissão só pode ser pedida a partir daqui. */
  async avisos() {
    if (!avisos.suportaAvisos()) {
      toast('Este navegador não sabe notificar.');
      return;
    }

    if (avisos.avisosLigados()) {
      avisos.ligarAvisos(false);
      avisos.limparVistos();
      draw();
      toast('Avisos desligados.');
      return;
    }

    const permissao = await avisos.pedirPermissao();
    if (permissao !== 'granted') {
      toast(permissao === 'denied'
        ? 'Você negou os avisos. Para religar, é nas configurações do aparelho.'
        : 'Sem permissão, sem aviso.');
      return;
    }

    avisos.ligarAvisos(true);
    draw();
    const quantos = await avisos.mostrarAvisos(app.view.avisos, app.todayISO);
    toast(quantos ? 'Avisos ligados.' : 'Avisos ligados — nada urgente hoje.');
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

  /**
   * Pausa ou retoma uma dívida.
   *
   * Pausada, ela some de toda a matemática — total, juro por dia, mínimo do
   * mês, ordem de pagar e projeção — mas continua cadastrada. Serve para a
   * dívida em negociação, para a cobrança que a pessoa contesta, e para o
   * caso em que a única alternativa hoje era apagar e perder o histórico.
   */
  async 'alternar-divida'({ id }) {
    const d = app.doc.debts.find((x) => x.id === id);
    if (!d) return;
    const pausando = ativa(d);

    if (pausando) {
      const ok = await confirmar({
        titulo: `Pausar ${d.name}?`,
        texto: 'Ela continua cadastrada, com saldo e taxa, mas sai de todas as contas do app: '
          + 'total da dívida, juro por dia, mínimo do mês, ordem de pagar e projeção de caixa. '
          + 'Dá para religar a qualquer momento.',
        ok: 'Pausar',
      });
      if (!ok) return;
    }

    await commit((doc) => {
      doc.debts = doc.debts.map((x) => (x.id === id ? { ...x, active: !pausando } : x));
    });
    toast(pausando ? `${d.name} pausada — fora das contas.` : `${d.name} voltou a contar.`);
  },

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
  async 'depositar-cofrinho'({ id }) { await depositarCofrinho(id); },
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
      <p class="sub">O que se repete todo mês ou de quinze em quinze dias. É o que a
        projeção usa para saber quanto realmente sobra.</p>
      ${fixos.length ? `<div class="list">${fixos.map((r) => `
        <button class="row" data-act="editar-fixo" data-id="${esc(r.id)}">
          <div class="ic">${icon('relogio')}</div>
          <div class="bd"><div class="t">${esc(r.label)}</div><div class="s">${esc(quandoRepete(r))}</div></div>
          <div class="rt"><div class="amt num">${esc(brl(-mensalDoRecorrente(r)))}</div>
            ${r.every === 'quinzena' ? '<div class="dt">no mês</div>' : ''}</div>
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

  async 'ver-mes'({ month }) {
    const catById = Object.fromEntries(app.doc.categories.map((c) => [c.id, c]));
    const porCategoria = new Map();
    for (const t of app.doc.transactions) {
      if (t.amountCents >= 0) continue;
      const comp = t.competence || monthKey(t.date);
      if (comp !== month) continue;
      const chave = t.categoryId || '__sem';
      if (!porCategoria.has(chave)) porCategoria.set(chave, { nome: catById[t.categoryId]?.name || 'Sem categoria', total: 0, itens: [] });
      const grupo = porCategoria.get(chave);
      grupo.total += Math.abs(t.amountCents);
      grupo.itens.push(t);
    }
    const grupos = [...porCategoria.values()].sort((a, b) => b.total - a.total);
    const total = sum(grupos.map((g) => g.total));

    await sheet(
      `<h4>${esc(formatMonthKey(month, { long: true }))}</h4>
       <p class="sub">${esc(brl(total))} gastos no mês. Toque numa categoria pra ver os lançamentos.</p>
       ${grupos.length ? `<div class="list">${grupos.map((g, i) => `
         <button type="button" class="row" data-toggle="${i}">
           <div class="bd"><div class="t">${esc(g.nome)}</div><div class="s">${g.itens.length} ${g.itens.length === 1 ? 'lançamento' : 'lançamentos'}</div></div>
           <div class="rt"><div class="amt num">${esc(brl(g.total))}</div></div>
           <span class="arr" data-seta="${i}">${icon('baixo')}</span>
         </button>
         <div class="expand-body" data-body="${i}" hidden>${g.itens
           .sort((a, b) => (a.date < b.date ? 1 : -1))
           .map((t) => `
             <div class="row">
               ${colunaDia(t.date, app.todayISO)}
               <div class="bd"><div class="t">${esc(t.description)}</div></div>
               <div class="rt"><div class="amt num">${esc(brl(Math.abs(t.amountCents)))}</div></div>
             </div>`).join('')}
         </div>`).join('')}</div>` : '<div class="empty">Nenhum gasto categorizado nesse mês.</div>'}
       <div class="btns"><button class="btn ghost" data-x="1" style="width:100%">Fechar</button></div>`,
      {
        onMount: (card, fechar) => {
          card.querySelector('[data-x]').onclick = () => fechar(null);
          card.querySelectorAll('[data-toggle]').forEach((botao) => {
            botao.onclick = () => {
              const i = botao.dataset.toggle;
              const corpo = card.querySelector(`[data-body="${i}"]`);
              const seta = card.querySelector(`[data-seta="${i}"]`);
              const abrindo = corpo.hasAttribute('hidden');
              corpo.toggleAttribute('hidden');
              seta.innerHTML = icon(abrindo ? 'cima' : 'baixo');
            };
          });
        },
      }
    );
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

    // Sem filtro: o iPhone resolve o tipo pela extensão e `.zbk` não é
    // extensão conhecida do iOS, então qualquer accept apagava o próprio
    // backup no seletor de Arquivos. Quem protege é a conferência abaixo.
    const arquivo = await escolherArquivo();
    if (!arquivo) return;

    // Confere o arquivo antes de pedir as doze palavras.
    try {
      openEnvelope(arquivo.texto);
    } catch (e) {
      toast(e.message || 'Não consegui abrir esse arquivo.');
      return;
    }

    const frase = await pedirFraseCurta('Doze palavras', 'As mesmas que você anotou quando criou o cofre.');
    if (!frase) return;

    let documento;
    try {
      documento = await readBackup(arquivo.texto, frase);
    } catch (e) {
      toast(e.message || 'Não consegui abrir esse backup.');
      return;
    }

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
  // Cada cartão entra do jeito que ele gasta. O de débito aponta para a conta
  // que ele debita — quem escolhe "Débito Itaú" quer que o dinheiro saia do
  // Itaú, não que apareça uma fatura. O vale aponta para ele mesmo, porque o
  // dinheiro é dele.
  const opcoesOrigemSaida = () => [
    ...app.doc.accounts.map((a) => ({ value: `ac:${a.id}`, label: `${a.name} — conta` })),
    ...app.doc.cards.flatMap((c) => {
      if (ehBeneficio(c)) return [{ value: `cd:${c.id}`, label: `${c.name} — vale` }];
      if (ehDebito(c)) return c.accountId ? [{ value: `ac:${c.accountId}`, label: `${c.name} — débito` }] : [];
      return [
        { value: `cd:${c.id}`, label: `${c.name} — crédito` },
        ...(c.accountId ? [{ value: `ac:${c.accountId}`, label: `${c.name} — débito` }] : []),
      ];
    }),
    ...app.doc.goals.filter((g) => g.status !== 'pausado').map((g) => ({ value: `cf:${g.id}`, label: `${g.name} — depósito` })),
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
    ],
    {
      ok: tx ? 'Salvar' : 'Lançar',
      apagar: tx ? 'Apagar lançamento' : null,
      aoMontar: (card) => {
        const hiddenEntrada = card.querySelector('[name="entrada"]');
        const campoOrigem = card.querySelector('#f-origem');
        const rotuloOrigem = card.querySelector('label[for="f-origem"]');
        const linhaParcelas = card.querySelector('[name="count"]').closest('.field');

        const atualizar = () => {
          const ehEntrada = hiddenEntrada.value === 'entrada';
          const opcoes = ehEntrada ? opcoesOrigemEntrada() : opcoesOrigemSaida();
          const atual = campoOrigem.value;
          campoOrigem.innerHTML = opcoes.map((o) =>
            `<option value="${esc(o.value)}" ${o.value === atual ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
          if (!opcoes.some((o) => o.value === atual)) campoOrigem.value = opcoes[0]?.value || '';
          rotuloOrigem.textContent = ehEntrada ? 'Entrou onde' : 'Onde saiu';

          // Parcelar só existe no crédito. Um vale ou um débito não dividem
          // em 12x, e oferecer o campo faria o app aceitar uma parcela que
          // depois não teria fatura nenhuma para cair.
          const idCartao = campoOrigem.value.startsWith('cd:') ? campoOrigem.value.slice(3) : null;
          const cartao = idCartao ? app.doc.cards.find((c) => c.id === idCartao) : null;
          const podeParcelar = !ehEntrada && cartao && permiteParcelar(cartao);
          linhaParcelas.style.display = podeParcelar ? '' : 'none';
          if (!podeParcelar) card.querySelector('[name="count"]').value = 1;
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

  // '+ Criar categoria' vira categoria de verdade antes de virar dado salvo.
  if (r.categoryId === NOVA_CATEGORIA) {
    const criada = await resolverCategoria(r.categoryId);
    if (!criada) return;
    r.categoryId = criada;
  }

  const entradaFinal = r.entrada === 'entrada';
  const [tipo, origemId] = r.origem.split(':');

  // Depósito em cofrinho não é gasto categorizado — só move pro guardado,
  // igual ao botão "Depositar" de dentro do cofrinho.
  if (tipo === 'cf') {
    const meta = app.doc.goals.find((g) => g.id === origemId);
    if (!meta) { toast('Esse cofrinho não existe mais.'); return; }
    if (id) { await commit((d) => { d.transactions = d.transactions.filter((t) => t.id !== id); }); }
    await commit((d) => {
      const alvo = d.goals.find((g) => g.id === origemId);
      if (alvo) alvo.savedCents = Math.max(0, alvo.savedCents + Math.abs(r.valor));
    });
    toast(`${meta.name}: ${brl(meta.savedCents + Math.abs(r.valor))} guardado.`);
    return;
  }

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
    // A caixa "entrada avulsa" saiu do formulário: no meio de um lançamento
    // comum ela era uma pergunta contábil que ninguém pediu. A marcação
    // continua existindo, mas agora só vem do contexto — de "Lançar" dentro
    // de Recebimentos → Avulsos, onde a pessoa já disse o que está fazendo.
    extraordinary: entradaFinal && (tx?.extraordinary ?? sugestao.extraordinary ?? false),
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
  const dividaLigada = id ? app.doc.debts.find((x) => x.kind === KIND_DIVIDA.OVERDRAFT && x.accountId === id) : null;

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
    { name: 'rende', label: 'Rende ao mês (%)', type: 'percent',
      value: c?.monthlyRate ? String((c.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
      hint: 'só o número, ao MÊS. Poupança fica perto de 0,5; CDB de 100% do CDI, perto de 1. Deixe vazio se não rende' },
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
      const tipo = card.querySelector('[name="type"]');
      const linhaRende = card.querySelector('[name="rende"]').closest('.field');
      const atualizar = () => {
        linhaCheque.style.display = negativo.checked ? '' : 'none';
        linhaTaxa.style.display = negativo.checked && cheque.checked ? '' : 'none';
        // Conta corrente não rende — perguntar ali só faz a pessoa duvidar
        // se deveria estar preenchendo alguma coisa.
        const podeRender = tipo.value === 'investment' || tipo.value === 'savings';
        linhaRende.style.display = podeRender && !negativo.checked ? '' : 'none';
      };
      tipo.addEventListener('change', atualizar);
      negativo.addEventListener('change', atualizar);
      cheque.addEventListener('change', atualizar);
      atualizar();
    },
  });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => {
      d.accounts = d.accounts.filter((a) => a.id !== id);
      d.debts = d.debts.filter((x) => !(x.kind === KIND_DIVIDA.OVERDRAFT && x.accountId === id));
    });
    toast('Conta apagada.');
    return;
  }

  const registro = {
    id: id || novoId('ac'),
    name: r.name || 'Conta',
    type: r.type,
    balanceCents: (r.negativo ? -1 : 1) * Math.abs(r.saldo),
    monthlyRate: pctParaFracao(r.rende),
  };
  const ehChequeEspecial = r.negativo && r.chequeEspecial;

  await commit((d) => {
    d.accounts = id ? d.accounts.map((a) => (a.id === id ? { ...a, ...registro } : a)) : [...d.accounts, registro];

    d.debts = d.debts.filter((x) => !(x.kind === KIND_DIVIDA.OVERDRAFT && x.accountId === registro.id));
    if (ehChequeEspecial) {
      d.debts.push({
        id: dividaLigada?.id || novoId('dv'),
        name: `Cheque especial · ${registro.name}`,
        kind: KIND_DIVIDA.OVERDRAFT,
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

const CORES_CARTAO = [
  { value: 'red', label: 'Vermelho' }, { value: 'blue', label: 'Azul' },
  { value: 'jade', label: 'Verde' }, { value: 'steel', label: 'Prata' },
  { value: 'amber', label: 'Âmbar' }, { value: 'violet', label: 'Roxo' },
  { value: 'graphite', label: 'Grafite' },
];

/**
 * Que tipo de cartão é esse — a pergunta que decide todo o resto.
 *
 * Vem antes do formulário porque os três tipos quase não compartilham campos.
 * Um formulário só, com nove campos e seis escondidos, faria a pessoa preencher
 * fechamento e limite de um vale-refeição.
 */
function escolherTipoDeCartao() {
  return sheet(
    `<h4>Que cartão é esse?</h4>
     <p class="sub">Cada tipo pergunta coisas diferentes — e o dinheiro sai de lugares diferentes.</p>
     <div class="list">${TIPOS.map((t) => `
       <button class="row" data-tipo="${esc(t.id)}">
         <div class="ic">${icon('cartao')}</div>
         <div class="bd"><div class="t">${esc(t.nome)}</div><div class="s">${esc(t.sub)}</div></div>
         <span class="arr">${icon('seta')}</span>
       </button>`).join('')}</div>
     <div class="btns"><button class="btn ghost" data-x="1" style="width:100%">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelectorAll('[data-tipo]').forEach((b) => { b.onclick = () => fechar(b.dataset.tipo); });
      },
    }
  );
}

async function editarCartao(id) {
  const c = id ? app.doc.cards.find((x) => x.id === id) : null;

  // Trocar o tipo de um cartão que já tem lançamentos moveria compras entre
  // faturas que existem e faturas que deixariam de existir. Enquanto está
  // vazio, trocar é inofensivo — e é justamente quando alguém percebe que
  // escolheu errado.
  const temLancamento = id ? app.doc.transactions.some((t) => t.cardId === id) : false;
  let kind = c?.kind || null;
  if (!kind || !temLancamento) {
    kind = (await escolherTipoDeCartao()) || kind;
    if (!kind) return;
  }

  const salvo = await formularioDoCartao(c, kind, id);
  if (salvo) toast('Salvo.');
}

async function formularioDoCartao(c, kind, id) {
  const contas = app.doc.accounts.filter((a) => a.type !== 'investment');
  const semConta = contas.length === 0;
  const tipo = TIPOS.find((t) => t.id === kind) || TIPOS[0];

  const campos = [
    { name: 'name', label: 'Nome', type: 'text', value: c?.name || '',
      placeholder: kind === KIND.BENEFIT ? 'Vale Alimentação' : kind === KIND.DEBIT ? 'Débito Itaú' : 'Nubank' },
  ];

  if (kind === KIND.CREDIT) {
    campos.push(
      { name: 'closingDay', label: 'Fecha dia', type: 'number', value: c?.closingDay || 20, min: 1, max: 31 },
      { name: 'dueDay', label: 'Vence dia', type: 'number', value: c?.dueDay || 27, min: 1, max: 31 },
      { name: 'limite', label: 'Limite', type: 'money', value: c?.limitCents || 0 },
    );
  }

  if (kind === KIND.DEBIT) {
    campos.push({
      name: 'accountId', label: 'Debita da conta', type: 'select',
      value: c?.accountId || (semConta ? '__nova' : contas[0]?.id || '__nova'),
      options: [...contas.map((a) => ({ value: a.id, label: a.name })), { value: '__nova', label: '+ Cadastrar uma conta agora' }],
      hint: 'o valor sai daqui no mesmo dia da compra — cartão de débito não tem fatura',
    });
    campos.push(
      { name: 'contaNome', label: 'Nome da conta nova', type: 'text', value: '', placeholder: 'Itaú' },
      { name: 'contaSaldo', label: 'Quanto tem nessa conta hoje', type: 'money', value: 0,
        hint: 'pode deixar zerado. O app salva do mesmo jeito e mostra a conta negativa quando você gastar — melhor um número honesto que um chute' },
    );
  }

  if (kind === KIND.BENEFIT) {
    campos.push(
      { name: 'saldo', label: 'Saldo do vale hoje', type: 'money', value: c?.balanceCents || 0,
        hint: 'olhe no app do benefício. Daqui pra frente o Zero desconta cada compra sozinho' },
      { name: 'recarga', label: 'A empresa deposita', type: 'money', value: c?.reloadCents || 0,
        hint: 'deixe zerado se o depósito varia ou não é todo mês' },
      { name: 'recargaDia', label: 'Todo dia', type: 'number', value: c?.reloadDay || 5, min: 1, max: 31 },
    );
  }

  campos.push({ name: 'color', label: 'Cor', type: 'cores', value: c?.color || 'blue', options: CORES_CARTAO });

  const r = await form(
    c ? `Editar ${tipo.nome.toLowerCase()}` : `Novo cartão de ${tipo.nome.toLowerCase()}`,
    subtituloDoTipo(kind),
    campos,
    {
      ok: 'Salvar',
      apagar: c ? 'Apagar cartão' : null,
      aoMontar: (card) => {
        if (kind !== KIND.DEBIT) return;
        const conta = card.querySelector('[name="accountId"]');
        const linhas = ['contaNome', 'contaSaldo']
          .map((n) => card.querySelector(`[name="${n}"]`).closest('.field'));
        const atualizar = () => {
          const nova = conta.value === '__nova';
          for (const linha of linhas) linha.style.display = nova ? '' : 'none';
        };
        conta.addEventListener('change', atualizar);
        atualizar();
      },
    }
  );
  if (!r) return false;

  if (r.__apagar) {
    const temLancamento = app.doc.transactions.some((t) => t.cardId === id);
    if (temLancamento) {
      const ok = await confirmar({
        titulo: 'Este cartão tem lançamentos',
        texto: 'Apagar o cartão deixa os lançamentos sem fatura e a projeção deixa de contá-los.',
        ok: 'Apagar mesmo assim', perigo: true,
      });
      if (!ok) return false;
    }
    await commit((d) => { d.cards = d.cards.filter((x) => x.id !== id); });
    toast('Cartão apagado.');
    return false;
  }

  const dia = (n, padrao) => Math.min(31, Math.max(1, Number(n) || padrao));

  // Conta nova criada aqui dentro: quem está cadastrando um cartão de débito
  // não deveria ser mandado para outra tela e trazido de volta.
  let contaId = kind === KIND.DEBIT ? r.accountId : null;
  let contaNova = null;
  if (kind === KIND.DEBIT && contaId === '__nova') {
    contaNova = {
      id: novoId('ac'),
      name: r.contaNome?.trim() || r.name?.trim() || 'Conta',
      type: 'checking',
      balanceCents: r.contaSaldo || 0,
      monthlyRate: 0,
    };
    contaId = contaNova.id;
  }

  const registro = {
    id: id || novoId('cd'),
    name: r.name?.trim() || 'Cartão',
    kind,
    color: r.color,
    closingDay: kind === KIND.CREDIT ? dia(r.closingDay, 20) : null,
    dueDay: kind === KIND.CREDIT ? dia(r.dueDay, 27) : null,
    limitCents: kind === KIND.CREDIT ? r.limite : 0,
    accountId: contaId || null,
    balanceCents: kind === KIND.BENEFIT ? r.saldo : 0,
    // O saldo digitado vale de hoje em diante. Sem esta data, as compras que o
    // saldo novo já reflete seriam descontadas de novo e o vale iria a zero.
    balanceAsOf: kind === KIND.BENEFIT ? app.todayISO : null,
    reloadCents: kind === KIND.BENEFIT ? r.recarga : 0,
    reloadDay: kind === KIND.BENEFIT && r.recarga > 0 ? dia(r.recargaDia, 5) : null,
  };

  const erros = validarCartao(registro, { accounts: [...app.doc.accounts, ...(contaNova ? [contaNova] : [])] });
  if (erros.length) { toast(erros[0]); return false; }

  await commit((d) => {
    if (contaNova) d.accounts = [...d.accounts, contaNova];
    d.cards = id ? d.cards.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.cards, registro];
  });

  if (contaNova && !contaNova.balanceCents) {
    toast(`Conta ${contaNova.name} criada zerada — atualize o saldo quando souber.`);
    return false;
  }
  return true;
}

const subtituloDoTipo = (kind) =>
  kind === KIND.CREDIT
    ? 'O dia do fechamento é o que decide em qual fatura cada compra cai. Compra feita NO dia do fechamento já entra na fatura seguinte.'
    : kind === KIND.DEBIT
      ? 'Débito não tem fatura nem limite: o valor sai da conta no mesmo dia. Por isso ele precisa de uma conta.'
      : 'O vale passa na maquininha como crédito, mas não gera fatura — desconta do próprio saldo. A compra continua indo para a categoria de verdade: mercado, restaurante, posto.';

/**
 * Encolhe a imagem antes de guardar.
 *
 * Foto de celular tem vários megabytes, e o cofre inteiro é cifrado e
 * decifrado a cada gravação — guardar o original faria toda edição de
 * lançamento ficar lenta por causa de um retrato.
 */
function reduzirImagem(arquivo, lado = 256) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('não consegui ler'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('não é imagem'));
      img.onload = () => {
        // recorte quadrado do centro: a foto vira um círculo na tela
        const menor = Math.min(img.width, img.height);
        const cx = (img.width - menor) / 2;
        const cy = (img.height - menor) / 2;

        const tela = document.createElement('canvas');
        tela.width = lado;
        tela.height = lado;
        tela.getContext('2d').drawImage(img, cx, cy, menor, menor, 0, 0, lado, lado);
        resolve(tela.toDataURL('image/jpeg', 0.82));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
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
    monthlyRate: r.kind === KIND_DIVIDA.INSTALLMENT ? 0 : pctParaFracao(r.taxa),
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
    // Nasce ativa: cadastrar uma dívida e ela não contar em nada seria pior
    // que não cadastrar. Desligar é decisão, não padrão.
    ativa: d0 ? ativa(d0) : true,
    kind: d0?.kind || KIND_DIVIDA.REVOLVING,
    saldo: Math.abs(d0?.balanceCents || 0),
    taxa: d0 ? String((d0.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
    minimoPct: d0?.minPaymentRate ? String((d0.minPaymentRate * 100).toFixed(0)) : '',
    minimoFixo: d0?.minPaymentCents || 0,
    dueDay: d0?.dueDay || 10,
    cardId: d0?.cardId || '',
    bloqueado: !!d0?.cardBlocked,
    acordo: !!d0?.agreement,
    acordoForma: d0?.agreement?.form || 'parcelado',
    acordoValor: d0?.agreement ? Math.abs(d0.balanceCents) : 0,
    acordoParcelas: d0?.agreement?.installments || 1,
  };
  let erro = null;

  while (true) {
    const r = await form(d0 ? 'Editar dívida' : 'Nova dívida',
      erro || 'A taxa vem escrita na fatura e no extrato — procure "juros do rotativo" ou "juros do cheque especial". É ela que decide a ordem de pagamento.',
      [
        { name: 'name', label: 'Nome', type: 'text', value: atual.name, placeholder: 'Fatura atrasada · Nubank' },
        { name: 'ativa', label: 'Contar esta dívida nas contas do mês', type: 'checkbox', value: atual.ativa,
          hint: 'desmarque para ela ficar cadastrada mas sair de tudo: total, juro por dia, mínimo do mês, ordem de pagar e projeção. É o lugar da dívida em negociação ou que você contesta' },
        { name: 'kind', label: 'Tipo', type: 'select', value: atual.kind,
          options: [
            { value: KIND_DIVIDA.REVOLVING, label: 'Rotativo do cartão' },
            { value: KIND_DIVIDA.OVERDRAFT, label: 'Cheque especial' },
            { value: KIND_DIVIDA.LOAN, label: 'Empréstimo' },
            { value: KIND_DIVIDA.INSTALLMENT, label: 'Parcelamento já contratado' },
          ] },
        { name: 'cardId', label: 'Cartão vinculado (se for fatura atrasada)', type: 'select', value: atual.cardId,
          options: [{ value: '', label: 'Nenhum' }, ...app.doc.cards.map((c) => ({ value: c.id, label: c.name }))] },
        { name: 'bloqueado', label: 'Cartão bloqueado', type: 'checkbox', value: atual.bloqueado },
        { name: 'saldo', label: 'Quanto deve hoje', type: 'money', value: atual.saldo },
        { name: 'taxa', label: 'Juros ao mês (%)', type: 'percent', value: atual.taxa,
          hint: 'só o número. Rotativo costuma ficar entre 12 e 16; cheque especial no teto de 8' },
        { name: 'minimoPct', label: 'Mínimo: quantos POR CENTO do saldo', type: 'percent', value: atual.minimoPct,
          hint: 'só o número, sem R$. Cartão costuma exigir 15. Se o seu mínimo é um valor fixo em reais, deixe vazio e use o campo abaixo' },
        { name: 'minimoFixo', label: 'Ou mínimo fixo por mês, em reais', type: 'money', value: atual.minimoFixo },
        { name: 'dueDay', label: 'Vence todo dia', type: 'number', value: atual.dueDay, min: 1, max: 28,
          hint: 'o dia em que a parcela sai da conta. É isto que a projeção de caixa usa' },
        { name: 'acordo', label: 'Já negociei um acordo pra essa dívida', type: 'checkbox', value: atual.acordo },
        { name: 'acordoForma', label: 'Forma de pagamento do acordo', type: 'segmento', value: atual.acordoForma,
          options: [{ value: 'avista', label: 'À vista' }, { value: 'parcelado', label: 'Parcelado' }] },
        { name: 'acordoValor', label: 'Valor total do acordo', type: 'money', value: atual.acordoValor },
        { name: 'acordoParcelas', label: 'Em quantas parcelas', type: 'number', value: atual.acordoParcelas, min: 1, max: 60 },
      ], {
        ok: 'Salvar',
        apagar: d0 ? 'Quitei esta dívida' : null,
        aoMontar: (card) => {
          const cardIdSel = card.querySelector('[name="cardId"]');
          const linhaBloqueado = card.querySelector('[name="bloqueado"]').closest('.field');
          const acordoChk = card.querySelector('[name="acordo"]');
          const linhaSaldo = card.querySelector('[name="saldo"]').closest('.field');
          const linhaTaxa = card.querySelector('[name="taxa"]').closest('.field');
          const linhaMinPct = card.querySelector('[name="minimoPct"]').closest('.field');
          const linhaMinFixo = card.querySelector('[name="minimoFixo"]').closest('.field');
          const linhaForma = card.querySelector('[name="acordoForma"]').closest('.field');
          const linhaValor = card.querySelector('[name="acordoValor"]').closest('.field');
          const linhaParcelas = card.querySelector('[name="acordoParcelas"]').closest('.field');

          const atualizar = () => {
            linhaBloqueado.style.display = cardIdSel.value ? '' : 'none';
            const fezAcordo = acordoChk.checked;
            linhaSaldo.style.display = fezAcordo ? 'none' : '';
            linhaTaxa.style.display = fezAcordo ? 'none' : '';
            linhaMinPct.style.display = fezAcordo ? 'none' : '';
            linhaMinFixo.style.display = fezAcordo ? 'none' : '';
            linhaForma.style.display = fezAcordo ? '' : 'none';
            linhaValor.style.display = fezAcordo ? '' : 'none';
            const formaSel = card.querySelector('[name="acordoForma"]')?.value;
            linhaParcelas.style.display = fezAcordo && formaSel === 'parcelado' ? '' : 'none';
          };

          cardIdSel.addEventListener('change', atualizar);
          acordoChk.addEventListener('change', atualizar);
          card.querySelector('[name="acordoForma"]').addEventListener('change', atualizar);
          atualizar();
        },
      });

    if (!r) return;

    if (r.__apagar) {
      await commit((d) => { d.debts = d.debts.filter((x) => x.id !== id); });
      await celebrarQuitacao(d0);
      return;
    }

    atual = r;
    erro = conferirDivida(r);
    if (erro) { toast(erro); continue; }

    const fezAcordo = r.acordo;
    const parcelasAcordo = r.acordoForma === 'avista' ? 1 : Math.max(1, r.acordoParcelas);
    const registro = {
      id: id || novoId('dv'),
      name: r.name || 'Dívida',
      kind: fezAcordo ? KIND_DIVIDA.INSTALLMENT : r.kind,
      balanceCents: fezAcordo ? Math.abs(r.acordoValor) : Math.abs(r.saldo),
      monthlyRate: fezAcordo || r.kind === KIND_DIVIDA.INSTALLMENT ? 0 : pctParaFracao(r.taxa),
      minPaymentRate: fezAcordo ? 0 : pctParaFracao(r.minimoPct),
      minPaymentCents: fezAcordo ? Math.round(Math.abs(r.acordoValor) / parcelasAcordo) : r.minimoFixo,
      dueDay: Math.min(28, Math.max(1, Number(r.dueDay) || 10)),
      cardId: r.cardId || null,
      cardBlocked: r.cardId ? !!r.bloqueado : false,
      agreement: fezAcordo ? { madeOn: d0?.agreement?.madeOn || app.todayISO, installments: parcelasAcordo, form: r.acordoForma } : null,
      active: !!r.ativa,
      since: d0?.since || app.todayISO,
    };

    await commit((d) => {
      d.debts = id ? d.debts.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.debts, registro];
      // O pico só conta o que está valendo — senão pausar uma dívida deixaria
      // o marco de "metade paga" preso num pico que a pessoa nem acompanha.
      const total = somenteAtivas(d.debts).reduce((a, x) => a + Math.abs(x.balanceCents), 0);
      if (total > (d.profile.debtPeakCents || 0)) d.profile.debtPeakCents = total;
    });
    toast(registro.active ? 'Salvo.' : 'Salvo — pausada, fora das contas do mês.');
    return;
  }
}

/** A saída de uma dívida merece mais que um toast — principalmente a última. */
async function celebrarQuitacao(dividaQuitada) {
  const v = app.view;
  const nome = dividaQuitada?.name || 'Essa dívida';
  const livre = v.dividaTotalCents === 0;

  return sheet(
    `${livre
      ? `<h4>Livre de dívidas</h4>
         <p class="sub">${esc(nome)} era a última. Zero é zero de verdade agora — nenhuma dívida cadastrada.</p>`
      : `<h4>Uma a menos</h4>
         <p class="sub">${esc(nome)} quitada. Faltam ${v.dividas.length} ${v.dividas.length === 1 ? 'dívida' : 'dívidas'}
           · ${esc(brl(v.dividaTotalCents))} para ficar livre.</p>`}
     <div class="btns"><button class="btn primary" data-ok="1">${livre ? 'Fechar' : 'Continuar'}</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-ok]').onclick = () => fechar(null);
      },
    }
  );
}

async function editarCofrinho(id) {
  const g = id ? app.doc.goals.find((x) => x.id === id) : null;
  const categorias = app.doc.categories.filter((c) => c.id !== 'renda');
  const jaTemCategoria = (g?.categoryIds?.length || 0) > 0;

  const r = await form(g ? 'Editar meta' : 'Nova meta ou cofrinho', null, [
    { name: 'name', label: 'Para quê', type: 'text', value: g?.name || '', placeholder: 'Reserva de emergência' },
    { name: 'alvo', label: 'Quanto quer juntar', type: 'money', value: g?.targetCents || 0 },
    { name: 'guardado', label: 'Já tem', type: 'money', value: g?.savedCents || 0 },
    { name: 'mensal', label: 'Guarda por mês', type: 'money', value: g?.monthlyCents || 0 },
    { name: 'rende', label: 'Rende ao mês (%)', type: 'percent',
      value: g?.monthlyRate ? String((g.monthlyRate * 100).toFixed(2)).replace('.', ',') : '',
      hint: 'se o dinheiro está num lugar que rende, a meta chega antes. Só o número, ao MÊS' },
    { name: 'prazo', label: 'Prazo (opcional)', type: 'date', value: g?.deadline || '' },
    { name: 'pausado', label: 'Pausado', type: 'checkbox', value: g?.status === 'pausado' },
    { name: 'porCategoria', label: 'Também acompanhar por categoria de gasto (opcional)', type: 'checkbox', value: jaTemCategoria,
      hint: 'pra "quanto o carro me custa" — soma o que você já gasta nessas categorias, além do que guarda aqui' },
    ...categorias.map((c) => ({ name: `cat_${c.id}`, label: c.name, type: 'checkbox', value: g?.categoryIds?.includes(c.id) || false })),
  ], {
    ok: 'Salvar',
    apagar: g ? 'Apagar' : null,
    aoMontar: (card) => {
      const chk = card.querySelector('[name="porCategoria"]');
      const linhasCategoria = categorias.map((c) => card.querySelector(`[name="cat_${c.id}"]`).closest('.field'));
      const atualizar = () => { linhasCategoria.forEach((el) => { el.style.display = chk.checked ? '' : 'none'; }); };
      chk.addEventListener('change', atualizar);
      atualizar();
    },
  });
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
    monthlyRate: pctParaFracao(r.rende),
    status: r.pausado ? 'pausado' : 'ativo',
    deadline: r.prazo || null,
    categoryIds: r.porCategoria ? categorias.filter((c) => r[`cat_${c.id}`]).map((c) => c.id) : [],
    kind: g?.kind,
  };
  await commit((d) => {
    d.goals = id ? d.goals.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.goals, registro];
  });
  toast('Salvo.');
}

/** Soma (ou tira) um valor do já guardado, sem precisar reabrir o cofrinho inteiro pra editar o número. */
async function depositarCofrinho(id) {
  const g = app.doc.goals.find((x) => x.id === id);
  if (!g) return;

  const r = await form(`Depositar em ${g.name}`,
    `Tem ${brl(g.savedCents)} guardado. Digite o valor — toque em "Foi saída" se está tirando, não colocando.`,
    [
      { name: 'valor', label: 'Valor', type: 'money', value: 0 },
      { name: 'saida', label: 'Foi saída (tirei do cofrinho)', type: 'checkbox', value: false },
    ], { ok: 'Registrar' });
  if (!r || !r.valor) return;

  const novoSaldo = Math.max(0, g.savedCents + (r.saida ? -1 : 1) * Math.abs(r.valor));
  await commit((d) => {
    const alvo = d.goals.find((x) => x.id === id);
    if (alvo) alvo.savedCents = novoSaldo;
  });
  toast(`${g.name}: ${brl(novoSaldo)} guardado.`);
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
      { name: 'label', label: 'Nome', type: 'text', value: r0?.label || '',
        placeholder: entrada ? 'Salário' : 'Aluguel' },
      { name: 'valor', label: 'Valor', type: 'money', value: Math.abs(r0?.amountCents || 0),
        hint: 'o valor de CADA vez, não o total do mês' },
      { name: 'every', label: 'Com que frequência', type: 'segmento', value: r0?.every || 'mes',
        options: [{ value: 'mes', label: 'Todo mês' }, { value: 'quinzena', label: 'De 15 em 15 dias' }] },
      { name: 'dia', label: 'Todo dia', type: 'number', value: r0?.dayOfMonth || 5, min: 1, max: 28,
        hint: 'até 28, para o dia existir em todos os meses' },
      { name: 'dia2', label: 'E também dia', type: 'number', value: r0?.dayOfMonth2 || 20, min: 1, max: 28 },
      ...(entrada ? [] : [
        { name: 'categoryId', label: 'Categoria', type: 'select', value: r0?.categoryId || '', options: opcoesCategoria() },
        // De onde essa conta sai. Importa de verdade quando sai de um vale:
        // água, luz e internet pagas no cartão de benefício não passam pela
        // conta corrente, e descontá-las de lá faria o app prever furo de
        // caixa por dinheiro que nunca vai sair de lá.
        { name: 'origemFixo', label: 'Sai de onde', type: 'select', value: r0?.cardId || '',
          options: [
            { value: '', label: 'Da conta corrente' },
            ...app.doc.cards.map((c) => ({
              value: c.id,
              label: `${c.name}${ehBeneficio(c) ? ' — vale' : ehDebito(c) ? ' — débito' : ' — cartão'}`,
            })),
          ],
          hint: 'se você paga essa conta no vale, escolha ele aqui — o valor sai do saldo do vale e não da conta' },
      ]),
    ], {
      ok: 'Salvar',
      apagar: r0 ? 'Apagar' : null,
      aoMontar: (card) => {
        const freq = card.querySelector('[name="every"]');
        const linhaDia2 = card.querySelector('[name="dia2"]').closest('.field');
        const rotuloDia = card.querySelector('label[for="f-dia"]');
        const atualizar = () => {
          const quinzenal = freq.value === 'quinzena';
          linhaDia2.style.display = quinzenal ? '' : 'none';
          rotuloDia.textContent = quinzenal ? 'Dia' : 'Todo dia';
        };
        freq.addEventListener('change', atualizar);
        atualizar();
      },
    });
  if (!r) return;

  if (r.__apagar) {
    await commit((d) => { d.recurring = d.recurring.filter((x) => x.id !== id); });
    toast('Apagado.');
    return;
  }

  if (r.categoryId === NOVA_CATEGORIA) {
    const criada = await resolverCategoria(r.categoryId);
    if (!criada) return;
    r.categoryId = criada;
  }

  const dia = (n, padrao) => Math.min(28, Math.max(1, Number(n) || padrao));
  const quinzenal = r.every === 'quinzena';
  const registro = {
    id: id || novoId('rc'),
    label: r.label || (entrada ? 'Entrada' : 'Gasto fixo'),
    amountCents: Math.abs(r.valor),
    dayOfMonth: dia(r.dia, 5),
    every: quinzenal ? 'quinzena' : 'mes',
    dayOfMonth2: quinzenal ? dia(r.dia2, 20) : null,
    kind,
    categoryId: r.categoryId || null,
    cardId: entrada ? null : (r.origemFixo || null),
    fixed: true,
  };
  await commit((d) => {
    d.recurring = id ? d.recurring.map((x) => (x.id === id ? { ...x, ...registro } : x)) : [...d.recurring, registro];
  });
  toast('Salvo.');
}

// ------------------------------------------------------------------- o Zé
//
// O Zé é o parser com nome. Ele não é IA nem manda nada para servidor nenhum —
// é regra, dicionário e a memória do que VOCÊ já corrigiu. Por isso ele acerta
// os seus estabelecimentos, e não os do Brasil inteiro: quanto mais você usa,
// menos ele pergunta.

/** Tudo que o Zé precisa saber deste cofre para acertar sozinho. */
const contextoDoZe = () => ({
  todayISO: app.todayISO,
  merchants: MERCHANTS,
  rules: app.doc.rules || [],
  memory: app.doc.memory || {},
  accounts: app.doc.accounts,
  cards: app.doc.cards,
});

/** Só resume quando não sobrou nenhuma pergunta — senão o formulário é honesto. */
const semDuvida = (l) =>
  l.amountCents != null && l.description && (l.accountId || l.cardId) && l.categoryId;

const sugestaoDe = (l) => ({
  description: l.description || '',
  amountCents: l.amountCents ?? 0,
  date: l.date,
  categoryId: l.categoryId || '',
  count: l.installmentCount || 1,
  method: l.method,
  entrada: l.direction === 'in',
});

const nomeDaOrigem = (l) => {
  if (l.cardId) return app.doc.cards.find((c) => c.id === l.cardId)?.name || 'cartão';
  if (l.accountId) return app.doc.accounts.find((a) => a.id === l.accountId)?.name || 'conta';
  return 'sem origem';
};

/** A frase chegou — o Zé decide o que fazer com ela. */
async function interpretarFrase(frase) {
  if (await tentarCofrinho(frase)) return;

  const partes = splitEntries(frase);
  if (partes.length > 1) return confirmarVarias(partes);

  const lido = parseEntry(frase, contextoDoZe());
  if (semDuvida(lido)) return confirmarUma(lido);

  if (lido.needs.length) toast(`Faltou ${lido.needs.join(' e ')} — completa aí embaixo.`);
  await editarLancamento(null, sugestaoDe(lido));
}

/**
 * "Coloquei 35 no cofrinho da viagem" não é gasto — é depósito.
 * Devolve true quando tratou a frase, para o resto do fluxo não rodar.
 */
async function tentarCofrinho(frase) {
  const normFrase = frase.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!/cofrinho|cofre|meta\b/.test(normFrase)) return false;

  const lido = parseEntry(frase, contextoDoZe());
  if (lido.amountCents == null) return false;

  const meta = app.doc.goals.find((g) => {
    const nome = g.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return nome.length > 2 && normFrase.includes(nome);
  });
  if (!meta) return false;

  const valor = Math.abs(lido.amountCents);
  const ok = await confirmar({
    titulo: `Depositar em "${meta.name}"?`,
    texto: `O Zé entendeu "${frase}" como um depósito de ${brl(valor)}. Se não é isso, cancele e lance manualmente.`,
    ok: 'Depositar',
  });
  if (ok) {
    await commit((d) => {
      const alvo = d.goals.find((g) => g.id === meta.id);
      if (alvo) alvo.savedCents = Math.max(0, alvo.savedCents + valor);
    });
    toast(`${meta.name}: ${brl(meta.savedCents + valor)} guardado.`);
  }
  return true;
}

/** Nada em aberto: mostra o resumo com um botão em vez do formulário inteiro. */
async function confirmarUma(lido) {
  const categoria = app.doc.categories.find((c) => c.id === lido.categoryId);
  const r = await sheet(
    `<h4>O Zé entendeu</h4>
     <div class="ze-resumo">
       <div class="ze-valor num ${lido.amountCents > 0 ? 'pos' : ''}">${esc(brl(lido.amountCents))}</div>
       <div class="ze-desc">${esc(lido.description)}</div>
       <div class="ze-meta">${esc(categoria?.name || 'sem categoria')} · ${esc(nomeDaOrigem(lido))} · ${esc(formatShort(lido.date))}</div>
     </div>
     <div class="btns"><button class="btn primary" data-ok="1">Lançar</button>
       <button class="btn ghost" data-ajustar="1">Ajustar</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-ok]').onclick = () => fechar('ok');
        card.querySelector('[data-ajustar]').onclick = () => fechar('ajustar');
      },
    }
  );
  if (r === 'ok') return salvarDireto(lido);
  if (r === 'ajustar') return editarLancamento(null, sugestaoDe(lido));
}

/** Duas ou mais compras na mesma frase — sempre confirma antes, nunca salva sozinho. */
async function confirmarVarias(partes) {
  const lidos = partes.map((p) => parseEntry(p, contextoDoZe()));
  const total = sum(lidos.map((l) => Math.abs(l.amountCents || 0)));

  const r = await sheet(
    `<h4>O Zé achou ${lidos.length} lançamentos</h4>
     <p class="sub">Confira antes de lançar — ${esc(brl(total))} no total.</p>
     <div class="list">${lidos.map((l) => `
       <div class="row">
         ${colunaDia(l.date, app.todayISO)}
         <div class="bd"><div class="t">${esc(l.description || l.raw)}</div>
           <div class="s">${pilulasDaLinha([nomeDaOrigem(l)])}</div></div>
         <div class="rt"><div class="amt num">${esc(brl(l.amountCents || 0))}</div></div>
       </div>`).join('')}</div>
     <div class="btns"><button class="btn primary" data-ok="1">Lançar os ${lidos.length}</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-ok]').onclick = () => fechar('ok');
        card.querySelector('[data-x]').onclick = () => fechar(null);
      },
    }
  );
  if (r !== 'ok') return;

  for (const l of lidos) await salvarDireto(l, { silencioso: true });
  toast(`${lidos.length} lançamentos registrados.`);
}

/** Grava sem passar pelo formulário. Só para o que o Zé leu inteiro. */
async function salvarDireto(lido, { silencioso = false } = {}) {
  const registro = {
    id: novoId('tx'),
    date: lido.date,
    competence: monthKey(lido.date),
    description: lido.description || lido.raw || 'Lançamento',
    amountCents: lido.amountCents,
    categoryId: lido.categoryId || null,
    cardId: lido.cardId || null,
    accountId: lido.accountId || null,
    method: lido.method || (lido.cardId ? 'credit' : null),
  };

  if (lido.cardId) {
    const card = app.doc.cards.find((c) => c.id === lido.cardId);
    const { cycleFor } = await import('../core/statements.js');
    const ciclo = cycleFor(card, lido.date);
    registro.cycleId = ciclo.id;
    registro.dueDate = ciclo.dueDate;
  }

  await commit((d) => { d.transactions = [registro, ...d.transactions]; });
  if (!silencioso) toast('Lançado.');
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
/**
 * Botão de segurar-e-falar, como um walkie-talkie: pressiona, fala, solta —
 * e solta já registra sozinho. Só não registra quando a parada não foi um
 * "terminei de falar" de verdade (deu erro, ou estourou o tempo limite).
 */
function pedirFrase() {
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;

  return sheet(
    `<h4>Fala com o Zé</h4>
     <p class="sub">Segure o botão e fale como você falaria: "gastei 85 no mercado ontem",
       "45,90 no posto no crédito em 3x", "recebi 300 do trader". Solte quando terminar.</p>
     <div class="field">
       <label for="fr-nl">O que aconteceu</label>
       <textarea id="fr-nl" rows="2" placeholder="gastei 85 no mercado ontem"></textarea>
     </div>
     ${Reconhecimento ? `
       <button type="button" class="mic3d" data-mic="1" aria-label="Segure para falar">${icon('microfone')}</button>
       <p class="mic-legenda" data-legenda>Segure para falar, solte para registrar</p>`
      : `<p class="sub">Para ditar no iPhone: toque no microfone do próprio teclado. Este navegador não dá ao app acesso ao reconhecimento de voz.</p>`}
     <div class="btns"><button class="btn primary" data-ok="1">Registrar</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        const campo = card.querySelector('#fr-nl');
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-ok]').onclick = () => fechar(campo.value.trim() || null);

        const botaoMic = card.querySelector('[data-mic]');
        const legenda = card.querySelector('[data-legenda]');
        if (!botaoMic) return;

        let rec = null;
        let ativo = false;

        const iniciar = (ev) => {
          ev.preventDefault();
          if (ativo) return;
          ativo = true;

          rec = new Reconhecimento();
          rec.lang = 'pt-BR';
          rec.interimResults = true;

          let resolvido = false;
          let motivoParada = null; // null = soltou de propósito; 'timeout' | 'erro' não registram sozinhos
          const encerrar = () => {
            if (resolvido) return;
            resolvido = true;
            ativo = false;
            clearTimeout(tempoLimite);
            botaoMic.classList.remove('rec');
            legenda.textContent = 'Segure para falar, solte para registrar';
            if (motivoParada === null && campo.value.trim()) fechar(campo.value.trim());
          };
          const tempoLimite = setTimeout(() => {
            motivoParada = 'timeout';
            try { rec.stop(); } catch { /* já parado */ }
            encerrar();
            toast('Não consegui ouvir a tempo. Digite a frase.');
          }, 15000);

          rec.onresult = (e) => { campo.value = e.results[0][0].transcript; };
          rec.onerror = () => { motivoParada = 'erro'; toast('Não consegui ouvir. Digite a frase.'); };
          rec.onend = encerrar;

          try {
            rec.start();
            botaoMic.classList.add('rec');
            legenda.textContent = 'Ouvindo… solte quando terminar';
          } catch {
            ativo = false;
            toast('O microfone não está disponível aqui.');
          }
        };

        const soltar = () => {
          if (!ativo || !rec) return;
          try { rec.stop(); } catch { /* já parado */ }
        };

        botaoMic.addEventListener('pointerdown', iniciar);
        botaoMic.addEventListener('pointerup', soltar);
        botaoMic.addEventListener('pointerleave', soltar);
        botaoMic.addEventListener('pointercancel', soltar);
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
     <div class="btns" style="margin-top:8px">${botaoColar()}</div>
     <div class="btns"><button class="btn primary" data-ok="1">Continuar</button>
       <button class="btn ghost" data-x="1">Cancelar</button></div>`,
    {
      onMount: (card, fechar) => {
        const campo = card.querySelector('#fr12');
        card.querySelector('[data-x]').onclick = () => fechar(null);
        card.querySelector('[data-frase="colar"]').onclick = () => colarNoCampo(campo);
        card.querySelector('[data-ok]').onclick = () => {
          const palavras = limparFrase(campo.value);
          try { phraseToBytes(palavras); } catch (e) { toast(e.message); return; }
          fechar(palavras);
        };
      },
    }
  );
}
