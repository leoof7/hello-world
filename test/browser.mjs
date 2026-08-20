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

// ----------------------------------------------- começar do zero e sair do exemplo
//
// Estes três casos existem porque falharam de verdade: o app abria com os dados
// de exemplo e a única saída passava por apagar o cofre e refazer as doze
// palavras — que devolvia a pessoa ao começo, em círculo.

/** Faz o cadastro inicial até a escolha do conteúdo. Devolve a página. */
async function novoAparelho(escolha) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#anotei', { timeout: 20000 });
  const palavras = await page.$$eval('.word .w', (els) => els.map((e) => e.textContent.trim()));
  await page.click('#anotei');
  await page.waitForSelector('#conf');
  const pos = await page.$$eval('input[data-p]', (els) => els.map((e) => Number(e.dataset.p)));
  for (const p of pos) await page.fill(`input[data-p="${p}"]`, palavras[p]);
  await page.click('#conf');
  await page.waitForSelector('#pw', { timeout: 20000 });
  await page.fill('#pw', SENHA);
  await page.click('#ok');
  await page.waitForSelector(`#${escolha}`, { timeout: 20000 });
  await page.click(`#${escolha}`);
  await page.waitForSelector('.tabbar', { timeout: 20000 });
  return { ctx, page };
}

const documento = (page) => page.evaluate(async () => {
  const { app } = await import('./src/ui/app.js');
  return {
    tx: app.doc.transactions.length,
    cartoes: app.doc.cards.length,
    dividas: app.doc.debts.length,
    categorias: app.doc.categories.length,
    demo: !!app.doc.profile.demo,
  };
});

const guia = async (page) => {
  await page.evaluate(() => { location.hash = '#guia'; });
  await page.waitForTimeout(350);
  const t = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => { location.hash = '#painel'; });
  await page.waitForTimeout(250);
  return (t.match(/(\d) de (\d) feitas/) || []).slice(1).join('/');
};

{
  console.log('\ncomeçar do zero');
  const { ctx, page } = await novoAparelho('vazio');
  const d = await documento(page);
  ok('o app começa sem nenhum dado', d.tx === 0 && d.cartoes === 0 && d.dividas === 0);
  ok('mas já vem com as categorias', d.categorias > 0, `${d.categorias} categorias`);
  ok('sem faixa de exemplo', !(await page.$('.demo')));
  ok('o guia começa em 0 de 7', (await guia(page)) === '0/7');
  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

{
  console.log('\nsair do exemplo sem refazer nada');
  const { ctx, page } = await novoAparelho('exemplo');
  ok('o exemplo se declara exemplo em todas as telas', !!(await page.$('.demo')));
  ok('o guia reflete o exemplo preenchido', (await guia(page)) === '6/7');

  await page.click('.demo');
  await page.waitForSelector('.sheet');
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(900);

  const limpo = await documento(page);
  ok('limpar zera os dados', limpo.tx === 0 && limpo.cartoes === 0 && limpo.dividas === 0);
  ok('e mantém as categorias', limpo.categorias > 0);
  ok('a faixa de exemplo some', !(await page.$('.demo')));
  ok('o guia volta para 0 de 7', (await guia(page)) === '0/7');
  ok('o Painel vazio convida a começar em vez de mostrar R$ 0',
    await page.evaluate(() => document.body.innerText.includes('Seu app está vazio')));

  // o dado novo tem de sobreviver ao recarregamento, e sem refazer o cofre
  await page.click('[data-act="novo-cartao"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="name"]', 'Meu Nubank');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(600);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pw, #anotei', { timeout: 20000 });
  ok('recarregar NÃO pede as doze palavras de novo', !(await page.$('#anotei')));
  await page.fill('#pw', SENHA);
  await page.click('#ok');
  await page.waitForSelector('.tabbar', { timeout: 20000 });
  const depois = await documento(page);
  ok('o que você cadastrou sobrevive ao recarregamento',
    depois.cartoes === 1 && depois.demo === false);

  // Lançar sem conta nem cartão não pode estourar: tem de explicar e oferecer o passo.
  // Uma dívida cadastrada basta para o Painel sair do estado vazio sem criar origem.
  await page.evaluate(async () => {
    const { commit } = await import('./src/ui/app.js');
    await commit((d) => {
      d.cards = [];
      d.accounts = [];
      d.debts = [{ id: 'dv1', name: 'Teste', kind: 'overdraft', balanceCents: 100000, monthlyRate: 0.08 }];
    });
  });
  await page.evaluate(() => { location.hash = '#painel'; });
  await page.waitForTimeout(400);
  await page.click('[data-act="novo"]');
  await page.waitForTimeout(500);
  ok('lançar sem conta explica em vez de quebrar',
    await page.evaluate(() => document.body.innerText.includes('Cadastre uma conta primeiro')));
  await page.click('.sheet [data-a="no"]');
  await page.waitForTimeout(200);

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

{
  console.log('\nsocorro: erro de desbloqueio nunca é beco sem saída');
  const { ctx, page } = await novoAparelho('exemplo');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pw', { timeout: 20000 });
  await page.fill('#pw', 'senha-que-nao-e-a-certa');
  await page.click('#ok');
  await page.waitForSelector('#zerar', { timeout: 20000 });

  const botoes = await page.$$eval('.lock .btn', (els) => els.map((e) => e.textContent.trim()));
  ok('a tela de socorro aparece com saídas', botoes.length >= 2, botoes.join(' · '));
  ok('oferece tentar de novo o método certo', botoes.some((b) => /senha/i.test(b)), botoes.join(' · '));
  ok('não oferece Face ID num cofre de senha', !botoes.some((b) => /face id/i.test(b)));
  ok('oferece apagar e restaurar', botoes.some((b) => /restaurar/i.test(b)));

  await page.click('#senha');
  await page.waitForSelector('#pw');
  await page.fill('#pw', SENHA);
  await page.click('#ok');
  await page.waitForSelector('.tabbar', { timeout: 20000 });
  ok('a senha certa no socorro abre o cofre', (await documento(page)).tx > 0);

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

await browser.close();

console.log(falhas ? `\n${falhas} verificações falharam` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
