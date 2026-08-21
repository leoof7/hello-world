// Os gráficos do app.
//
// SVG escrito à mão, sem biblioteca: o app não pode buscar nada de fora — não
// tem servidor, e uma dependência de gráfico custaria mais que todo o resto do
// código junto.
//
// A regra que decide se um gráfico entra: ele responde UMA pergunta com uma
// imagem, e a resposta aparece antes de a pessoa ler qualquer número. Gráfico
// que precisa de legenda para ser entendido é tabela com tinta.
//
// Por isso não existe gráfico em Lançar nem em Revisão: ali a pessoa está
// executando uma tarefa, e desenho vira ruído no caminho.

import { esc } from './dom.js';

const TAU = Math.PI * 2;

/** Ponto na circunferência. O ângulo começa no topo e anda no sentido horário. */
function ponto(cx, cy, raio, fracao) {
  const ang = fracao * TAU - Math.PI / 2;
  return [cx + raio * Math.cos(ang), cy + raio * Math.sin(ang)];
}

/** Arco de rosca (com furo no meio) entre duas frações da volta. */
function fatia(cx, cy, raio, espessura, de, ate) {
  const rInt = raio - espessura;
  const volta = Math.min(0.9999, Math.max(0, ate - de));
  const grande = volta > 0.5 ? 1 : 0;

  const [x1, y1] = ponto(cx, cy, raio, de);
  const [x2, y2] = ponto(cx, cy, raio, de + volta);
  const [x3, y3] = ponto(cx, cy, rInt, de + volta);
  const [x4, y4] = ponto(cx, cy, rInt, de);

  return `M ${x1.toFixed(2)} ${y1.toFixed(2)}
          A ${raio} ${raio} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
          L ${x3.toFixed(2)} ${y3.toFixed(2)}
          A ${rInt} ${rInt} 0 ${grande} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/**
 * Anel de progresso, com o número no meio.
 *
 * Serve para o que é "quanto do caminho já andei": dívida paga, reserva
 * formada, meta guardada. A barra reta responde a mesma coisa, mas o anel
 * fecha — e um círculo que fecha é a única forma de "acabou" que se entende
 * sem ler.
 */
export function anel({
  fracao = 0,
  centro = '',
  legenda = '',
  cor = 'var(--jade)',
  tamanho = 148,
  espessura = 13,
  trilho = 'var(--line)',
} = {}) {
  const r = tamanho / 2 - 2;
  const c = tamanho / 2;
  const f = presa(fracao);

  return `<div class="anel" style="width:${tamanho}px;height:${tamanho}px">
    <svg viewBox="0 0 ${tamanho} ${tamanho}" width="${tamanho}" height="${tamanho}" aria-hidden="true">
      <path d="${fatia(c, c, r, espessura, 0, 1)}" fill="${trilho}"/>
      ${f > 0 ? `<path d="${fatia(c, c, r, espessura, 0, f)}" fill="${cor}"/>` : ''}
    </svg>
    <div class="anel-meio">
      <span class="anel-num num">${centro}</span>
      ${legenda ? `<span class="anel-leg">${esc(legenda)}</span>` : ''}
    </div>
  </div>`;
}

/**
 * Anel dividido em passos — reserva de emergência em meses, por exemplo.
 *
 * Seis fatias separadas dizem "faltam quatro" de um jeito que 33% não diz.
 * Porcentagem é para quem já entendeu a meta; o passo serve para quem está
 * chegando nela.
 */
export function anelDePassos({
  feitos = 0,
  total = 6,
  centro = '',
  legenda = '',
  cor = 'var(--jade)',
  tamanho = 148,
  espessura = 13,
} = {}) {
  const r = tamanho / 2 - 2;
  const c = tamanho / 2;
  const vao = 0.012;
  const passo = 1 / total;

  const arcos = [];
  for (let i = 0; i < total; i++) {
    const de = i * passo + vao / 2;
    const ate = (i + 1) * passo - vao / 2;
    const cheio = i + 1 <= feitos;
    const parcial = !cheio && i < feitos;
    const ateReal = parcial ? de + (ate - de) * (feitos - i) : ate;
    arcos.push(`<path d="${fatia(c, c, r, espessura, de, ate)}" fill="var(--line)"/>`);
    if (cheio || parcial) {
      arcos.push(`<path d="${fatia(c, c, r, espessura, de, ateReal)}" fill="${cor}"/>`);
    }
  }

  return `<div class="anel" style="width:${tamanho}px;height:${tamanho}px">
    <svg viewBox="0 0 ${tamanho} ${tamanho}" width="${tamanho}" height="${tamanho}" aria-hidden="true">${arcos.join('')}</svg>
    <div class="anel-meio">
      <span class="anel-num num">${centro}</span>
      ${legenda ? `<span class="anel-leg">${esc(legenda)}</span>` : ''}
    </div>
  </div>`;
}

/**
 * Rosca por categoria — para onde foi o dinheiro do mês.
 *
 * Junta o rabo da lista em "outros": doze fatias de 2% não são doze
 * informações, são uma mancha.
 */
export function rosca({ partes = [], tamanho = 148, espessura = 22, centro = '', legenda = '' } = {}) {
  const validas = partes.filter((p) => p.cents > 0).sort((a, b) => b.cents - a.cents);
  const total = validas.reduce((s, p) => s + p.cents, 0);
  if (!total) return '';

  const maiores = validas.slice(0, 5);
  const resto = validas.slice(5).reduce((s, p) => s + p.cents, 0);
  const lista = resto > 0
    ? [...maiores, { nome: 'Outros', cents: resto, cor: 'var(--steel)' }]
    : maiores;

  const r = tamanho / 2 - 2;
  const c = tamanho / 2;
  let cursor = 0;
  const arcos = lista.map((p) => {
    const de = cursor;
    cursor += p.cents / total;
    return `<path d="${fatia(c, c, r, espessura, de, cursor)}" fill="${p.cor || 'var(--jade)'}"><title>${esc(p.nome)}</title></path>`;
  });

  return `<div class="rosca">
    <div class="anel" style="width:${tamanho}px;height:${tamanho}px">
      <svg viewBox="0 0 ${tamanho} ${tamanho}" width="${tamanho}" height="${tamanho}" aria-hidden="true">${arcos.join('')}</svg>
      ${centro ? `<div class="anel-meio">
        <span class="anel-num num">${centro}</span>
        ${legenda ? `<span class="anel-leg">${esc(legenda)}</span>` : ''}
      </div>` : ''}
    </div>
    <ul class="rosca-leg">
      ${lista.map((p) => `<li>
        <i style="background:${p.cor || 'var(--jade)'}"></i>
        <span class="rosca-nome">${esc(p.nome)}</span>
        <span class="rosca-pct num">${Math.round((p.cents / total) * 100)}%</span>
      </li>`).join('')}
    </ul>
  </div>`;
}

/**
 * Barra empilhada — quanto da renda já tem dono antes de o mês começar.
 *
 * Responde "meu mês fecha?" sem ler número nenhum: se as faixas coloridas
 * enchem a barra, não fecha. O que sobra aparece como espaço vazio, que é
 * exatamente o que ele é.
 */
export function barraEmpilhada({ partes = [], totalCents = 0, sobraRotulo = 'sobra', sobraTexto = '' } = {}) {
  const usado = partes.reduce((s, p) => s + p.cents, 0);
  const base = Math.max(totalCents, usado) || 1;
  const estourou = usado > totalCents && totalCents > 0;

  return `<div class="empilha">
    <div class="empilha-barra ${estourou ? 'estourou' : ''}">
      ${partes.filter((p) => p.cents > 0).map((p) => `
        <i style="width:${((p.cents / base) * 100).toFixed(2)}%;background:${p.cor}"><title>${esc(p.nome)}</title></i>`).join('')}
    </div>
    <ul class="empilha-leg">
      ${partes.filter((p) => p.cents > 0).map((p) => `<li>
        <i style="background:${p.cor}"></i><span>${esc(p.nome)}</span>
        <b class="num">${esc(p.rotulo)}</b>
      </li>`).join('')}
      ${!estourou && totalCents > usado ? `<li class="empilha-sobra">
        <i style="background:var(--line)"></i><span>${esc(sobraRotulo)}</span>
        <b class="num">${esc(sobraTexto)}</b>
      </li>` : ''}
    </ul>
  </div>`;
}

/**
 * Termômetro horizontal — quanto resta de um valor que só diminui.
 *
 * A marca mostra onde a pessoa DEVERIA estar se o gasto fosse parelho até a
 * data de virada. Ficar à esquerda da marca é o aviso, e ele aparece antes de
 * qualquer texto.
 */
export function termometro({ fracao = 0, marca = null, cor = 'var(--jade)', alerta = false } = {}) {
  const f = presa(fracao) * 100;
  const m = marca == null ? null : presa(marca) * 100;
  return `<div class="termo">
    <div class="termo-trilho">
      <i class="termo-cheio" style="width:${f.toFixed(1)}%;background:${alerta ? 'var(--red)' : cor}"></i>
      ${m != null ? `<span class="termo-marca" style="left:${m.toFixed(1)}%"></span>` : ''}
    </div>
  </div>`;
}

/**
 * Prende um número entre 0 e 1 — e trata NaN como 0.
 *
 * `Math.min(1, Math.max(0, NaN))` devolve NaN, e NaN num atributo de largura
 * não quebra a página: ela desenha errado, calada. Divisão por zero em conta
 * de saldo acontece — vale sem gasto, mês sem entrada — e é justamente nesses
 * casos que ninguém está olhando.
 */
function presa(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
