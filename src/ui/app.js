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
import { generatePhrase, phraseToBytes, challengePositions, normalize, limparFrase } from '../data/recovery.js';
import { backupStatus } from '../data/backup.js';
import { emptyDocument } from '../data/migrations.js';
import { seedDocument } from '../seed/seed.js';
import { CATEGORIES } from '../seed/categories.js';
import { derive } from './state.js';
import { render } from './screens.js';
import { aplicarCor } from './tema.js';
import { esc, icon, toast, sheet, $ } from './dom.js';
import { botoesDaFrase, ligarBotoesDaFrase, botaoColar, colarNoCampo } from './frase.js';

// ---------------------------------------------------------------- estado vivo

export const app = {
  key: null,        // CryptoKey — só existe na memória, some ao fechar
  doc: null,
  view: null,       // resultado de derive()
  screen: 'painel',
  privacy: false,   // olho fechado esconde os valores
  todayISO: today(),
  backup: null,
  atualizacao: null,     // service worker novo esperando para assumir
  pediuAtualizar: false, // a pessoa tocou em "instalar": pode recarregar
};

const TELAS = ['painel', 'cartoes', 'dividas', 'analise', 'tudo', 'cofrinhos', 'recebimentos', 'revisao', 'guia', 'faturas', 'investimentos'];
// Qual aba fica acesa quando a tela aberta não é uma aba. Dívidas saiu daqui
// ao virar aba própria; Investimentos entrou, porque agora mora dentro de Tudo.
const PAI = { cofrinhos: 'tudo', recebimentos: 'tudo', guia: 'tudo', revisao: 'painel', faturas: 'painel', investimentos: 'tudo' };

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
       são a única forma de abrir o seu backup em outro aparelho. Escreva no papel,
       ou cole no seu gerenciador de senhas. Foto na galeria não conta como lugar seguro.</p>
    <div class="words" id="words">
      ${phrase.map((w, i) => `<div class="word"><div class="i">${i + 1}</div><div class="w">${esc(w)}</div></div>`).join('')}
    </div>
    <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
      <button class="btn primary" id="anotei">Anotei, continuar</button>
      ${botoesDaFrase()}
    </div>
  `);

  ligarBotoesDaFrase(document.getElementById('app'), phrase);
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

/**
 * Confirma três palavras sorteadas — chato de propósito.
 *
 * O que a pessoa digitou é preservado entre as tentativas e só o campo errado
 * fica marcado. Zerar os três campos por causa de uma letra é o tipo de
 * detalhe que faz alguém desistir do app na primeira tela.
 */
async function confirmarPalavras(phrase) {
  const posicoes = challengePositions(3);
  const digitado = {};
  let errados = [];

  while (true) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">Confirme três delas.</p>
      <p class="why">Se você não anotou, é melhor descobrir agora do que daqui a seis meses.</p>
      <div style="width:100%;max-width:340px;margin-top:20px">
        ${posicoes.map((p) => `
          <div class="field">
            <label>Palavra ${p + 1}${errados.includes(p) ? ' · não confere' : ''}</label>
            <input type="text" inputmode="text" autocapitalize="off" autocorrect="off"
                   spellcheck="false" data-p="${p}" value="${esc(digitado[p] || '')}"
                   ${errados.includes(p) ? 'style="border-color:var(--red)"' : ''}>
          </div>`).join('')}
        <div class="btns">
          <button class="btn primary" id="conf">Confirmar</button>
          <button class="btn ghost" id="ver">Ver de novo</button>
        </div>
      </div>
    `);

    const guardar = () => {
      for (const p of posicoes) {
        digitado[p] = document.querySelector(`input[data-p="${p}"]`)?.value || '';
      }
    };

    const acao = await new Promise((r) => {
      $('#conf').onclick = () => { guardar(); r('conf'); };
      $('#ver').onclick = () => { guardar(); r('ver'); };
    });

    if (acao === 'ver') {
      lockScreen(`
        <div class="boot-mark">Zero<i></i></div>
        <div class="words">
          ${phrase.map((w, i) => `<div class="word"><div class="i">${i + 1}</div><div class="w">${esc(w)}</div></div>`).join('')}
        </div>
        <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
          <button class="btn primary" id="ok">Agora sim</button>
          ${botoesDaFrase()}
        </div>
      `);
      ligarBotoesDaFrase(document.getElementById('app'), phrase);
      await new Promise((r) => { $('#ok').onclick = r; });
      continue;
    }

    const faltando = posicoes.filter((p) => !(digitado[p] || '').trim());
    // Marcar de vermelho um campo que a pessoa nem chegou a preencher é ruído.
    errados = posicoes.filter((p) => (digitado[p] || '').trim() && normalize(digitado[p]) !== phrase[p]);

    if (!faltando.length && !errados.length) return;
    toast(faltando.length && !errados.length
      ? 'Preencha as três.'
      : errados.length === 1 ? 'Uma palavra não bate.' : `${errados.length} palavras não batem.`);
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
  // A partir daqui a pessoa está no meio do desbloqueio — senha na tela, Face
  // ID aberto ou chave sendo derivada. Uma versão nova que chegue agora espera
  // a vez em vez de recarregar por cima. Ver cuidarDaVersao().
  app.mexendoNoCofre = true;
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
    const segredo = await prfSecret(meta.credentialId).catch(() => null);
    // Sem escapatória aqui, o app vira um beco sem saída: o erro leva a
    // recarregar, e recarregar leva ao mesmo erro. Por isso o socorro.
    if (!segredo) return socorro(meta, 'O Face ID não devolveu a chave deste aparelho.');
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
    await prfSecret(meta.credentialId).catch(() => null); // só para exigir o Face ID
    const frase = await pedirFrase();
    return deriveKeyFromSecret(phraseToBytes(frase), salt);
  }

  const senha = await pedirSenha();
  return deriveKeyFromPassword(senha, salt);
}

/**
 * Tela de socorro. Nenhum erro de desbloqueio pode terminar em "recarregue e
 * torça" — recarregar leva ao mesmo erro, e é assim que um app trava a pessoa
 * do lado de fora dos próprios dados.
 *
 * O que ela oferece depende de COMO o cofre foi trancado, e o texto não mente
 * sobre isso: com chave dentro da passkey, as doze palavras abrem o arquivo de
 * backup, não o cofre deste aparelho.
 */
async function socorro(meta, mensagem) {
  const salt = b64ToBytes(meta.salt);
  const porFrase = meta.unlockMethod === 'passkey-frase';
  const porSenha = meta.unlockMethod === 'senha';
  const temFaceId = !porSenha && !!meta.credentialId;

  while (true) {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">${esc(mensagem)}</p>
      <p class="why">${porSenha
        ? 'A senha é a única coisa que abre este cofre. Se você não lembra, o caminho é apagar e restaurar o seu backup com as doze palavras.'
        : porFrase
          ? 'Você ainda pode abrir este cofre com as doze palavras.'
          : 'Neste aparelho a chave mora dentro da passkey, então as doze palavras não abrem este cofre — elas abrem o seu <b>arquivo de backup</b>. Se o Face ID não voltar, o caminho é apagar e restaurar o backup.'}</p>
      <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
        ${temFaceId ? '<button class="btn primary" id="denovo">Tentar o Face ID de novo</button>' : ''}
        ${porSenha ? '<button class="btn primary" id="senha">Tentar a senha de novo</button>' : ''}
        ${porFrase ? '<button class="btn ghost" id="frase">Abrir com as doze palavras</button>' : ''}
        <button class="btn danger" id="zerar">Apagar e restaurar de um backup</button>
      </div>
    `);

    const acao = await new Promise((r) => {
      $('#denovo') && ($('#denovo').onclick = () => r('denovo'));
      $('#frase') && ($('#frase').onclick = () => r('frase'));
      $('#senha') && ($('#senha').onclick = () => r('senha'));
      $('#zerar').onclick = () => r('zerar');
    });

    try {
      if (acao === 'denovo') {
        const segredo = await prfSecret(meta.credentialId).catch(() => null);
        if (segredo) return deriveKeyFromSecret(segredo, salt);
        mensagem = 'O Face ID continua sem devolver a chave.';
        continue;
      }
      if (acao === 'frase') {
        return deriveKeyFromSecret(phraseToBytes(await pedirFrase()), salt);
      }
      if (acao === 'senha') {
        return deriveKeyFromPassword(await pedirSenha(), salt);
      }
      if (acao === 'zerar') {
        lockScreen(`
          <div class="boot-mark">Zero<i></i></div>
          <p class="ser">Isto apaga o cofre deste aparelho.</p>
          <p class="why">Só faça se você tiver o arquivo de backup e as doze palavras.
             Sem eles, o que está aqui dentro não volta — não existe cópia em servidor
             nenhum. Depois de apagar, o app recomeça e oferece restaurar o backup.</p>
          <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
            <button class="btn danger" id="sim">Tenho o backup, pode apagar</button>
            <button class="btn ghost" id="nao">Voltar</button>
          </div>
        `);
        const confirmou = await new Promise((r) => {
          $('#sim').onclick = () => r(true);
          $('#nao').onclick = () => r(false);
        });
        if (!confirmou) { mensagem = 'Nada foi apagado.'; continue; }
        await db.wipe();
        location.reload();
        return new Promise(() => {}); // a página está indo embora
      }
    } catch (e) {
      mensagem = e.message || 'Não deu certo.';
    }
  }
}

function pedirFrase() {
  return new Promise((resolve) => {
    lockScreen(`
      <div class="boot-mark">Zero<i></i></div>
      <p class="ser">Digite as doze palavras.</p>
      <p class="why">Na ordem. Pode colar do seu gerenciador de senhas — numeração
         e vírgula não atrapalham.</p>
      <div style="width:100%;max-width:340px;margin-top:20px">
        <div class="field">
          <label>Frase de recuperação</label>
          <textarea id="fr" rows="3" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
        </div>
        <div class="btns" style="margin-top:8px">${botaoColar()}</div>
        <div class="btns"><button class="btn primary" id="ok">Abrir</button></div>
      </div>
    `);
    $('[data-frase="colar"]').onclick = () => colarNoCampo($('#fr'));
    $('#ok').onclick = () => {
      const palavras = limparFrase($('#fr').value);
      try { phraseToBytes(palavras); } catch (e) { toast(e.message); return; }
      resolve(palavras);
    };
  });
}

/** Começar vazio ou com o cenário de exemplo. */
async function primeiroConteudo() {
  lockScreen(`
    <div class="boot-mark">Zero<i></i></div>
    <p class="ser">Por onde você quer começar?</p>
    <p class="why">O app é seu e começa vazio. O exemplo existe só para você ver as
       telas funcionando — é um cenário <b>fictício</b>, fica marcado como exemplo em
       todas as telas e sai com um toque quando você quiser.</p>
    <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
      <button class="btn primary" id="conversa">Me pergunta, eu respondo</button>
      <button class="btn ghost" id="vazio">Prefiro preencher na mão</button>
      <button class="btn ghost" id="exemplo">Só espiar o exemplo primeiro</button>
      <button class="btn ghost" id="backup">Restaurar de um backup</button>
    </div>
  `);

  const escolha = await new Promise((r) => {
    $('#conversa').onclick = () => r('conversa');
    $('#vazio').onclick = () => r('vazio');
    $('#exemplo').onclick = () => r('exemplo');
    $('#backup').onclick = () => r('backup');
  });

  if (escolha === 'exemplo') {
    app.doc = seedDocument(app.todayISO);
    app.doc = await db.save(app.key, app.doc);
    return;
  }

  if (escolha === 'backup') {
    const restaurado = await restaurarNoArranque();
    if (restaurado) { app.doc = await db.save(app.key, restaurado); return; }
    // deu errado ou desistiu: começa vazio, e o backup continua disponível em Tudo
  }

  if (escolha === 'conversa') {
    const respostas = await conversarNoArranque();
    if (respostas) {
      const { aplicarConversa } = await import('../core/conversa.js');
      app.doc = await db.save(app.key, aplicarConversa(documentoNovo(), respostas));
      return;
    }
    // saiu no meio: cai no documento vazio e o app segue pelos formulários
  }

  app.doc = await db.save(app.key, documentoNovo());
}

/** Roda o cadastro por conversa na tela de arranque. */
async function conversarNoArranque() {
  const { conversarCadastro } = await import('./bate-papo.js');
  return conversarCadastro({
    montar: (html) => { document.getElementById('app').innerHTML = html; },
  });
}


/** Documento em branco, já com as categorias — sem elas não há como classificar nada. */
export function documentoNovo() {
  const base = emptyDocument();
  base.categories = CATEGORIES.map((c) => ({ ...c }));
  return base;
}

/** Restaurar backup antes mesmo de entrar no app — o caso "troquei de celular". */
async function restaurarNoArranque() {
  const { readBackup, readFile, openEnvelope } = await import('../data/backup.js');

  lockScreen(`
    <div class="boot-mark">Zero<i></i></div>
    <p class="ser">Escolha o arquivo de backup.</p>
    <p class="why">É o arquivo <b>.zbk</b> que você salvou no iCloud Drive ou nos Arquivos.
       Depois dele, as doze palavras do aparelho antigo.</p>
    <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
      <button class="btn primary" id="arq">Escolher arquivo</button>
      <button class="btn ghost" id="pular">Agora não</button>
    </div>
  `);

  const arquivo = await new Promise((resolve) => {
    $('#pular').onclick = () => resolve(null);
    $('#arq').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      // Sem filtro de propósito. O iPhone resolve o tipo pela extensão, e
      // `.zbk` não é extensão que o iOS conheça — com accept=".zbk,application/json"
      // o próprio backup aparecia apagado no seletor, impossível de escolher.
      // Um filtro que esconde o arquivo certo é pior que filtro nenhum: quem
      // realmente protege é a conferência do conteúdo, logo abaixo.
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? await readFile(f) : null);
      };
      input.click();
    };
  });
  if (!arquivo) return null;

  // Confere o arquivo ANTES de pedir as doze palavras: digitar as doze para
  // então ouvir "esse não é um backup" faz a pessoa desconfiar das palavras
  // quando o errado era o arquivo.
  try {
    openEnvelope(arquivo);
  } catch (e) {
    toast(e.message || 'Não consegui abrir esse arquivo.');
    return null;
  }

  try {
    const frase = await pedirFrase();
    return await readBackup(arquivo, frase);
  } catch (e) {
    toast(e.message || 'Não consegui abrir esse backup.');
    return null;
  }
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
    const meta = await db.readMeta().catch(() => null);
    if (!meta?.salt) {
      // Nem meta existe: não há cofre para socorrer, só recomeçar.
      lockScreen(`
        <div class="boot-mark">Zero<i></i></div>
        <p class="ser">Não consegui iniciar o app.</p>
        <p class="why">${esc(e.message || 'erro desconhecido')}</p>
        <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="rec">Tentar de novo</button></div>
      `);
      $('#rec').onclick = () => location.reload();
      return;
    }
    try {
      app.key = await socorro(meta, e.message || 'Não consegui abrir o cofre.');
      app.doc = await db.load(app.key);
    } catch (e2) {
      lockScreen(`
        <div class="boot-mark">Zero<i></i></div>
        <p class="ser">Não consegui abrir o cofre.</p>
        <p class="why">${esc(e2.message || 'erro desconhecido')}</p>
        <div class="btns" style="width:100%;max-width:340px"><button class="btn primary" id="rec">Recomeçar</button></div>
      `);
      $('#rec').onclick = () => location.reload();
      return;
    }
  }

  // tema salvo
  const tema = app.doc.settings?.theme || 'auto';
  if (tema !== 'auto') document.documentElement.dataset.theme = tema;
  // A cor depende do tema já estar definido: o mesmo tom precisa de tratamento
  // diferente em fundo claro e em fundo escuro.
  aplicarCor({ corId: app.doc.settings?.corId, corLivre: app.doc.settings?.corLivre });

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

// ------------------------------------------------------------- atualizações
//
// Nada disto toca nos seus dados: o service worker guarda o PROGRAMA, e o seu
// cofre mora no IndexedDB. Atualizar o app nunca pede backup nem apagar nada.

/** Registra o service worker e avisa quando existe versão nova esperando. */
async function cuidarDaVersao() {
  if (!('serviceWorker' in navigator)) return;

  // Precisa ser lido ANTES de registrar. Na primeira instalação não existe
  // controlador, e o `clients.claim()` do service worker dispara um
  // `controllerchange` que não é troca de versão — é a instalação inicial.
  // Recarregar ali jogaria a pessoa para fora do cadastro das doze palavras.
  const jaTinhaControlador = !!navigator.serviceWorker.controller;

  let registro;
  try {
    // `updateViaCache: 'none'` obriga o navegador a buscar o próprio sw.js no
    // servidor em vez de reusar a cópia HTTP, que pode ficar até 24 h parada.
    // Sem isso, a correção que faz as atualizações chegarem só chegaria amanhã.
    registro = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch {
    return; // sem service worker o app funciona igual, só não abre offline
  }

  const avisar = (esperando) => {
    if (!esperando) return;
    app.atualizacao = esperando;
    if (app.doc) draw();
  };

  // já havia uma versão nova instalada e parada esperando
  avisar(registro.waiting);

  registro.addEventListener('updatefound', () => {
    const nova = registro.installing;
    nova?.addEventListener('statechange', () => {
      // "installed" com um controlador ativo significa: já existe uma versão
      // rodando e esta aqui é a substituta.
      if (nova.state === 'installed' && navigator.serviceWorker.controller) avisar(nova);
    });
  });

  // Troca de controlador → a versão nova assumiu.
  //
  // Recarregar na hora seria grosseiro: a pessoa está no meio de um lançamento
  // e o app se reinicia sozinho, pedindo Face ID de novo. Então só recarrega
  // quando isso não custa nada — se ela ainda não destravou o cofre, ou se foi
  // ela mesma quem pediu a atualização. Caso contrário, a faixa espera.
  //
  // "Ainda não destravou" não é o mesmo que "não está fazendo nada". Quem está
  // com a senha meio digitada, ou esperando o Face ID responder, está no meio
  // de alguma coisa — e recarregar ali apaga o campo e cancela o prompt. Pior:
  // a derivação da chave leva perto de um segundo, e o reload no meio dela
  // devolve a pessoa para a tela de senha sem explicar por quê. Era isso que
  // acontecia sempre que uma versão nova chegava junto com a abertura do app.
  //
  // Se ela já começou, a versão nova espera na faixa. Não se perde nada: a
  // troca do cache é atômica e a próxima abertura já vem inteira na nova.
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaControlador || recarregando) return;
    if ((!app.doc && !app.mexendoNoCofre) || app.pediuAtualizar) {
      recarregando = true;
      location.reload();
      return;
    }
    avisar(registro.active || registro.waiting);
  });

  // Procura versão nova ao abrir e sempre que o app volta do segundo plano,
  // que num PWA de iPhone é o momento em que a pessoa realmente "abre" o app.
  const procurar = () => registro.update().catch(() => {});
  procurar();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') procurar();
  });
}

/** Instala a versão que está esperando. Chamado pelo aviso e por Segurança. */
export async function instalarAtualizacao() {
  const registro = await navigator.serviceWorker?.getRegistration();
  if (!registro && !app.atualizacao) return false;

  // Marca que o recarregamento foi pedido: só assim o controllerchange age.
  app.pediuAtualizar = true;

  const parado = registro?.waiting;
  if (!parado) {
    // Sem ninguém esperando, a versão nova já é a ativa e só falta a página
    // recarregar para deixar de rodar os módulos velhos que estão na memória.
    location.reload();
    return true;
  }

  // A versão nova está instalada mas parada. Recarregar agora seria pior que
  // não fazer nada: a página voltaria servida pelo service worker ANTIGO e a
  // pessoa veria a mesma versão de novo, com a mesma faixa.
  //
  // O caminho educado é pedir que ele assuma. Só que `skipWaiting` nem sempre
  // move um worker já parado, e "às vezes funciona" não serve para um botão
  // que a pessoa tocou. Então: pede, espera pouco, e se ele não assumir, força
  // pelo caminho que não depende de ninguém — jogar fora o cache, desregistrar
  // e recarregar. Custa uma busca à rede, uma vez. Nada disso toca no cofre.
  parado.postMessage?.('pular-espera');

  const assumiu = await new Promise((resolve) => {
    const pronto = () => resolve(true);
    navigator.serviceWorker.addEventListener('controllerchange', pronto, { once: true });
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', pronto);
      resolve(false);
    }, 3000);
  });

  if (assumiu) return true;   // o controllerchange já recarrega
  await forcarAtualizacao();
  return true;
}

/** Último recurso: joga fora todo o cache do programa e recarrega. */
export async function forcarAtualizacao() {
  if (self.caches) {
    const chaves = await caches.keys();
    await Promise.all(chaves.map((k) => caches.delete(k)));
  }
  // De propósito NÃO desregistra o service worker. Sem ele, o recarregamento
  // busca os módulos com o cache padrão do navegador — que devolve justamente
  // a versão velha que estamos tentando trocar. Com ele no lugar e o cache
  // vazio, cada arquivo é buscado com `no-cache` e vem fresco do servidor.
  location.reload();
}

// Falhas em módulo não aparecem no console de um iPhone — mostra na tela.
window.addEventListener('error', (e) => {
  if (!app.doc) {
    lockScreen(`<div class="boot-mark">Zero<i></i></div>
      <p class="ser">Erro ao carregar.</p><p class="why">${esc(e.message)}</p>`);
  }
});

// O registro não depende do cofre: `main()` fica parado esperando o Face ID ou
// as doze palavras, e quem parasse no meio do cadastro nunca teria o app
// disponível offline. São duas coisas independentes e rodam em paralelo.
cuidarDaVersao();
main();

export { PADROES, sheet };
