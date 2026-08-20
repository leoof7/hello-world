// Zero — ponto de entrada.
//
// A ordem de arranque:
//   1. cofre existe?  não → primeira vez: cria chave, mostra as doze palavras
//   2. cofre existe?  sim → destrava (Face ID ou senha) e decifra
//   3. deriva o estado e desenha a tela
//
// Nada sai deste aparelho. Não há servidor para chamar, então não há tela de
// carregamento esperando rede — o que demora aqui é só o Face ID e o PBKDF2.

import { APP, FEATURES, PADROES } from '../config.js';
import { today } from '../core/dates.js';
import * as db from '../data/db.js';
import {
  biometricsAvailable, createPasskey, prfSecret,
  deriveKeyFromSecret, deriveKeyFromPassword, b64ToBytes,
} from '../data/crypto.js';
import { generatePhrase, phraseToBytes, challengePositions, normalize } from '../data/recovery.js';
import { backupStatus } from '../data/backup.js';
import { emptyDocument } from '../data/migrations.js';
import { seedDocument } from '../seed/seed.js';
import { derive } from './state.js';
import { render } from './screens.js';
import { esc, icon, toast, sheet, $ } from './dom.js';

// ---------------------------------------------------------------- estado vivo

export const app = {
  key: null,        // CryptoKey — só existe na memória, some ao fechar
  doc: null,
  view: null,       // resultado de derive()
  screen: 'painel',
  privacy: false,   // olho fechado esconde os valores
  todayISO: today(),
  backup: null,
};

const TELAS = ['painel', 'cartoes', 'dividas', 'analise', 'tudo', 'cofrinhos', 'recebimentos', 'revisao', 'guia'];
const PAI = { cofrinhos: 'tudo', recebimentos: 'tudo', guia: 'tudo', revisao: 'painel' };

// ------------------------------------------------------------------ persistir

/** Grava o documento cifrado e redesenha. Toda alteração passa por aqui. */
export async function commit(mutate, { redraw = true } = {}) {
  if (typeof mutate === 'function') mutate(app.doc);
  app.doc = await db.save(app.key, app.doc);
  if (redraw) draw();
  return app.doc;
}

/** Recalcula tudo e redesenha a tela atual. */
export function draw() {
  app.view = derive(app.doc, app.todayISO);
  render(app);
}

export function go(screen) {
  if (!TELAS.includes(screen)) return;
  app.screen = screen;
  location.hash = `#${screen}`;
  render(app);
  document.querySelector('.screen')?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

export const parentOf = (screen) => PAI[screen] || screen;

// ------------------------------------------------------------------ desbloqueio

const boot = (msg) => { const el = $('#bootMsg'); if (el) el.textContent = msg; };

function lockScreen(inner) {
  document.getElementById('app').innerHTML = `<div class="lock">${inner}</div>`;
}

/** Primeira vez: cria a chave e entrega as doze palavras. */
async function primeiraVez() {
  const phrase = generatePhrase();

  lockScreen(`
    <div class="boot-mark">Zero<i></i></div>
    <p class="ser">Antes de tudo, guarde estas doze palavras.</p>
    <p class="why">Não existe servidor e não existe "esqueci a senha". Estas palavras
       são a única forma de abrir o seu backup em outro aparelho. Escreva no papel.
       Foto na galeria não conta como lugar seguro.</p>
    <div class="words" id="words">
      ${phrase.map((w, i) => `<div class="word"><div class="i">${i + 1}</div><div class="w">${esc(w)}</div></div>`).join('')}
    </div>
    <div class="btns" style="width:100%;max-width:340px">
      <button class="btn primary" id="anotei">Anotei, continuar</button>
    </div>
  `);

  await new Promise((r) => { $('#anotei').onclick = r; });
  await confirmarPalavras(phrase);

  const meta = await db.initMeta();
  const salt = b64ToBytes(meta.salt);
  const { key, method, credentialId } = await escolherChave(salt, phrase);

  await db.writeMeta({ unlockMethod: method, credentialId: credentialId || null });

  app.key = key;
  app.doc = await db.save(key, emptyDocument());
  await db.requestPersistence();

  await primeiroConteudo();
}

/** Confirma três palavras sorteadas — chato de propósito. */
async function confirmarPalavras(phrase) {
  const posicoes = challengePositions(3);

  while (true) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">Confirme três delas.</p>
      <p class="why">Se você não anotou, é melhor descobrir agora do que daqui a seis meses.</p>
      <div style="width:100%;max-width:340px;margin-top:20px">
        ${posicoes.map((p) => `
          <div class="field">
            <label>Palavra ${p + 1}</label>
            <input type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" data-p="${p}">
          </div>`).join('')}
        <div class="btns">
          <button class="btn primary" id="conf">Confirmar</button>
          <button class="btn ghost" id="ver">Ver de novo</button>
        </div>
      </div>
    `);

    const acao = await new Promise((r) => {
      $('#conf').onclick = () => r('conf');
      $('#ver').onclick = () => r('ver');
    });

    if (acao === 'ver') {
      lockScreen(`
        <div class="boot-mark">Zero<i></i></div>
        <div class="words">
          ${phrase.map((w, i) => `<div class="word"><div class="i">${i + 1}</div><div class="w">${esc(w)}</div></div>`).join('')}
        </div>
        <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="ok">Agora sim</button></div>
      `);
      await new Promise((r) => { $('#ok').onclick = r; });
      continue;
    }

    const certo = posicoes.every((p) => {
      const campo = document.querySelector(`input[data-p="${p}"]`);
      return normalize(campo?.value || '') === phrase[p];
    });

    if (certo) return;
    toast('Alguma palavra não bate. Confira a ordem e a grafia.');
  }
}

/** Face ID quando dá, senha quando não dá. */
async function escolherChave(salt, phrase) {
  if (FEATURES.faceId && (await biometricsAvailable())) {
    try {
      const { credentialId, prfSupported } = await createPasskey(APP.nome);
      if (prfSupported) {
        const segredo = await prfSecret(credentialId);
        if (segredo) {
          return { key: await deriveKeyFromSecret(segredo, salt), method: 'passkey', credentialId };
        }
      }
      // Passkey existe mas sem PRF: ela vira só a tranca, e a chave vem da frase.
      // Continua seguro — a frase tem a mesma entropia do arquivo de backup.
      return {
        key: await deriveKeyFromSecret(phraseToBytes(phrase), salt),
        method: 'passkey-frase',
        credentialId,
      };
    } catch {
      // usuário cancelou o Face ID, ou o navegador não deixou — cai para senha
    }
  }
  const senha = await pedirSenha({ criando: true });
  return { key: await deriveKeyFromPassword(senha, salt), method: 'senha' };
}

function pedirSenha({ criando = false } = {}) {
  return new Promise((resolve) => {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">${criando ? 'Crie uma senha para este aparelho.' : 'Digite a sua senha.'}</p>
      <p class="why">${criando
        ? 'Este aparelho não tem Face ID disponível para o app, então a senha é o que abre o cofre. Ela não sai daqui — não há para onde enviar.'
        : 'Ela abre o cofre guardado neste aparelho.'}</p>
      <div style="width:100%;max-width:340px;margin-top:20px">
        <div class="field">
          <label>Senha</label>
          <input type="password" id="pw" autocomplete="${criando ? 'new-password' : 'current-password'}">
        </div>
        <div class="btns"><button class="btn primary" id="ok">${criando ? 'Criar cofre' : 'Abrir'}</button></div>
      </div>
    `);
    const enviar = () => {
      const v = $('#pw').value;
      if (v.length < 6) { toast('Use pelo menos 6 caracteres.'); return; }
      resolve(v);
    };
    $('#ok').onclick = enviar;
    $('#pw').onkeydown = (e) => { if (e.key === 'Enter') enviar(); };
    $('#pw').focus();
  });
}

/** Cofre já existe: destrava. */
async function destravar(meta) {
  const salt = b64ToBytes(meta.salt);

  if (meta.unlockMethod === 'passkey' && meta.credentialId) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <div style="color:var(--jade);width:44px">${icon('face')}</div>
      <p class="ser">Toque para abrir com o Face ID.</p>
      <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="faceid">Abrir</button></div>
      <p class="why">Se o Face ID falhar, você ainda pode restaurar o backup com as doze palavras.</p>
    `);
    await new Promise((r) => { $('#faceid').onclick = r; });
    boot('abrindo…');
    const segredo = await prfSecret(meta.credentialId);
    if (!segredo) throw new Error('Face ID não devolveu a chave.');
    return deriveKeyFromSecret(segredo, salt);
  }

  if (meta.unlockMethod === 'passkey-frase' && meta.credentialId) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <div style="color:var(--jade);width:44px">${icon('face')}</div>
      <p class="ser">Toque para abrir com o Face ID.</p>
      <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="faceid">Abrir</button></div>
      <p class="why">Depois do Face ID, digite as doze palavras — este aparelho não
         guarda a chave dentro da credencial.</p>
    `);
    await new Promise((r) => { $('#faceid').onclick = r; });
    await prfSecret(meta.credentialId); // só para exigir o Face ID
    const frase = await pedirFrase();
    return deriveKeyFromSecret(phraseToBytes(frase), salt);
  }

  const senha = await pedirSenha();
  return deriveKeyFromPassword(senha, salt);
}

function pedirFrase() {
  return new Promise((resolve) => {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">Digite as doze palavras.</p>
      <p class="why">Na ordem, separadas por espaço.</p>
      <div style="width:100%;max-width:340px;margin-top:20px">
        <div class="field">
          <label>Frase de recuperação</label>
          <textarea id="fr" rows="3" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
        </div>
        <div class="btns"><button class="btn primary" id="ok">Abrir</button></div>
      </div>
    `);
    $('#ok').onclick = () => {
      const palavras = $('#fr').value.trim().split(/\s+/);
      try { phraseToBytes(palavras); } catch (e) { toast(e.message); return; }
      resolve(palavras);
    };
  });
}

/** Começar vazio ou com o cenário de exemplo. */
async function primeiroConteudo() {
  lockScreen(`
    <div class="boot-mark">Zero<i></i></div>
    <p class="ser">Quer ver o app funcionando antes de digitar os seus números?</p>
    <p class="why">O exemplo é um cenário fictício — fatura atrasada, cheque especial e
       parcelas correndo. Dá para apagar tudo depois com um toque.</p>
    <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
      <button class="btn primary" id="exemplo">Ver com o exemplo</button>
      <button class="btn ghost" id="vazio">Começar do zero</button>
    </div>
  `);

  const escolha = await new Promise((r) => {
    $('#exemplo').onclick = () => r('exemplo');
    $('#vazio').onclick = () => r('vazio');
  });

  if (escolha === 'exemplo') {
    app.doc = seedDocument(app.todayISO);
  } else {
    const base = emptyDocument();
    const { CATEGORIES } = await import('../seed/categories.js');
    base.categories = CATEGORIES.map((c) => ({ ...c }));
    app.doc = base;
  }
  app.doc = await db.save(app.key, app.doc);
}

// ---------------------------------------------------------------------- arranque

async function main() {
  document.documentElement.dataset.appVersion = APP.versao;

  try {
    const meta = await db.readMeta();
    const temCofre = await db.hasVault();

    if (!meta?.salt || !temCofre) {
      await primeiraVez();
    } else {
      boot('destravando…');
      app.key = await destravar(meta);
      app.doc = await db.load(app.key);
    }
  } catch (e) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">Não consegui abrir o cofre.</p>
      <p class="why">${esc(e.message || 'erro desconhecido')}</p>
      <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="rec">Tentar de novo</button></div>
    `);
    $('#rec').onclick = () => location.reload();
    return;
  }

  // tema salvo
  const tema = app.doc.settings?.theme || 'auto';
  if (tema !== 'auto') document.documentElement.dataset.theme = tema;

  app.backup = await backupStatus(app.todayISO);

  // guarda o pico da dívida para o Painel medir o progresso da saída
  const totalHoje = app.doc.debts.reduce((a, d) => a + Math.abs(d.balanceCents), 0);
  if (totalHoje > (app.doc.profile?.debtPeakCents || 0)) {
    app.doc.profile.debtPeakCents = totalHoje;
    await db.save(app.key, app.doc);
  }

  const alvo = location.hash.replace('#', '');
  if (TELAS.includes(alvo)) app.screen = alvo;

  draw();

  window.addEventListener('hashchange', () => {
    const s = location.hash.replace('#', '');
    if (TELAS.includes(s) && s !== app.screen) { app.screen = s; render(app); }
  });
}

// Falhas em módulo não aparecem no console de um iPhone — mostra na tela.
window.addEventListener('error', (e) => {
  if (!app.doc) {
    lockScreen(`<div class="boot-mark">Zero<i></i></div>
      <p class="ser">Erro ao carregar.</p><p class="why">${esc(e.message)}</p>`);
  }
});

main();

export { PADROES, sheet };
