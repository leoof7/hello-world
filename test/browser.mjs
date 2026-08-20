// Verificação no navegador — o que `node --test` não alcança.
//
// Os testes de test/*.test.js cobrem o cálculo. Este arquivo cobre o que só
// existe num navegador de verdade: IndexedDB, WebCrypto, o ciclo de backup e
// as nove telas desenhando numa viewport de iPhone, nos dois temas.
//
// Não entra no `npm test` porque precisa do Playwright e de um servidor:
//
//   npm run serve            (num terminal)
//   node test/browser.mjs    (noutro)
//
// Variáveis: BASE (padrão http://localhost:8000/index.html), SHOT=1 grava
// capturas em /tmp/shots, PW (caminho do módulo do Playwright).

const BASE = process.env.BASE || 'http://localhost:8000/index.html';
const PW = process.env.PW || 'playwright';
const SENHA = 'senha-de-teste-123';
const TELAS = ['painel', 'cartoes', 'dividas', 'analise', 'tudo', 'cofrinhos', 'recebimentos', 'revisao', 'guia'];

const { chromium } = await import(PW).then((m) => m.default || m);

let falhas = 0;
const ok = (nome, passou, detalhe = '') => {
  if (!passou) falhas++;
  console.log(`${passou ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` · ${detalhe}` : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

// ------------------------------------------------------- cofre e backup reais

{
  console.log('\ncofre no navegador');
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto(BASE);

  const r = await page.evaluate(async () => {
    const db = await import('./src/data/db.js');
    const cripto = await import('./src/data/crypto.js');
    const rec = await import('./src/data/recovery.js');
    const bk = await import('./src/data/backup.js');
    const { seedDocument } = await import('./src/seed/seed.js');
    const { derive } = await import('./src/ui/state.js');

    // cofre ainda não existe: load devolve documento vazio, não erro
    const meta = await db.initMeta();
    const chave = await cripto.deriveKeyFromPassword('senha-de-teste-123', cripto.b64ToBytes(meta.salt));
    const vazio = await db.load(chave);
    const cofreVazioOk = (await db.hasVault()) === false && vazio.transactions.length === 0;

    // grava e lê de volta
    const original = seedDocument('2026-08-20');
    await db.save(chave, original);
    const lido = await db.load(chave);
    const gravouOk = JSON.stringify(lido.transactions) === JSON.stringify(original.transactions);

    // backup → apagar tudo → restaurar em outro "aparelho" (outra senha)
    const frase = rec.generatePhrase();
    const arquivo = await bk.buildBackup(lido, frase);
    await db.wipe();
    const apagouOk = (await db.hasVault()) === false;

    const meta2 = await db.initMeta();
    const chave2 = await cripto.deriveKeyFromPassword('outra-senha-999', cripto.b64ToBytes(meta2.salt));
    await db.save(chave2, await bk.readBackup(JSON.stringify(arquivo), frase));
    const final = await db.load(chave2);
    const restaurouOk = JSON.stringify(final.transactions) === JSON.stringify(original.transactions);

    // chave errada não abre
    let chaveErradaFalhou = false;
    try {
      await db.load(await cripto.deriveKeyFromPassword('errada-999', cripto.b64ToBytes(meta2.salt)));
    } catch { chaveErradaFalhou = true; }

    const a = derive(original, '2026-08-20');
    const b = derive(final, '2026-08-20');
    await db.wipe();

    return {
      cofreVazioOk, gravouOk, apagouOk, restaurouOk, chaveErradaFalhou,
      mesmoEstado: a.dividaTotalCents === b.dividaTotalCents && a.plano?.freeMonth === b.plano?.freeMonth,
    };
  });

  ok('cofre inexistente devolve documento vazio', r.cofreVazioOk);
  ok('grava cifrado e lê de volta idêntico', r.gravouOk);
  ok('apagar tudo remove o cofre', r.apagouOk);
  ok('backup restaura em outro aparelho', r.restaurouOk);
  ok('chave errada não abre o cofre', r.chaveErradaFalhou);
  ok('estado derivado é o mesmo depois de restaurar', r.mesmoEstado);
  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  await page.close();
}

// ------------------------------------------------------------ telas no iPhone

for (const tema of ['dark', 'light']) {
  console.log(`\ntelas · tema ${tema}`);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: tema,
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  // As fontes do Google podem não carregar numa rede fechada. Isso não é erro
  // do app — o texto do console é genérico, então o filtro olha a URL.
  const externo = (url = '') => /fonts\.(googleapis|gstatic)\.com/.test(url);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (externo(m.location()?.url) || externo(m.text())) return;
    erros.push(m.text());
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // primeira execução: doze palavras + confirmação de três
  await page.waitForSelector('#anotei', { timeout: 20000 });
  const palavras = await page.$$eval('.word .w', (els) => els.map((e) => e.textContent.trim()));
  ok('a frase de recuperação tem 12 palavras', palavras.length === 12);
  await page.click('#anotei');

  await page.waitForSelector('#conf');
  const posicoes = await page.$$eval('input[data-p]', (els) => els.map((e) => Number(e.dataset.p)));
  ok('a confirmação pede 3 palavras', posicoes.length === 3);
  await page.fill(`input[data-p="${posicoes[0]}"]`, 'palavra-errada-de-proposito');
  await page.click('#conf');
  await page.waitForTimeout(300);
  ok('palavra errada não passa da confirmação', await page.$('#conf') !== null);
  for (const p of posicoes) await page.fill(`input[data-p="${p}"]`, palavras[p]);
  await page.click('#conf');

  // sem biometria no Chromium: cai para senha
  await page.waitForSelector('#pw', { timeout: 20000 });
  await page.fill('#pw', SENHA);
  await page.click('#ok');

  await page.waitForSelector('#exemplo', { timeout: 20000 });
  await page.click('#exemplo');
  await page.waitForSelector('.tabbar', { timeout: 20000 });

  for (const tela of TELAS) {
    await page.evaluate((t) => { location.hash = `#${t}`; }, tela);
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => {
      const s = document.querySelector('.screen.active');
      return {
        lateral: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
          || (s ? s.scrollWidth > s.clientWidth + 1 : false),
        conteudo: (s?.innerText || '').trim().length,
      };
    });
    ok(`${tela} desenha sem rolagem lateral`, !info.lateral && info.conteudo > 80, `${info.conteudo} caracteres`);
    if (process.env.SHOT) await page.screenshot({ path: `/tmp/shots/${tema}-${tela}.png` });
  }

  // lançar pelo formulário
  await page.evaluate(() => { location.hash = '#painel'; });
  await page.waitForTimeout(250);
  await page.click('[data-act="novo"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="description"]', 'Teste automático');
  await page.fill('.sheet [name="valor"]', '123,45');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(500);
  ok('lançamento novo aparece na lista',
    await page.evaluate(() => document.body.innerText.includes('Teste automático')));

  // lançar por frase
  await page.click('[data-act="falar"]');
  await page.waitForSelector('#fr-nl');
  await page.fill('#fr-nl', 'gastei 85 no mercado ontem');
  await page.click('[data-ok]');
  await page.waitForSelector('.sheet [name="valor"]');
  const lido = await page.evaluate(() => ({
    valor: document.querySelector('.sheet [name="valor"]').value,
    data: document.querySelector('.sheet [name="date"]').value,
  }));
  ok('a frase vira valor e data', lido.valor === '85,00' && lido.data === '2026-08-19',
    `${lido.valor} · ${lido.data}`);
  await page.click('.sheet [data-x]');
  await page.waitForTimeout(200);

  // olho fechado
  await page.click('[data-act="privacidade"]');
  await page.waitForTimeout(300);
  ok('olho fechado esconde os valores',
    await page.evaluate(() => document.body.innerText.includes('••••')));

  // tema
  await page.click('[data-act="tema"]');
  await page.waitForTimeout(300);
  ok('o botão de tema fixa o tema escolhido',
    await page.evaluate(() => !!document.documentElement.dataset.theme));

  ok('nenhum erro de console', erros.length === 0, erros.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();

console.log(falhas ? `\n${falhas} verificações falharam` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
