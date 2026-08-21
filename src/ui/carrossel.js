// Carrossel de cards.
//
// O detalhe que decide se isto funciona ou vira defeito: o app redesenha a
// tela INTEIRA a cada mudança de dado — lançar uma despesa, marcar uma fatura,
// esconder um valor. Um carrossel ingênuo teria dois problemas por causa disso:
//
//   1. voltaria para o primeiro card a cada atualização, e quem estava lendo o
//      terceiro perderia o lugar sem ter tocado em nada;
//   2. armaria um temporizador novo a cada redesenho sem desarmar o anterior.
//      Depois de cinco atualizações seriam cinco timers girando o mesmo
//      carrossel — ele iria acelerando sozinho até ficar impossível de ler.
//
// A posição é feita com `transform`, e não com rolagem.
//
// A primeira versão usava scroll com `scroll-snap`, que é o caminho natural no
// celular. Não funcionou: depois de medir a largura, o navegador re-encaixava
// no primeiro item por conta própria e desfazia a reposição. Foram três
// tentativas de contornar — adiar um quadro, adiar 220 ms, travar o ouvinte de
// rolagem — e todas perderam a corrida em algum momento.
//
// Com transform não existe corrida: a posição é o índice, escrito de uma vez.
// O arrasto do dedo passa a ser código meu, o que é mais trabalho — mas é
// trabalho que se comporta igual toda vez.
//
// O giro automático para de vez quando a pessoa toca. Quem tocou está lendo, e
// mover o card debaixo do dedo de alguém que está lendo um número de dinheiro
// é a diferença entre um detalhe bonito e um app irritante.

import { esc } from './dom.js';

const INTERVALO = 7000;
const ARRASTO_MINIMO = 45; // px para valer como troca de card, e não como toque

const indices = new Map();   // id -> card visível
const timers = new Map();    // id -> temporizador em curso
const parados = new Set();   // ids que a pessoa assumiu no dedo

/** Monta o HTML. Os cards já vêm prontos de quem chama. */
export function carrossel(id, cards, { classe = '' } = {}) {
  const vivos = cards.filter(Boolean);
  if (!vivos.length) return '';
  if (vivos.length === 1) return vivos[0];

  const atual = Math.min(indices.get(id) || 0, vivos.length - 1);
  indices.set(id, atual);

  return `<div class="carrossel ${esc(classe)}" data-carrossel="${esc(id)}">
    <div class="carrossel-janela">
      <div class="carrossel-trilho" data-trilho style="transform:translateX(-${atual * 100}%)">
        ${vivos.map((c, i) => `<div class="carrossel-item" data-i="${i}">${c}</div>`).join('')}
      </div>
    </div>
    <div class="carrossel-pontos">
      ${vivos.map((_, i) => `<button class="carrossel-ponto ${i === atual ? 'on' : ''}"
        data-ir="${i}" aria-label="Card ${i + 1} de ${vivos.length}"></button>`).join('')}
    </div>
  </div>`;
}

/**
 * Liga os carrosséis que estiverem na tela. Chamada a cada redesenho.
 *
 * Não precisa repor posição nenhuma: o HTML já nasce no card certo, porque
 * `carrossel()` escreve o transform a partir do índice guardado. Aqui só se
 * ligam os gestos e o giro.
 */
export function ligarCarrosseis(raiz = document) {
  // Desarma tudo primeiro. Um carrossel que saiu da tela — porque a pessoa
  // mudou de aba — deixaria o timer girando um elemento que não existe mais.
  for (const t of timers.values()) clearInterval(t);
  timers.clear();

  for (const el of raiz.querySelectorAll('[data-carrossel]')) {
    const id = el.dataset.carrossel;
    const trilho = el.querySelector('[data-trilho]');
    const total = trilho.children.length;
    if (total < 2) continue;

    const pontos = [...el.querySelectorAll('[data-ir]')];

    const irPara = (i) => {
      const alvo = ((i % total) + total) % total;
      indices.set(id, alvo);
      trilho.style.transition = 'transform .34s cubic-bezier(.2,.8,.2,1)';
      trilho.style.transform = `translateX(-${alvo * 100}%)`;
      for (const [j, p] of pontos.entries()) p.classList.toggle('on', j === alvo);
    };

    for (const ponto of pontos) {
      ponto.addEventListener('click', () => { parados.add(id); irPara(Number(ponto.dataset.ir)); });
    }

    ligarArrasto(trilho, id, total, irPara);

    if (parados.has(id) || reduzMovimento()) continue;

    timers.set(id, setInterval(() => {
      if (!el.isConnected) return;
      irPara((indices.get(id) || 0) + 1);
    }, INTERVALO));
  }
}

/**
 * Arrastar com o dedo.
 *
 * O card acompanha o dedo enquanto arrasta e só troca se o gesto passou de um
 * mínimo — sem isso, um toque no botão dentro do card viraria troca de página,
 * e a pessoa perderia o que estava lendo por causa de um tremor.
 */
function ligarArrasto(trilho, id, total, irPara) {
  let x0 = null;

  trilho.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    parados.add(id);
    x0 = e.clientX;
    trilho.style.transition = 'none';
    // Captura o ponteiro: o arrasto passa a seguir o dedo mesmo quando ele sai
    // do card. Sem isso o gesto se perderia no meio, e o card ficaria parado
    // no lugar errado enquanto a pessoa ainda está arrastando.
    try { trilho.setPointerCapture(e.pointerId); } catch { /* nem todo ponteiro captura */ }
  }, { passive: true });

  trilho.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const d = e.clientX - x0;
    const base = (indices.get(id) || 0) * 100;
    trilho.style.transform = `translateX(calc(-${base}% + ${d}px))`;
  }, { passive: true });

  // SÓ o soltar troca de card.
  //
  // Antes `pointerleave` também trocava, e isso é errado por definição: o
  // ponteiro saindo do elemento é um gesto ABORTADO, não um gesto concluído.
  // Na prática, arrastar o dedo para cima e sair do card virava troca de
  // página — a pessoa perdia o card que estava lendo sem ter pedido.
  trilho.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const d = e.clientX - x0;
    x0 = null;
    const atual = indices.get(id) || 0;
    if (Math.abs(d) < ARRASTO_MINIMO) irPara(atual);
    else irPara(d < 0 ? Math.min(total - 1, atual + 1) : Math.max(0, atual - 1));
  }, { passive: true });

  // Cancelado ou interrompido volta para onde estava, sem trocar nada.
  const abortar = () => {
    if (x0 === null) return;
    x0 = null;
    irPara(indices.get(id) || 0);
  };
  trilho.addEventListener('pointercancel', abortar, { passive: true });
  trilho.addEventListener('lostpointercapture', abortar, { passive: true });

}

/** Quem pediu menos animação no sistema não quer card girando sozinho. */
const reduzMovimento = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
