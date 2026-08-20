// As oito telas. Elas só desenham — quem calcula é src/core, quem junta é state.js.
//
// Cada tela devolve HTML como string e o render troca o conteúdo de uma vez.
// Para um app deste tamanho isso é mais rápido e muito mais fácil de ler do que
// qualquer árvore de componentes, e não custa 40 KB de framework no 4G.

import { brl, brlShort, formatCents, percent } from '../core/money.js';
import { formatShort, formatLong, formatMonthKey, monthAbbr, addMonthKey, parts, daysBetween } from '../core/dates.js';
import { KIND, horizon, comparePlans } from '../core/debts.js';
import { backupMessage } from '../data/backup.js';
import { esc, icon, sparkline } from './dom.js';
import { wire } from './actions.js';

const TABS = [
  ['painel', 'casa', 'Painel'],
  ['cartoes', 'cartao', 'Cartões'],
  ['dividas', 'escudoOk', 'Dívidas'],
  ['analise', 'grafico', 'Análise'],
  ['tudo', 'menu', 'Tudo'],
];

const TITULOS = {
  painel: 'Painel', cartoes: 'Cartões', dividas: 'Dívidas', analise: 'Análise',
  tudo: 'Tudo', cofrinhos: 'Cofrinhos', recebimentos: 'Recebimentos',
  revisao: 'Revisão', guia: 'Como usar',
};

let esconder = false;

/** Valor formatado, respeitando o olho fechado. */
const m = (cents, fn = brl) => (esconder ? '••••' : fn(cents));

export function render(app) {
  esconder = app.privacy;
  const tela = TELAS[app.screen] || TELAS.painel;
  document.getElementById('app').innerHTML = `
    ${faixaAtualizacao(app)}
    ${faixaExemplo(app)}
    <div class="screens"><section class="screen active">${tela(app)}</section></div>
    ${tabbar(app.screen)}
  `;
  wire(app);
}

/**
 * Faixa quando existe versão nova baixada e esperando.
 *
 * Atualizar não encosta nos seus dados — o service worker guarda o programa, o
 * cofre mora no IndexedDB. A faixa diz isso, porque num app sem servidor a
 * pergunta "vou perder o que digitei?" é legítima.
 */
function faixaAtualizacao(app) {
  if (!app.atualizacao) return '';
  return `<button class="atz" data-act="atualizar">
    <b>Versão nova pronta</b><span>Toque para instalar · seus dados não são tocados</span>
  </button>`;
}

/**
 * Faixa fixa enquanto o app está com os dados de exemplo.
 *
 * Fica em todas as telas de propósito: sem ela, dá para passar dias achando que
 * aqueles números são seus, e a saída ficava escondida em Tudo.
 */
function faixaExemplo(app) {
  if (!app.doc?.profile?.demo) return '';
  return `<button class="demo" data-act="limpar">
    <b>Dados de exemplo</b><span>Estes números são fictícios · toque para limpar e começar do zero</span>
  </button>`;
}

function tabbar(atual) {
  const pai = { cofrinhos: 'tudo', recebimentos: 'tudo', guia: 'tudo', revisao: 'painel' }[atual] || atual;
  return `<nav class="tabbar"><div class="in">
    ${TABS.map(([id, ic, label]) => `
      <button class="tab ${pai === id ? 'on' : ''}" data-go="${id}" aria-current="${pai === id ? 'page' : 'false'}">
        ${icon(ic)}<span>${label}</span>
      </button>`).join('')}
  </div></nav>`;
}

function header(app, { voltar } = {}) {
  const hoje = formatLong(app.todayISO);
  return `<div class="hd">
    <div class="greet">
      ${voltar
        ? `<span class="s" data-go="${voltar}" style="cursor:pointer">‹ ${TITULOS[voltar]}</span>`
        : `<span class="s">${esc(hoje)}</span>`}
      <span class="n">${TITULOS[app.screen]}</span>
    </div>
    <div class="acts">
      <button class="ib" data-act="tema" title="Tema" aria-label="Trocar tema">${icon('lua')}</button>
      <button class="ib" data-act="privacidade" title="Esconder valores" aria-label="Esconder valores">${icon('escudo')}</button>
      <button class="ib" data-go="revisao" title="Revisão" aria-label="Revisão">
        ${icon('sino')}${app.view.revisao.length ? '<span class="dot"></span>' : ''}
      </button>
    </div>
  </div>`;
}

// ============================================================ PAINEL

function painel(app) {
  const v = app.view;
  const temDivida = v.dividaTotalCents > 0;

  // App recém-criado: um "R$ 0" gigante não informa nada e ainda parece defeito.
  // Enquanto não há um número de verdade, o herói vira o primeiro passo.
  if (v.vazio) return painelVazio(app);

  const hero = temDivida
    ? `<div class="hero">
        <div class="top"><span class="lbl">Falta para você sair</span></div>
        <div class="big ser">${m(v.dividaTotalCents, brlShort)}</div>
        <div class="prog"><i style="width:${(v.progresso * 100).toFixed(0)}%"></i></div>
        <div class="foot">
          <span class="acc">${v.progresso > 0.005 ? `${(v.progresso * 100).toFixed(0)}% do caminho` : 'começo do plano'}${v.plano?.done ? ` · livre em ${formatMonthKey(v.plano.freeMonth)}` : ' · sem data ainda'}</span>
          <span class="pill bad">${icon('baixo')}${m(v.jurosDiaCents, (c) => formatCents(c))}/dia</span>
        </div>
      </div>`
    : `<div class="hero">
        <div class="top"><span class="lbl">Livre para gastar${v.proximaEntrada ? ` até ${formatShort(v.proximaEntrada)}` : ''}</span></div>
        <div class="big ser">${m(v.livre.cents, brlShort)}</div>
        <div class="foot">
          <span class="acc">${m(v.livre.perDayCents, (c) => brl(c))} por dia · ${v.livre.days} dias</span>
        </div>
      </div>`;

  const guia = v.guia.pendentes.length
    ? `<button class="nudge" data-go="guia">
        <span class="ic">${icon('ajuda')}</span>
        <div><b>${v.guia.pendentes.length === 1 ? 'Falta 1 coisa' : `Faltam ${v.guia.pendentes.length} coisas`} para configurar</b>
        <i>${esc(v.guia.pendentes.slice(0, 3).map((p) => p.label.toLowerCase()).join(', '))}</i></div>
        <span class="arr">${icon('seta')}</span>
      </button>`
    : '';

  // Cobrar backup de quem ainda não digitou nada é barulho: não há o que salvar.
  const backup = app.backup?.due && !v.vazio
    ? `<button class="nudge ${app.backup.severity === 'alta' ? 'crit' : ''}" data-act="backup">
        <span class="ic">${icon('download')}</span>
        <div><b>Hora do backup</b><i>${esc(backupMessage(app.backup))}</i></div>
        <span class="arr">${icon('seta')}</span>
      </button>`
    : '';

  return `
  ${header(app)}
  ${hero}
  ${guia}
  ${backup}

  <div class="quick">
    <button class="qa" data-act="novo"><div class="ic">${icon('mais')}</div><span>Lançar</span></button>
    <button class="qa" data-act="falar"><div class="ic">${icon('microfone')}</div><span>Por frase</span></button>
    <button class="qa" data-go="cartoes"><div class="ic">${icon('cartao')}</div><span>Fatura</span></button>
    <button class="qa" data-go="revisao"><div class="ic">${icon('lista')}</div><span>Revisão${v.revisao.length ? ` ${v.revisao.length}` : ''}</span></button>
  </div>

  <div class="wrow">
    <div class="w">
      <div class="t"><span class="l">Entra no mês</span><div class="ic">${icon('cima')}</div></div>
      <div class="v num">${m(v.rendaFixaCents + v.extrasMesCents, brlShort)}</div>
      <div class="s">${v.extrasMesCents ? `fixo + ${m(v.extrasMesCents, brlShort)} avulso` : 'salário e fixos'}</div>
      <div class="mc">${sparkline(serieEntradas(v), { color: 'var(--jade)' })}</div>
    </div>
    <div class="w">
      <div class="t"><span class="l">${v.dividaTotalCents ? 'Juros por dia' : 'Sai no mês'}</span><div class="ic">${icon('baixo')}</div></div>
      <div class="v num" style="color:var(--red)">${m(v.dividaTotalCents ? v.jurosDiaCents : v.fixosCents + v.parcelasDoMesCents, brlShort)}</div>
      <div class="s">${v.dividaTotalCents ? `${m(v.jurosMesCents, brlShort)} no mês` : `${m(v.parcelasDoMesCents, brlShort)} em parcelas`}</div>
      <div class="mc">${sparkline(serieSaldo(v), { color: 'var(--red)' })}</div>
    </div>
  </div>

  ${consultor(v)}

  ${v.cartoes.length ? `
  <div class="sec">
    <div class="sh"><h3>Meus cartões</h3><a data-go="cartoes">Todos ${v.cartoes.length}</a></div>
    <div class="cscroll">${v.cartoes.map(cartaoMini).join('')}</div>
  </div>` : ''}

  ${v.revisao.length ? `
  <div class="sec">
    <div class="sh"><h3>Para revisar</h3><a data-go="revisao">Revisar ${v.revisao.length}</a></div>
    <div class="list">${v.revisao.slice(0, 3).map((t) => linha(t, v)).join('')}</div>
  </div>` : ''}

  <div class="sec">
    <div class="sh"><h3>Últimos lançamentos</h3><a data-act="novo">Lançar</a></div>
    ${v.lancamentos.length
      ? `<div class="list">${v.lancamentos.slice(0, 8).map((t) => linha(t, v)).join('')}</div>`
      : `<div class="empty">Nada lançado ainda.<br>Toque em <b>Lançar</b> para começar.</div>`}
  </div>
  `;
}

const ICONE_DA_TELA = {
  cartoes: 'cartao', dividas: 'escudo', analise: 'grafico',
  tudo: 'menu', cofrinhos: 'cofre', recebimentos: 'dinheiro',
};

/**
 * O Painel de um app que ainda não tem dado nenhum.
 *
 * Aqui não existe número para mostrar, então o lugar do número é o caminho:
 * qual é o próximo passo, onde ele fica e por que ele importa. Cobrar backup
 * de quem ainda não digitou nada seria só barulho.
 */
function painelVazio(app) {
  const v = app.view;
  const proximo = v.guia.pendentes[0];

  return `
  ${header(app)}

  <div class="hero">
    <div class="top"><span class="lbl">Bem-vindo</span></div>
    <div class="big ser" style="font-size:clamp(26px,7.6vw,32px);line-height:1.25">Seu app está vazio<br>— e é assim mesmo.</div>
    <div class="foot"><span class="acc">nada aqui sai deste aparelho · ${v.guia.total} passos, uns 10 minutos</span></div>
  </div>

  ${proximo ? `
  <button class="nudge" data-go="${proximo.go}">
    <span class="ic">${icon(ICONE_DA_TELA[proximo.go] || 'ajuda')}</span>
    <div><b>Comece por: ${esc(proximo.label)}</b><i>${esc(proximo.where)} · ${esc(proximo.hint)}</i></div>
    <span class="arr">${icon('seta')}</span>
  </button>` : ''}

  <div class="quick">
    <button class="qa" data-act="novo-cartao"><div class="ic">${icon('cartao')}</div><span>Cartão</span></button>
    <button class="qa" data-act="nova-divida"><div class="ic">${icon('escudo')}</div><span>Dívida</span></button>
    <button class="qa" data-act="nova-renda"><div class="ic">${icon('dinheiro')}</div><span>Salário</span></button>
    <button class="qa" data-act="importar"><div class="ic">${icon('upload')}</div><span>Importar</span></button>
  </div>

  <div class="sec"><div class="say">
    <div class="k eb" style="color:var(--jade)">Por onde começar</div>
    <div class="q ser">Cadastre os cartões primeiro. O resto se encaixa neles.</div>
    <div class="p">O dia do fechamento é o que decide em qual fatura cada compra cai — e é
      isso que faz a projeção acertar. Depois vêm as dívidas com as taxas, o salário
      e os gastos fixos. Aí o app já consegue te dizer alguma coisa útil.</div>
  </div></div>

  <div class="sec">
    <div class="sh"><h3>Os ${v.guia.total} passos</h3><a data-go="guia">Ver o guia</a></div>
    <div class="list">
      ${v.guia.passos.map((p) => `
        <button class="row" data-go="${p.go}">
          <div class="ic">${icon(p.done ? 'check' : 'lista')}</div>
          <div class="bd"><div class="t">${esc(p.label)}</div><div class="s">${esc(p.where)}</div></div>
          <span class="arr">${icon('seta')}</span>
        </button>`).join('')}
    </div>
  </div>

  <p class="empty" style="font-size:11.5px;padding:22px 6px 0;text-align:left;line-height:1.65">
    Já usa outro app? <b data-act="importar" style="color:var(--jade);cursor:pointer">Importe o extrato</b>
    em CSV ou OFX e o Zero classifica quase tudo sozinho.
  </p>
  `;
}

/** A frase que traduz os números. Escolhe o que está mais urgente hoje. */
function consultor(v) {
  const diz = (cor, chapeu, frase, nota) => `
    <div class="sec"><div class="say">
      <div class="k eb" style="color:var(--${cor})">${esc(chapeu)}</div>
      <div class="q ser">${esc(frase)}</div>
      <div class="p">${esc(nota)}</div>
    </div></div>`;

  if (v.plano && !v.plano.viable) {
    return diz('red', 'O que isso quer dizer',
      `Sobram ${brl(v.orcamentoDivida)} e os mínimos pedem ${brl(v.minimosCents)}.`,
      'Nesta conta não existe plano que feche. Ou entra mais dinheiro, ou corta gasto fixo, ou você troca a dívida cara por uma mais barata. A tela de Dívidas mostra os três caminhos.');
  }

  if (v.jurosMesCents > 0 && v.orcamentoDivida > 0 && v.jurosMesCents > v.orcamentoDivida * 0.6) {
    return diz('red', 'O que isso quer dizer',
      `Dos ${brl(v.orcamentoDivida)} que sobram, ${brl(v.jurosMesCents)} vão embora só em juros.`,
      'Você paga e a dívida quase não anda. Enquanto o rotativo estiver de pé, é assim todo mês.');
  }

  if (v.projecao.firstNegative) {
    return diz('amber', 'Atenção no caixa',
      `Sua conta fica negativa em ${formatShort(v.projecao.firstNegative.date)}.`,
      `Faltam ${brl(Math.abs(v.projecao.firstNegative.cents))} nesse dia. Dá tempo de resolver: adie o que der, antecipe entrada ou corte agora.`);
  }

  if (v.piorCategoria) {
    const c = v.piorCategoria;
    return diz('amber', 'Ritmo do mês',
      `${c.name} já consumiu ${percent(c.ratio, 0)} do teto${c.breakDate ? ` e estoura dia ${parts(c.breakDate).d}` : ''}.`,
      `No ritmo de hoje você gasta ${brl(c.perDayCents)} por dia nessa categoria. Para fechar o mês, ${brl(c.safePerDayCents)} por dia.`);
  }

  if (v.plano?.done) {
    return diz('jade', 'Onde você está',
      `No ritmo de hoje você fica livre em ${formatMonthKey(v.plano.freeMonth)}.`,
      `São ${v.plano.monthsCount} meses pagando ${brl(v.orcamentoDivida)}. Cada real a mais por mês antecipa essa data.`);
  }

  return diz('jade', 'Onde você está',
    `Você tem ${brl(v.livre.cents)} livres até ${v.proximaEntrada ? formatShort(v.proximaEntrada) : 'o fim do período'}.`,
    'Isso já é o que sobra depois de honrar fatura, contas fixas e parcelas do período.');
}

const serieEntradas = (v) =>
  v.porMes.map((b) => b.inCents / 100).slice(0, 6).concat([0]).slice(0, 6);

const serieSaldo = (v) =>
  v.projecao.days.filter((_, i) => i % 6 === 0).map((d) => d.balanceCents / 100);

function cartaoMini(c) {
  const cor = { red: 'c-red', blue: 'c-blue', jade: 'c-jade', steel: 'c-steel' }[c.color] || 'c-blue';
  const valor = c.overdue ? Math.abs(c.overdue.balanceCents) : (c.nextStatement?.totalCents || 0);
  return `<button class="cmini ${cor}" data-go="cartoes">
    ${c.overdue ? '<span class="flag">EM ATRASO</span>' : ''}
    <div><div class="brand">${esc(c.name.toUpperCase())}</div>
      <div class="type">${c.overdue ? `vencida ${formatShort(c.overdue.since)}` : `fecha dia ${c.closingDay} · vence ${c.dueDay}`}</div></div>
    <div class="chip3"></div>
    <div class="n2">•• •• •• ${esc(String(c.id).slice(-4).padStart(4, '0'))}</div>
    <div class="bot">
      <div class="hold">${c.overdue ? 'Em atraso' : 'A pagar'}<b>${m(valor)}</b></div>
      ${c.overdue ? `<div style="font-size:10px;opacity:.85" class="n2">${percent(c.overdue.monthlyRate, 1)}/mês</div>` : ''}
    </div>
  </button>`;
}

function linha(t, v, { acao = 'editar' } = {}) {
  const cat = v.catById[t.categoryId];
  const positivo = t.amountCents > 0;
  const classe = positivo ? 'j' : t.installment ? 'a' : '';
  const ic = positivo ? 'dinheiro' : t.installment ? 'lista' : t.method === 'pix' ? 'pix' : t.cardId ? 'cartao' : 'banco';
  const legenda = [
    t.installment ? `Parcela ${t.installment.n}/${t.installment.of}` : cat?.name || 'sem categoria',
    formatShort(t.date),
  ].join(' · ');
  return `<button class="row" data-act="${acao}" data-id="${esc(t.id)}">
    <div class="ic ${classe}">${icon(ic)}</div>
    <div class="bd">
      <div class="t">${esc(t.description || 'Lançamento')}</div>
      <div class="s">${esc(legenda)}</div>
    </div>
    <div class="rt">
      <div class="amt num ${positivo ? 'pos' : ''}">${m(t.amountCents, (c) => formatCents(c, { sign: true }))}</div>
    </div>
  </button>`;
}

// ============================================================ CARTÕES

function cartoes(app) {
  const v = app.view;
  const contas = app.doc.accounts;

  return `
  ${header(app)}

  <div class="hero">
    <div class="top"><span class="lbl">Saldo nas contas</span></div>
    <div class="big ser">${m(v.saldoCents, brlShort)}</div>
    <div class="foot">
      <span class="acc">${m(v.guardadoCents, brlShort)} guardado · ${m(v.comprometidoCents, brlShort)} já comprometido em parcelas</span>
    </div>
  </div>

  <div class="sec">
    <div class="sh"><h3>Contas</h3><a data-act="nova-conta">Adicionar</a></div>
    ${contas.length ? `<div class="list">${contas.map((a) => `
      <button class="row" data-act="editar-conta" data-id="${esc(a.id)}">
        <div class="ic ${a.balanceCents < 0 ? 'r' : 'j'}">${icon(a.type === 'savings' ? 'cofre' : 'banco')}</div>
        <div class="bd"><div class="t">${esc(a.name)}</div>
          <div class="s">${a.type === 'savings' ? 'Reserva' : a.type === 'cash' ? 'Dinheiro' : 'Conta corrente'}</div></div>
        <div class="rt"><div class="amt num ${a.balanceCents < 0 ? 'neg' : ''}">${m(a.balanceCents)}</div></div>
      </button>`).join('')}</div>`
      : '<div class="empty">Nenhuma conta ainda.</div>'}
  </div>

  <div class="sec">
    <div class="sh"><h3>Cartões</h3><a data-act="novo-cartao">Adicionar</a></div>
    ${v.cartoes.length
      ? `<div class="cscroll">${v.cartoes.map(cartaoMini).join('')}</div>
         ${v.cartoes.map((c) => faturaCartao(c, v)).join('')}`
      : '<div class="empty">Cadastre um cartão para o app saber em qual fatura cada compra cai.</div>'}
  </div>

  ${v.muro.some((b) => b.cents > 0) ? `
  <div class="sec">
    <div class="sh"><h3>Muro de parcelas</h3><a>${m(v.comprometidoCents, brlShort)} até o fim</a></div>
    <div class="panel">${barras(v.muro.slice(0, 12))}</div>
  </div>` : ''}

  ${v.compras.length ? `
  <div class="sec">
    <div class="sh"><h3>Compras parceladas</h3></div>
    <div class="list">${v.compras.map((c) => `
      <div class="row">
        <div class="ic a">${icon('lista')}</div>
        <div class="bd"><div class="t">${esc(c.description)}</div>
          <div class="s">${c.current}/${c.of} · falta ${m(c.remainingCents, brlShort)} até ${formatShort(c.lastDueDate)}</div></div>
        <div class="rt"><div class="amt num">${m(c.monthlyCents)}</div><div class="dt">por mês</div></div>
      </div>`).join('')}</div>
    <p class="empty" style="padding:14px 4px 0;text-align:left;font-size:11.5px">
      Antecipar parcela não economiza nada: o juro já está embutido no valor de cada uma.
    </p>
  </div>` : ''}
  `;
}

function faturaCartao(c, v) {
  const s = c.nextStatement;
  const usoCor = c.usedRatio > 0.8 ? 'var(--red)' : c.usedRatio > 0.5 ? 'var(--amber)' : 'var(--jade)';
  return `<div class="debt">
    <div class="top">
      <div><div class="nm">${esc(c.name)}</div>
        <div class="rate" style="color:var(--muted)">fecha dia ${c.closingDay} · vence dia ${c.dueDay}</div></div>
      <button class="ib" data-act="editar-cartao" data-id="${esc(c.id)}" aria-label="Editar cartão">${icon('engrenagem')}</button>
    </div>
    <div class="ft" style="margin:0 0 10px">
      <span class="s" style="font-size:11px;color:var(--muted)">Fatura aberta · fecha ${formatShort(c.cycle.closeDate)}</span>
      <b class="num">${m(c.openCents)}</b>
    </div>
    ${s ? `<div class="ft" style="margin:0 0 10px">
      <span class="s" style="font-size:11px;color:var(--muted)">A pagar · vence ${formatShort(s.dueDate)}</span>
      <b class="num">${m(s.totalCents)}</b>
    </div>` : ''}
    ${c.overdue ? `<div class="nudge crit" style="margin:10px 0 0">
      <span class="ic">${icon('alerta')}</span>
      <div><b>Fatura em atraso · ${m(Math.abs(c.overdue.balanceCents))}</b>
      <i>rotativo a ${percent(c.overdue.monthlyRate, 1)} ao mês — ${percent(Math.pow(1 + c.overdue.monthlyRate, 12) - 1, 0)} ao ano</i></div>
    </div>` : ''}
    ${c.limitCents ? `
    <div class="bar" style="margin-top:12px"><i style="width:${(c.usedRatio * 100).toFixed(0)}%;background:${usoCor}"></i></div>
    <div class="ft"><span style="font-size:10.5px;color:var(--muted)">limite usado</span>
      <span style="font-size:10.5px;color:var(--muted)">${m(c.availableCents, brlShort)} livre de ${m(c.limitCents, brlShort)}</span></div>` : ''}
  </div>`;
}

/** Barras do muro de parcelas — 12 meses, altura proporcional. */
function barras(meses) {
  const maior = Math.max(1, ...meses.map((b) => b.cents));
  return `<div style="display:flex;align-items:flex-end;gap:5px;height:110px">
    ${meses.map((b) => `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;height:100%">
        <div style="width:100%;border-radius:5px 5px 2px 2px;background:${b.cents ? 'var(--jade)' : 'var(--line)'};
             height:${Math.max(3, (b.cents / maior) * 78)}%" title="${esc(brl(b.cents))}"></div>
        <span style="font-size:8.5px;color:var(--muted);letter-spacing:.03em">${monthAbbr(b.month).slice(0, 3)}</span>
      </div>`).join('')}
  </div>
  <div class="ft"><span style="font-size:10.5px;color:var(--muted)">próximos 12 meses</span>
    <span style="font-size:10.5px;color:var(--muted)">maior mês ${m(maior, brlShort)}</span></div>`;
}

// ============================================================ DÍVIDAS

function dividas(app) {
  const v = app.view;
  if (!v.dividas.length) {
    return `${header(app)}
      <div class="empty" style="margin-top:40px">
        Nenhuma dívida cadastrada.<br><br>
        Se você tem fatura atrasada ou cheque especial, cadastre aqui com a taxa —
        ela vem escrita na fatura e no extrato.
      </div>
      <div class="btns"><button class="btn primary" data-act="nova-divida">${icon('mais')} Cadastrar dívida</button></div>`;
  }

  const plano = v.plano;
  const so_minimo = v.planoMinimo;
  const ganho = plano?.done && so_minimo?.done ? comparePlans(so_minimo, plano) : null;

  return `
  ${header(app)}

  <div class="hero">
    <div class="top"><span class="lbl">Você deve hoje</span></div>
    <div class="big ser">${m(v.dividaTotalCents, brlShort)}</div>
    <div class="prog"><i style="width:${(v.progresso * 100).toFixed(0)}%"></i></div>
    <div class="foot">
      <span class="acc">${plano?.done ? `livre em ${formatMonthKey(plano.freeMonth)} · ${plano.monthsCount} meses` : 'sem data com o valor de hoje'}</span>
      <span class="pill bad">${m(v.jurosDiaCents, (c) => formatCents(c))}/dia</span>
    </div>
  </div>

  ${!plano?.viable ? `
    <div class="nudge crit">
      <span class="ic">${icon('alerta')}</span>
      <div><b>Com ${m(v.orcamentoDivida, brlShort)} por mês não fecha</b>
      <i>só os mínimos pedem ${m(v.minimosCents, brlShort)}. Enquanto isso a dívida cresce todo mês.</i></div>
    </div>` : ''}

  <div class="sec">
    <div class="sh"><h3>Quanto vou pagar por mês</h3><a data-act="orcamento-divida">Mudar</a></div>
    <div class="panel">
      <div class="ft" style="margin:0">
        <span style="font-size:12.5px;color:var(--muted)">Destinado às dívidas</span>
        <b class="num" style="font-size:19px">${m(v.orcamentoDivida)}</b>
      </div>
      <div class="ft"><span style="font-size:11px;color:var(--muted)">Mínimos obrigatórios</span>
        <span class="num" style="font-size:12px;color:${v.minimosCents > v.orcamentoDivida ? 'var(--red)' : 'var(--muted)'}">${m(v.minimosCents)}</span></div>
      <div class="ft"><span style="font-size:11px;color:var(--muted)">Juros do mês</span>
        <span class="num" style="font-size:12px;color:var(--red)">${m(v.jurosMesCents)}</span></div>
      <div class="ft"><span style="font-size:11px;color:var(--muted)">Vai abater da dívida</span>
        <span class="num" style="font-size:12px;color:var(--jade)">${m(Math.max(0, v.orcamentoDivida - v.jurosMesCents))}</span></div>
      <p style="font-size:11px;color:var(--muted);line-height:1.6;margin-top:12px;border-top:1px solid var(--line-2);padding-top:10px">
        Sai de ${m(v.rendaFixaCents, brlShort)} de entrada menos ${m(v.custoVida.cents, brlShort)} de custo de vida
        ${v.custoVida.source === 'histórico'
          ? `(média de ${v.custoVida.months} ${v.custoVida.months === 1 ? 'mês fechado' : 'meses fechados'})`
          : '(só os fixos cadastrados — este número está por baixo até você ter dois meses de histórico)'}
        e ${m(v.parcelasDoMesCents, brlShort)} de parcelas. Toque em Mudar se você consegue mais.
      </p>
    </div>
  </div>

  <div class="sec">
    <div class="sh"><h3>A ordem certa de pagar</h3></div>
    <div class="segs">
      <button class="seg ${(app.doc.settings.debtMethod || 'avalanche') === 'avalanche' ? 'on' : ''}" data-act="metodo" data-v="avalanche">Maior juro</button>
      <button class="seg ${app.doc.settings.debtMethod === 'snowball' ? 'on' : ''}" data-act="metodo" data-v="snowball">Menor saldo</button>
    </div>
    ${v.dividas.map((d, i) => dividaCard(d, i, plano, v)).join('')}
    <button class="btn ghost" data-act="nova-divida" style="width:100%;margin-top:8px">${icon('mais')} Cadastrar outra</button>
  </div>

  ${ganho && ganho.savedInterestCents > 0 ? `
  <div class="sec"><div class="say">
    <div class="k eb" style="color:var(--jade)">O que o plano vale</div>
    <div class="q ser">Seguindo esta ordem você economiza ${brl(ganho.savedInterestCents)} e sai ${ganho.savedMonths} meses antes.</div>
    <div class="p">A comparação é contra pagar só o mínimo de cada dívida — que é o caminho natural de quem não tem plano.</div>
  </div></div>` : ''}

  ${plano?.done ? `
  <div class="sec">
    <div class="sh"><h3>Como a dívida cai</h3><a>${horizon(plano)}</a></div>
    <div class="panel">${curvaPlano(plano)}</div>
  </div>` : ''}

  <div class="sec">
    <div class="sh"><h3>Caminhos se não fecha</h3></div>
    <div class="list">
      <button class="row" data-act="simular-troca">
        <div class="ic a">${icon('grafico')}</div>
        <div class="bd"><div class="t">Trocar por empréstimo mais barato</div>
          <div class="s">rotativo a ${percent(v.dividas[0]?.monthlyRate || 0, 1)}/mês contra consignado a 1,8%/mês</div></div>
        <span class="arr">${icon('seta')}</span>
      </button>
      <button class="row" data-go="analise">
        <div class="ic">${icon('grafico')}</div>
        <div class="bd"><div class="t">Cortar gasto fixo</div>
          <div class="s">cada ${brl(10000)} a menos por mês antecipa a saída</div></div>
        <span class="arr">${icon('seta')}</span>
      </button>
      <button class="row" data-go="recebimentos">
        <div class="ic j">${icon('dinheiro')}</div>
        <div class="bd"><div class="t">Aumentar a entrada</div>
          <div class="s">avulsos deste mês: ${m(v.extrasMesCents, brlShort)}</div></div>
        <span class="arr">${icon('seta')}</span>
      </button>
    </div>
  </div>
  `;
}

function dividaCard(d, i, plano, v) {
  const nome = { [KIND.REVOLVING]: 'Rotativo', [KIND.OVERDRAFT]: 'Cheque especial', [KIND.LOAN]: 'Empréstimo', [KIND.INSTALLMENT]: 'Parcelamento' }[d.kind] || 'Dívida';
  const quitacao = plano?.payoffByDebt?.find((p) => p.id === d.id)?.month;
  const anual = d.monthlyRate ? Math.pow(1 + d.monthlyRate, 12) - 1 : 0;

  // Dado já guardado antes de o app passar a barrar valores impossíveis. O
  // cálculo não usa mais esse número solto, mas quem cadastrou precisa saber
  // que ele está errado — em vez de o app fingir que está tudo certo.
  const implausivel = (d.minPaymentRate || 0) > 1
    ? `${(d.minPaymentRate * 100).toFixed(0)}% de pagamento mínimo`
    : (d.monthlyRate || 0) > 1 ? `${(d.monthlyRate * 100).toFixed(0)}% de juros ao mês` : null;

  return `<div class="debt">
    <div class="top">
      <div>
        <div class="nm">${i === 0 ? '1º alvo · ' : ''}${esc(d.name)}</div>
        <div class="rate" style="color:${d.monthlyRate >= 0.1 ? 'var(--red)' : 'var(--amber)'}">
          ${esc(nome)} · ${percent(d.monthlyRate || 0, 1)} AO MÊS · ${percent(anual, 0)} AO ANO
        </div>
      </div>
      <button class="ib" data-act="editar-divida" data-id="${esc(d.id)}" aria-label="Editar dívida">${icon('engrenagem')}</button>
    </div>
    <div class="ft" style="margin:0">
      <span style="font-size:11px;color:var(--muted)">Saldo</span>
      <b class="num" style="font-size:17px">${m(Math.abs(d.balanceCents))}</b>
    </div>
    <div class="ft"><span style="font-size:11px;color:var(--muted)">Custa parada</span>
      <span class="num" style="font-size:12px;color:var(--red)">${m(Math.round(Math.abs(d.balanceCents) * (d.monthlyRate || 0) / 30))}/dia</span></div>
    ${quitacao ? `<div class="ft"><span style="font-size:11px;color:var(--muted)">Quita em</span>
      <span class="num" style="font-size:12px;color:var(--jade)">${formatMonthKey(quitacao)}</span></div>` : ''}
    ${implausivel ? `<button class="nudge crit" data-act="editar-divida" data-id="${esc(d.id)}" style="margin:10px 0 0;width:100%">
      <span class="ic">${icon('alerta')}</span>
      <div><b>Confira esta dívida</b><i>está cadastrada com ${esc(implausivel)}, o que não existe.
        Provavelmente um valor em reais foi digitado no campo de porcentagem. Toque para corrigir.</i></div>
      <span class="arr">${icon('seta')}</span>
    </button>` : ''}
  </div>`;
}

/** A curva do saldo devedor mês a mês — a linha que desce. */
function curvaPlano(plano) {
  const pontos = plano.months.map((mth) => mth.totalCents);
  const maior = Math.max(1, ...pontos);
  const w = 300, h = 90;
  const d = pontos.map((p, i) => `${((i / Math.max(1, pontos.length - 1)) * w).toFixed(1)},${(h - (p / maior) * h).toFixed(1)}`);
  return `<div class="chart">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:90px">
      <polyline points="${d.join(' ')}" fill="none" stroke="var(--jade)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="0,${h} ${d.join(' ')} ${w},${h}" fill="var(--jade-soft)" stroke="none" opacity=".55"/>
    </svg>
  </div>
  <div class="ft"><span style="font-size:10.5px;color:var(--muted)">${formatMonthKey(plano.months[0].month)}</span>
    <span style="font-size:10.5px;color:var(--muted)">${formatMonthKey(plano.freeMonth)} · zero</span></div>
  <div class="ft"><span style="font-size:11px;color:var(--muted)">Juros que ainda vai pagar</span>
    <span class="num" style="font-size:12px;color:var(--red)">${m(plano.totalInterestCents)}</span></div>`;
}

// ============================================================ ANÁLISE

function analise(app) {
  const v = app.view;
  const s = v.saude;

  return `
  ${header(app)}

  <div class="sec" style="margin-top:0">
    <div class="sh"><h3>Caixa nos próximos 90 dias</h3>
      <a class="${v.projecao.firstNegative ? 'warn' : ''}">${v.projecao.firstNegative ? `negativo ${formatShort(v.projecao.firstNegative.date)}` : 'sem furo'}</a></div>
    <div class="panel">${curvaCaixa(v.projecao)}</div>
  </div>

  <div class="wrow three">
    ${kpi('Custo mínimo', m(s.minimumCost.cents, brlShort), s.minimumCost.confident ? `média de ${s.minimumCost.months} meses` : 'ainda estimando')}
    ${kpi('Reserva', `${s.emergency.months.toFixed(1)} m`, `alvo ${s.emergency.targetMonths} meses`)}
    ${kpi('Patrimônio', m(s.netWorth.netCents, brlShort), s.netWorth.netCents < 0 ? 'negativo' : 'líquido')}
  </div>

  ${v.orcamento.length ? `
  <div class="sec">
    <div class="sh"><h3>Tetos do mês</h3><a data-act="tetos">Ajustar</a></div>
    ${v.orcamentoGeral ? `<div class="panel" style="margin-bottom:10px">
      <div class="ft" style="margin:0 0 8px">
        <span style="font-size:12.5px">${m(v.orcamentoGeral.spentCents)} de ${m(v.orcamentoGeral.limitCents)}</span>
        <span class="tag" style="background:var(--${v.orcamentoGeral.overPace ? 'red-soft' : 'jade-soft'});color:var(--${v.orcamentoGeral.overPace ? 'red' : 'jade'})">
          ${v.orcamentoGeral.overPace ? 'ACIMA DO RITMO' : 'NO RITMO'}</span>
      </div>
      ${barraRitmo(v.orcamentoGeral)}
      <div class="ft"><span style="font-size:10.5px;color:var(--muted)">a marca escura é onde você deveria estar hoje</span>
        <span style="font-size:10.5px;color:var(--muted)">${m(v.orcamentoGeral.safePerDayCents)}/dia até fechar</span></div>
    </div>` : ''}
    ${v.orcamento.map(categoria).join('')}
  </div>` : `
  <div class="sec">
    <div class="sh"><h3>Tetos do mês</h3></div>
    <div class="empty">Sem teto definido.<br>Sem teto o app não consegue avisar quando o ritmo está errado.
      <div class="btns" style="justify-content:center"><button class="btn primary" data-act="tetos">Definir tetos</button></div>
    </div>
  </div>`}

  <div class="sec">
    <div class="sh"><h3>Fixo contra variável</h3><a>${percent(v.fixoVariavel.fixedRatio, 0)} fixo</a></div>
    <div class="panel">
      <div style="display:flex;height:14px;border-radius:100px;overflow:hidden;background:var(--surface-2)">
        <div style="width:${(v.fixoVariavel.fixedRatio * 100).toFixed(0)}%;background:var(--blue)"></div>
        <div style="flex:1;background:var(--amber)"></div>
      </div>
      <div class="legend">
        <span><i style="background:var(--blue)"></i>Fixo ${m(v.fixoVariavel.fixedCents, brlShort)}</span>
        <span><i style="background:var(--amber)"></i>Variável ${m(v.fixoVariavel.variableCents, brlShort)}</span>
      </div>
      <p style="font-size:11.5px;color:var(--muted);line-height:1.6;margin-top:10px">
        Cortar fixo dói uma vez e economiza todo mês. Cortar variável dói todo mês.
      </p>
    </div>
  </div>

  ${v.vazamentos.findings.length ? `
  <div class="sec">
    <div class="sh"><h3>Vazamentos</h3><a>${m(v.vazamentos.totalYearlyCents, brlShort)}/ano</a></div>
    <div class="list">${v.vazamentos.findings.map((f) => `
      <div class="row">
        <div class="ic ${f.type === 'duplicada' ? 'r' : 'a'}">${icon(f.type === 'duplicada' ? 'x' : 'cima')}</div>
        <div class="bd"><div class="t">${esc(f.name)}</div>
          <div class="s">${f.type === 'duplicada'
            ? `cobrado duas vezes em ${f.daysApart} ${f.daysApart === 1 ? 'dia' : 'dias'}`
            : `subiu de ${brl(f.fromCents)} para ${brl(f.toCents)}`}</div></div>
        <div class="rt"><div class="amt num" style="color:var(--red)">${m(f.yearlyCents, brlShort)}</div><div class="dt">no ano</div></div>
      </div>`).join('')}</div>
  </div>` : ''}

  ${v.vazamentos.recurring.length ? `
  <div class="sec">
    <div class="sh"><h3>Assinaturas encontradas</h3><a>${m(v.vazamentos.monthlySubscriptionsCents, brlShort)}/mês</a></div>
    <div class="list">${v.vazamentos.recurring.slice(0, 8).map((r) => `
      <div class="row">
        <div class="ic">${icon('relogio')}</div>
        <div class="bd"><div class="t">${esc(r.name)}</div>
          <div class="s">${r.period} · ${r.occurrences} cobranças · última ${formatShort(r.lastDate)}</div></div>
        <div class="rt"><div class="amt num">${m(r.lastAmountCents)}</div><div class="dt">${m(r.yearlyCents, brlShort)}/ano</div></div>
      </div>`).join('')}</div>
  </div>` : ''}

  <div class="sec">
    <div class="sh"><h3>Diagnóstico</h3></div>
    <div class="panel">
      ${indicador('Custo de vida mínimo', m(s.minimumCost.cents),
        s.minimumCost.confident
          ? `Média das categorias essenciais nos últimos ${s.minimumCost.months} meses. É a sua linha de água.`
          : 'Preciso de pelo menos 3 meses de histórico para ter confiança neste número.')}
      ${indicador('Reserva de emergência', `${s.emergency.months.toFixed(1)} meses`,
        `Você tem ${brl(s.emergency.savedCents)} guardados. Para ${s.emergency.targetMonths} meses faltam ${brl(s.emergency.missingCents)}.`)}
      ${indicador('Juros sobre a renda', percent(s.interestRatio, 1),
        s.monthlyInterestCents > 0
          ? `${brl(s.monthlyInterestCents)} por mês só de juros. Esse dinheiro não compra nada.`
          : 'Você não paga juros hoje. É a melhor posição possível.')}
      ${indicador('Para onde vai o dinheiro',
        `${percent(s.allocation.essentialRatio, 0)} essencial`,
        `${percent(s.allocation.discretionaryRatio, 0)} supérfluo · ${percent(s.allocation.investedRatio, 0)} guardado.`)}
    </div>
  </div>
  `;
}

const kpi = (label, valor, sub) => `<div class="w">
  <div class="t"><span class="l">${esc(label)}</span></div>
  <div class="v num">${valor}</div><div class="s">${esc(sub)}</div>
</div>`;

const indicador = (nome, valor, texto) => `<div class="gi">
  <span class="bx dot"></span>
  <div><b>${esc(nome)} · ${valor}</b><i>${esc(texto)}</i></div>
</div>`;

function barraRitmo(p) {
  const cor = p.exceeded ? 'var(--red)' : p.overPace ? 'var(--amber)' : 'var(--jade)';
  return `<div class="bar">
    <i style="width:${Math.min(100, p.ratio * 100).toFixed(0)}%;background:${cor}"></i>
    <span class="pace" style="left:${Math.min(100, p.expectedRatio * 100).toFixed(0)}%"></span>
  </div>`;
}

function categoria(c) {
  const cor = c.exceeded ? 'red' : c.overPace ? 'amber' : 'jade';
  return `<div class="cat">
    <div class="ic" style="background:var(--${cor}-soft);color:var(--${cor})">${icon('lista')}</div>
    <div class="bd">
      <div class="tp"><span class="nm">${esc(c.name)}</span>
        <span class="am num">${m(c.spentCents, brlShort)} <span style="color:var(--muted);font-weight:400">de ${m(c.limitCents, brlShort)}</span></span></div>
      ${barraRitmo(c)}
      <div class="note">${c.exceeded
        ? `estourou em ${brl(c.spentCents - c.limitCents)}`
        : c.breakDate
          ? `no ritmo de hoje estoura dia ${parts(c.breakDate).d} · ${brl(c.safePerDayCents)}/dia para fechar`
          : `${brl(c.remainingCents)} restantes · ${brl(c.safePerDayCents)}/dia`}</div>
    </div>
  </div>`;
}

/** Linha do saldo projetado com a faixa do zero marcada. */
function curvaCaixa(proj) {
  const passo = Math.ceil(proj.days.length / 60);
  const pontos = proj.days.filter((_, i) => i % passo === 0).map((d) => d.balanceCents);
  const maior = Math.max(...pontos, 0);
  const menor = Math.min(...pontos, 0);
  const span = maior - menor || 1;
  const w = 300, h = 100;
  const y = (c) => h - ((c - menor) / span) * h;
  const d = pontos.map((p, i) => `${((i / Math.max(1, pontos.length - 1)) * w).toFixed(1)},${y(p).toFixed(1)}`);
  const zero = y(0);
  const negativo = !!proj.firstNegative;

  return `<div class="chart">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:100px">
      <line x1="0" y1="${zero.toFixed(1)}" x2="${w}" y2="${zero.toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="4 4"/>
      <polyline points="${d.join(' ')}" fill="none" stroke="var(--${negativo ? 'red' : 'jade'})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  </div>
  <div class="ft" style="margin-top:6px">
    <span style="font-size:10.5px;color:var(--muted)">hoje ${m(proj.days[0].balanceCents, brlShort)}</span>
    <span style="font-size:10.5px;color:var(--muted)">menor ${m(proj.min.cents, brlShort)} em ${formatShort(proj.min.date)}</span>
  </div>
  ${negativo ? `<div class="nudge crit" style="margin-top:10px">
    <span class="ic">${icon('alerta')}</span>
    <div><b>Fica negativo em ${formatShort(proj.firstNegative.date)}</b>
    <i>faltam ${brl(Math.abs(proj.firstNegative.cents))} nesse dia · são ${daysBetween(proj.days[0].date, proj.firstNegative.date)} dias para resolver</i></div>
  </div>` : ''}`;
}

// ============================================================ TUDO

function tudo(app) {
  const v = app.view;
  const item = (act, ic, titulo, sub, classe = '') => `
    <button class="row" data-${act.startsWith('go:') ? 'go' : 'act'}="${act.replace('go:', '')}">
      <div class="ic ${classe}">${icon(ic)}</div>
      <div class="bd"><div class="t">${esc(titulo)}</div><div class="s">${esc(sub)}</div></div>
      <span class="arr">${icon('seta')}</span>
    </button>`;

  return `
  ${header(app)}

  <div class="sec" style="margin-top:0">
    <div class="sh"><h3>Dinheiro</h3></div>
    <div class="list">
      ${item('go:recebimentos', 'dinheiro', 'Recebimentos', `fixo ${m(v.rendaFixaCents, brlShort)} · avulsos ${m(v.extrasMesCents, brlShort)} este mês`, 'j')}
      ${item('go:cofrinhos', 'cofre', 'Cofrinhos', `${app.doc.goals.length} · ${m(v.guardadoCents, brlShort)} guardado`)}
      ${item('fixos', 'relogio', 'Gastos fixos', `${app.doc.recurring.filter((r) => r.kind === 'expense').length} contas · ${m(v.fixosCents, brlShort)} por mês`)}
      ${item('tetos', 'grafico', 'Tetos por categoria', `${Object.keys(app.doc.budgets || {}).length} categorias com limite`)}
      ${item('patrimonio', 'banco', 'Patrimônio', `${m(v.saude.netWorth.netCents, brlShort)} líquido hoje`)}
      ${item('projetos', 'carro', 'Projetos de vida', `${app.doc.projects.length} · carro, casa, o que você quiser medir junto`)}
      ${item('go:guia', 'ajuda', 'Como usar o Zero', `${v.guia.feitos} de ${v.guia.total} passos feitos${v.guia.pendentes.length ? ` · faltam ${v.guia.pendentes.length}` : ''}`, 'a')}
    </div>
  </div>

  <div class="sec">
    <div class="sh"><h3>Seus dados</h3></div>
    <div class="list">
      ${item('backup', 'download', 'Fazer backup agora', app.backup ? backupMessage(app.backup) : 'exporta um arquivo cifrado')}
      ${item('restaurar', 'upload', 'Restaurar de um backup', 'substitui tudo que está aqui pelo arquivo')}
      ${item('importar', 'lista', 'Importar extrato', 'CSV ou OFX do banco e da fatura')}
      ${item('exportar-csv', 'grafico', 'Exportar para planilha', 'CSV com todos os lançamentos')}
      ${item('seguranca', 'cadeado', 'Segurança e espaço', 'como o cofre está trancado e quanto ele ocupa')}
    </div>
  </div>

  <div class="sec">
    <div class="sh"><h3>Ajustes</h3></div>
    <div class="list">
      ${item('perfil', 'engrenagem', 'Seu nome e renda', esc(app.doc.profile.name || 'não preenchido'))}
      ${item('tema', 'lua', 'Tema', app.doc.settings.theme === 'auto' ? 'segue o sistema' : app.doc.settings.theme === 'dark' ? 'escuro' : 'claro')}
      ${item('limpar', 'lista', app.doc.profile?.demo ? 'Sair do exemplo e começar do zero' : 'Limpar os dados',
        'zera os lançamentos e mantém suas doze palavras', 'a')}
      ${item('apagar', 'x', 'Apagar tudo, inclusive o cofre', 'refaz as doze palavras do começo', 'r')}
    </div>
  </div>

  <p class="empty" style="font-size:11px;text-align:center;padding:24px 20px 0">
    Zero ${esc(app.doc.version ? `· documento v${app.doc.version}` : '')}<br>
    Tudo roda neste aparelho. Nenhum dado sai daqui.
  </p>
  `;
}

// ============================================================ COFRINHOS

function cofrinhos(app) {
  const v = app.view;
  const metas = app.doc.goals;
  const ativos = metas.filter((g) => g.status !== 'pausado');
  const mensal = ativos.reduce((a, g) => a + (g.monthlyCents || 0), 0);

  return `
  ${header(app, { voltar: 'tudo' })}

  <div class="hero">
    <div class="top"><span class="lbl">Guardado ao todo</span></div>
    <div class="big ser">${m(v.guardadoCents, brlShort)}</div>
    <div class="foot"><span class="acc">${ativos.length} ativo${ativos.length === 1 ? '' : 's'} · ${m(mensal, brlShort)} por mês</span></div>
  </div>

  ${v.dividaTotalCents > 0 ? `
  <div class="nudge">
    <span class="ic">${icon('alerta')}</span>
    <div><b>Guardar rendendo menos do que a dívida cobra é prejuízo</b>
    <i>a exceção é a reserva de emergência — sem ela, o próximo imprevisto volta pro cartão.
       O resto pode esperar você sair do vermelho.</i></div>
  </div>` : ''}

  <div class="sec">
    <div class="sh"><h3>Seus cofrinhos</h3><a data-act="novo-cofrinho">Criar</a></div>
    ${metas.length ? metas.map(cofrinho).join('')
      : '<div class="empty">Nenhum cofrinho ainda.<br>Comece pela reserva de emergência.</div>'}
  </div>
  `;
}

function cofrinho(g) {
  const ratio = g.targetCents ? Math.min(1, g.savedCents / g.targetCents) : 0;
  const falta = Math.max(0, g.targetCents - g.savedCents);
  const meses = g.monthlyCents > 0 ? Math.ceil(falta / g.monthlyCents) : null;
  return `<div class="goal ${g.status === 'pausado' ? 'off' : ''}">
    <div class="tp">
      <div style="display:flex;gap:11px;align-items:center;min-width:0">
        <div class="ic" style="background:var(--jade-soft);color:var(--jade)">${icon(g.kind === 'reserva' ? 'escudo' : 'cofre')}</div>
        <div style="min-width:0"><div class="nm">${esc(g.name)}</div>
          <div class="sb">${g.status === 'pausado' ? 'pausado' : meses !== null ? `${meses} ${meses === 1 ? 'mês' : 'meses'} no ritmo atual` : 'sem aporte definido'}</div></div>
      </div>
      <button class="ib" data-act="editar-cofrinho" data-id="${esc(g.id)}" aria-label="Editar">${icon('engrenagem')}</button>
    </div>
    <div class="bar"><i style="width:${(ratio * 100).toFixed(0)}%;background:var(--jade)"></i></div>
    <div class="ft">
      <span class="num" style="font-size:12px">${m(g.savedCents, brlShort)} de ${m(g.targetCents, brlShort)}</span>
      <span style="font-size:11px;color:var(--muted)">${g.monthlyCents ? `${m(g.monthlyCents, brlShort)}/mês` : 'parado'}</span>
    </div>
  </div>`;
}

// ============================================================ RECEBIMENTOS

function recebimentos(app) {
  const v = app.view;
  const fixos = app.doc.recurring.filter((r) => r.kind === 'income');
  const avulsos = app.doc.transactions
    .filter((t) => t.amountCents > 0 && t.extraordinary)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 12);
  const mediaAvulsos = mediaMensal(app.doc.transactions.filter((t) => t.amountCents > 0 && t.extraordinary), v.mes);

  return `
  ${header(app, { voltar: 'tudo' })}

  <div class="hero">
    <div class="top"><span class="lbl">Entra por mês</span></div>
    <div class="big ser">${m(v.rendaFixaCents + mediaAvulsos, brlShort)}</div>
    <div class="foot">
      <span class="acc">${m(v.rendaFixaCents, brlShort)} garantido + ${m(mediaAvulsos, brlShort)} de média nos avulsos</span>
    </div>
  </div>

  <div class="sec">
    <div class="say">
      <div class="k eb" style="color:var(--jade)">Como usar os avulsos</div>
      <div class="q ser">Planeje com o que é garantido. Trate o avulso como bônus.</div>
      <div class="p">Trader esportivo, Pix de serviço por fora, reembolso — entram e somem. Se o
        orçamento depende deles, um mês fraco vira dívida nova. Aqui eles ficam
        separados de propósito.</div>
    </div>
  </div>

  <div class="sec">
    <div class="sh"><h3>Entrada garantida</h3><a data-act="nova-renda">Adicionar</a></div>
    ${fixos.length ? `<div class="list">${fixos.map((r) => `
      <button class="row" data-act="editar-renda" data-id="${esc(r.id)}">
        <div class="ic j">${icon('dinheiro')}</div>
        <div class="bd"><div class="t">${esc(r.label)}</div><div class="s">todo dia ${r.dayOfMonth}</div></div>
        <div class="rt"><div class="amt num pos">${m(r.amountCents)}</div></div>
      </button>`).join('')}</div>` : '<div class="empty">Cadastre o salário para a projeção funcionar.</div>'}
  </div>

  <div class="sec">
    <div class="sh"><h3>Avulsos</h3><a data-act="novo-avulso">Lançar</a></div>
    ${avulsos.length ? `<div class="list">${avulsos.map((t) => `
      <button class="row" data-act="editar" data-id="${esc(t.id)}">
        <div class="ic j">${icon(t.method === 'pix' ? 'pix' : 'dinheiro')}</div>
        <div class="bd"><div class="t">${esc(t.description)}</div><div class="s">${formatShort(t.date)}</div></div>
        <div class="rt"><div class="amt num pos">${m(t.amountCents, (c) => formatCents(c, { sign: true }))}</div></div>
      </button>`).join('')}</div>` : '<div class="empty">Nenhum recebimento avulso lançado.</div>'}
  </div>
  `;
}

function mediaMensal(lista, mesAtual) {
  const meses = new Map();
  for (const t of lista) {
    const k = t.competence || t.date.slice(0, 7);
    if (k >= mesAtual) continue; // mês corrente ainda está incompleto
    meses.set(k, (meses.get(k) || 0) + t.amountCents);
  }
  const vals = [...meses.values()];
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

// ============================================================ REVISÃO

function revisao(app) {
  const v = app.view;
  return `
  ${header(app, { voltar: 'painel' })}

  <div class="sec" style="margin-top:0">
    <div class="sh"><h3>Sem categoria</h3><a>${v.revisao.length}</a></div>
    ${v.revisao.length ? `<div class="list">${v.revisao.map((t) => `
      <button class="row" data-act="categorizar" data-id="${esc(t.id)}">
        <div class="ic ${t.categoryId ? 'a' : ''}">${icon(t.method === 'pix' ? 'pix' : t.cardId ? 'cartao' : 'banco')}</div>
        <div class="bd"><div class="t">${esc(t.description)}</div>
          <div class="s">${t.categoryId
            ? `sugestão: ${esc(v.catById[t.categoryId]?.name || t.categoryId)} · ${esc(t.categorySource || '')}`
            : 'o app não soube — me diga uma vez e ele guarda'} · ${formatShort(t.date)}</div></div>
        <div class="rt"><div class="amt num">${m(t.amountCents, (c) => formatCents(c, { sign: true }))}</div></div>
      </button>`).join('')}</div>`
      : '<div class="empty">Nada para revisar. Tudo categorizado.</div>'}
  </div>

  ${v.vazamentos.findings.length ? `
  <div class="sec">
    <div class="sh"><h3>Avisos da semana</h3></div>
    <div class="list">${v.vazamentos.findings.slice(0, 5).map((f) => `
      <div class="row">
        <div class="ic ${f.type === 'duplicada' ? 'r' : 'a'}">${icon('alerta')}</div>
        <div class="bd"><div class="t">${esc(f.name)}</div>
          <div class="s">${f.type === 'duplicada' ? 'cobrança duplicada' : `preço subiu ${brl(f.deltaCents)}`}</div></div>
        <div class="rt"><div class="amt num" style="color:var(--red)">${m(f.yearlyCents, brlShort)}</div><div class="dt">no ano</div></div>
      </div>`).join('')}</div>
  </div>` : ''}
  `;
}

// ============================================================ COMO USAR

function guia(app) {
  const g = app.view.guia;
  const pct = Math.round((g.feitos / g.total) * 100);

  const bloco = (titulo, nota, itens) => `
    <div class="sec">
      <div class="sh"><h3>${esc(titulo)}</h3><a>${esc(nota)}</a></div>
      <div class="panel" style="padding:16px 16px 10px">${itens}</div>
    </div>`;

  const rotina = (texto, onde, cor = '') => `
    <div class="gi"><span class="bx dot ${cor}"></span>
      <div><b>${esc(texto)}</b><i>${esc(onde)}</i></div></div>`;

  return `
  ${header(app, { voltar: 'tudo' })}

  <div class="hero">
    <div class="top"><span class="lbl">Configuração</span></div>
    <div class="big ser">${g.feitos} <span style="font-size:22px;color:rgba(255,255,255,.55)">de ${g.total} feitas</span></div>
    <div class="prog"><i style="width:${pct}%"></i></div>
    <div class="foot"><span class="acc">${g.pendentes.length ? `faltam ${g.pendentes.length} · uns 10 minutos no total` : 'tudo configurado'}</span></div>
  </div>

  ${bloco('Uma vez só', g.pendentes.length ? `${g.pendentes.length} pendentes` : 'completo',
    g.passos.map((p) => `
      <div class="gi ${p.done ? 'done' : 'todo'}" ${p.done ? '' : `data-go="${p.go}"`}>
        <span class="bx">${p.done ? icon('check') : ''}</span>
        <div><b>${esc(p.label)}</b><i>${esc(p.where)} · ${esc(p.hint)}</i></div>
        ${p.done ? '' : `<span class="arr">${icon('seta')}</span>`}
      </div>`).join(''))}

  ${bloco('Todo dia', '5 segundos',
    rotina('Lançar o gasto na hora', 'no Painel · botão Lançar, ou Por frase e escrever "gastei 85 no mercado ontem"') +
    rotina('Não deixe acumular', 'lançar depois de uma semana é quando as pessoas desistem do app'))}

  ${bloco('Toda semana', '3 minutos',
    rotina('Categorizar o que entrou', 'em Revisão · um toque em cada, o app aprende e não pergunta de novo') +
    rotina('Ler os avisos', 'em Revisão · vazamentos, aumento de preço e cobrança duplicada') +
    rotina('Conferir se o saldo bate', 'em Cartões · se não bater, ajuste na hora'))}

  ${bloco('Todo mês', '2 minutos',
    rotina('Quando a fatura fechar', 'em Cartões · confira antes de vencer', 'a') +
    rotina('Atualizar saldo das contas', 'em Cartões · digite o saldo de cada instituição', 'a') +
    rotina('Lançar as entradas avulsas', 'em Recebimentos · trader, serviço por fora, reembolso', 'a') +
    rotina('Fazer o backup', 'em Tudo · sem servidor, o backup é a sua única cópia', 'a'))}

  <div class="sec">
    <div class="sh"><h3>O que cada tela faz</h3></div>
    <div class="list">
      ${[
        ['painel', 'casa', 'Painel', 'o resumo do dia. O número grande é quanto falta pra sair', 'j'],
        ['cartoes', 'cartao', 'Cartões', 'seus cartões, contas, fatura aberta e o muro de parcelas', ''],
        ['dividas', 'escudoOk', 'Dívidas', 'a ordem certa de pagar e a data em que você fica livre', 'r'],
        ['analise', 'grafico', 'Análise', 'para onde foi o dinheiro, tetos, vazamentos e diagnóstico', 'a'],
        ['tudo', 'menu', 'Tudo', 'recebimentos, cofrinhos, projetos, backup e seus dados', ''],
      ].map(([id, ic, nome, texto, cor]) => `
        <button class="row" data-go="${id}">
          <div class="ic ${cor}">${icon(ic)}</div>
          <div class="bd"><div class="t">${nome}</div><div class="s">${texto}</div></div>
          <span class="arr">${icon('seta')}</span>
        </button>`).join('')}
    </div>
  </div>

  <div class="sec"><div class="say">
    <div class="k eb" style="color:var(--jade)">Se você só fizer uma coisa</div>
    <div class="q ser">Lance o gasto na hora e faça a revisão de domingo.</div>
    <div class="p">O resto o app calcula sozinho. Um app de finanças que você não alimenta
      vira um retrato bonito de um mês que já passou.</div>
  </div></div>
  `;
}

const TELAS = { painel, cartoes, dividas, analise, tudo, cofrinhos, recebimentos, revisao, guia };
