// A tela do cadastro por conversa.
//
// O núcleo do roteiro mora em core/conversa.js. Aqui só existe tela: mostrar a
// pergunta, ouvir a resposta, devolver o que foi entendido para conferência, e
// no fim gravar.
//
// Três decisões que sustentam a coisa toda:
//
//   1. Nada é salvo sem a pessoa ver. Todo valor entendido volta num campo
//      editável antes de virar dado. Chat que grava sozinho e erra é pior que
//      formulário nenhum — o erro entra no cofre sem testemunha.
//
//   2. Duas tentativas e o app para de insistir. Ficar repetindo "não entendi"
//      é o que faz desistir. Na terceira, o campo aparece direto, do jeito que
//      o formulário sempre foi.
//
//   3. Tem saída em qualquer pergunta. Quem prefere o formulário vai para o
//      formulário — e quem só quer pular uma pergunta opcional, pula.

import { esc, icon, toast } from './dom.js';
import { formatCents, brl } from '../core/money.js';
import {
  PASSOS, proximoPasso, quantosFaltam, completo, textoDaPergunta,
} from '../core/conversa.js';

const LIMITE_TENTATIVAS = 2;

/**
 * Roda a conversa inteira. Devolve as respostas, ou null se a pessoa saiu.
 *
 * `montar` recebe o HTML e o coloca na tela — quem chama decide se isso é a
 * tela de arranque ou uma folha, e este arquivo não precisa saber.
 */
export async function conversarCadastro({ montar, aoSair = null } = {}) {
  const respostas = {};
  const ctx = {};

  while (true) {
    const passo = proximoPasso(respostas);
    if (!passo) break;

    const r = await perguntar(passo, ctx, respostas, montar);

    if (r === 'sair') {
      if (completo(respostas)) break;
      aoSair?.();
      return null;
    }
    if (r === 'pular') {
      // Passo opcional pulado fica registrado como respondido para o roteiro
      // andar — com null, que é diferente de "ainda não perguntei".
      respostas[passo.id] = null;
      continue;
    }

    respostas[passo.id] = r;
    if (passo.id === 'nome') ctx.nome = r;
  }

  return respostas;
}

/** Uma pergunta, do enunciado à confirmação. */
function perguntar(passo, ctx, respostas, montar) {
  return new Promise((resolve) => {
    let tentativas = 0;
    let entendido = null;

    const desenhar = (aviso = null) => {
      const faltam = quantosFaltam(respostas);
      const semSorte = tentativas >= LIMITE_TENTATIVAS;

      montar(`
        <div class="papo">
          <div class="papo-topo">
            <div class="boot-mark">Zero<i></i></div>
            <span class="papo-passo">${faltam === 1 ? 'última pergunta' : `faltam ${faltam}`}</span>
          </div>

          <div class="papo-corpo">
            <p class="papo-fala">${esc(textoDaPergunta(passo, ctx))}</p>
            <p class="papo-ajuda">${esc(passo.ajuda)}</p>
            ${aviso ? `<p class="papo-aviso">${esc(aviso)}</p>` : ''}
            ${semSorte && passo.porQue ? `<p class="papo-ajuda">${esc(passo.porQue)}</p>` : ''}
          </div>

          <div class="papo-baixo">
            ${entendido ? confirmacao(passo, entendido) : entrada(passo, semSorte)}
          </div>
        </div>
      `);

      if (entendido) ligarConfirmacao(passo, entendido, resolve, desenhar, () => { entendido = null; });
      else ligarEntrada(passo, respostas, resolve, desenhar, (v) => { entendido = v; }, () => { tentativas += 1; });
    };

    desenhar();
  });
}

/** O campo de resposta, com microfone quando o aparelho tem. */
function entrada(passo, semSorte) {
  const podeFalar = typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  return `
    <div class="papo-campo">
      <input type="text" id="papo-in" inputmode="${passo.tipo === 'numero' ? 'numeric' : 'text'}"
        autocapitalize="${passo.tipo === 'texto' ? 'words' : 'off'}" autocorrect="off" spellcheck="false"
        placeholder="${esc(passo.placeholder)}" autocomplete="off">
      ${podeFalar ? `<button class="papo-mic" id="papo-mic" aria-label="Falar">${icon('microfone')}</button>` : ''}
    </div>
    <div class="btns">
      <button class="btn primary" id="papo-ok">Continuar</button>
    </div>
    <div class="papo-saidas">
      ${passo.obrigatorio ? '' : '<button class="papo-link" id="papo-pular">Pular esta</button>'}
      <button class="papo-link" id="papo-sair">Prefiro preencher na mão</button>
    </div>
    ${semSorte ? '<p class="papo-ajuda" style="text-align:center">Se preferir, escreva só o número.</p>' : ''}`;
}

/** O que foi entendido, editável antes de virar dado. */
function confirmacao(passo, entendido) {
  return `
    <div class="papo-eco">
      <span class="papo-eco-rot">${esc(rotuloDoEco(passo))}</span>
      ${ecoEditavel(passo, entendido)}
    </div>
    <div class="btns">
      <button class="btn primary" id="papo-conf">${icon('check')} Confirmar</button>
      <button class="btn ghost" id="papo-nao">Não é isso</button>
    </div>`;
}

const rotuloDoEco = (passo) => ({
  nome: 'Seu nome', idade: 'Sua idade', renda: 'Entra por mês',
  conta: 'Na conta hoje', fixos: 'Contas todo mês',
}[passo.id] || 'Entendi');

function ecoEditavel(passo, entendido) {
  if (passo.id === 'fixos') {
    const itens = entendido.valor;
    if (!itens.length) return '<div class="papo-eco-vazio">Nenhuma conta fixa por enquanto.</div>';
    return `<div class="papo-lista">${itens.map((it, i) => `
      <div class="papo-item">
        <input type="text" class="papo-item-nome" data-i="${i}" value="${esc(it.label)}" autocapitalize="words">
        <input type="text" class="papo-item-valor" data-i="${i}" inputmode="decimal"
          value="${esc(formatCents(it.amountCents))}" data-money="1">
        <button class="papo-item-x" data-remover="${i}" aria-label="Tirar">${icon('x')}</button>
      </div>`).join('')}</div>`;
  }

  if (passo.tipo === 'dinheiro') {
    return `<input type="text" id="papo-edit" class="papo-eco-valor num" inputmode="decimal"
      value="${esc(formatCents(entendido.valor))}" data-money="1">`;
  }

  return `<input type="text" id="papo-edit" class="papo-eco-valor"
    value="${esc(String(entendido.valor))}" autocapitalize="${passo.tipo === 'texto' ? 'words' : 'off'}">`;
}

// ------------------------------------------------------------------ eventos

function ligarEntrada(passo, respostas, resolve, redesenhar, guardar, errou) {
  const campo = document.getElementById('papo-in');
  const enviar = () => {
    const texto = campo.value;
    const lido = passo.ler(texto);

    if (!lido) {
      errou();
      redesenhar('Não consegui entender. Pode escrever de outro jeito?');
      return;
    }
    guardar(lido);
    redesenhar();
  };

  document.getElementById('papo-ok').onclick = enviar;
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
  campo.focus();

  document.getElementById('papo-sair')?.addEventListener('click', () => resolve('sair'));
  document.getElementById('papo-pular')?.addEventListener('click', () => resolve('pular'));
  document.getElementById('papo-mic')?.addEventListener('click', () => ouvir(campo, enviar));
}

function ligarConfirmacao(passo, entendido, resolve, redesenhar, limpar) {
  document.getElementById('papo-nao').onclick = () => { limpar(); redesenhar(); };

  if (passo.id === 'fixos') {
    for (const botao of document.querySelectorAll('[data-remover]')) {
      botao.onclick = () => {
        entendido.valor.splice(Number(botao.dataset.remover), 1);
        redesenhar();
      };
    }
  }

  document.getElementById('papo-conf').onclick = () => resolve(lerDaTela(passo, entendido));
}

/** O que está NA TELA na hora de confirmar — não o que foi entendido antes. */
function lerDaTela(passo, entendido) {
  if (passo.id === 'fixos') {
    const nomes = [...document.querySelectorAll('.papo-item-nome')];
    const valores = [...document.querySelectorAll('.papo-item-valor')];
    return nomes.map((n, i) => ({
      label: n.value.trim() || 'Gasto fixo',
      amountCents: Math.abs(paraCentavos(valores[i]?.value)),
    })).filter((x) => x.amountCents > 0);
  }

  const campo = document.getElementById('papo-edit');
  if (!campo) return entendido.valor;

  if (passo.tipo === 'dinheiro') {
    const cents = paraCentavos(campo.value);
    // Editar para vazio não pode virar zero calado num campo de dinheiro.
    return Number.isFinite(cents) ? cents : entendido.valor;
  }
  if (passo.tipo === 'numero') return Number(campo.value) || entendido.valor;
  return campo.value.trim() || entendido.valor;
}

/** "1.234,56" → 123456. O campo já vem mascarado, então basta desmontar. */
function paraCentavos(texto) {
  const limpo = String(texto ?? '').replace(/[^\d,-]/g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * O microfone.
 *
 * Falar é onde a preguiça morre de verdade: dizer "quatro mil e setecentos"
 * custa menos que digitar. Mas o reconhecimento trava calado com frequência —
 * por isso o tempo limite e o aviso, em vez de um botão vermelho para sempre.
 */
function ouvir(campo, enviar) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return;

  const botao = document.getElementById('papo-mic');
  const rec = new Rec();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;

  let ouviu = false;
  const limite = setTimeout(() => { try { rec.stop(); } catch { /* já parou */ } }, 8000);
  const parar = () => { clearTimeout(limite); botao?.classList.remove('ouvindo'); };

  rec.onresult = (e) => {
    ouviu = true;
    campo.value = [...e.results].map((r) => r[0].transcript).join(' ').trim();
  };
  rec.onerror = () => { parar(); toast('Não consegui ouvir. Pode escrever.'); };
  rec.onend = () => {
    parar();
    if (ouviu && campo.value.trim()) enviar();
    else if (!ouviu) toast('Não ouvi nada. Pode escrever.');
  };

  botao?.classList.add('ouvindo');
  try { rec.start(); } catch { parar(); }
}
