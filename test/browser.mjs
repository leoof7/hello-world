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
const TELAS = ['painel', 'cartoes', 'dividas', 'analise', 'tudo', 'cofrinhos', 'recebimentos', 'revisao', 'guia', 'investimentos', 'faturas'];

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
  await completarOnboardingObrigatorio(page);
  return { ctx, page };
}

/**
 * Documento novo entra no tour obrigatório de 3 passos antes de liberar a
 * navegação (contas, dívidas, renda e gastos fixos — em sequência, sem
 * tabbar até terminar). Preenche o mínimo pelos mesmos botões que a pessoa
 * tocaria. Documento com dados (exemplo, backup restaurado) nunca cai nesse
 * tour, então a função só age quando o botão do primeiro passo aparece.
 */
async function completarOnboardingObrigatorio(page) {
  const el = await page.waitForSelector('[data-act="nova-conta"], .tabbar', { timeout: 20000 });
  const emOnboarding = await el.evaluate((e) => e.matches('[data-act="nova-conta"]'));
  if (!emOnboarding) return;

  await page.click('[data-act="nova-conta"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="name"]', 'Conta teste');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(300);

  await page.waitForSelector('[data-act="pular-onboarding"]', { timeout: 20000 });
  await page.click('[data-act="pular-onboarding"]');
  await page.waitForTimeout(300);

  await page.waitForSelector('[data-act="nova-renda"]', { timeout: 20000 });
  await page.click('[data-act="nova-renda"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="label"]', 'Salário teste');
  await page.fill('.sheet [name="valor"]', '1.000,00');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(300);

  // Termina os 3 passos e cai na oferta do tour guiado — dispensa pra
  // continuar testando o app normal.
  await page.waitForSelector('[data-act="pular-tour"]', { timeout: 20000 });
  await page.click('[data-act="pular-tour"]');
  await page.waitForTimeout(300);

  await page.waitForSelector('.tabbar', { timeout: 20000 });
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

  // Limpar cria um documento novo, e documento novo entra no tour obrigatório
  // de novo — mesmo comportamento de um aparelho de verdade.
  await completarOnboardingObrigatorio(page);

  const limpo = await documento(page);
  ok('limpar zera os dados', limpo.tx === 0 && limpo.cartoes === 0 && limpo.dividas === 0);
  ok('e mantém as categorias', limpo.categorias > 0);
  ok('a faixa de exemplo some', !(await page.$('.demo')));
  ok('o guia volta para 0 de 7', (await guia(page)) === '0/7');
  // O tour obrigatório já deixa 1 conta e 1 renda cadastradas, então o Painel
  // não cai mais no herói "vazio" — mostra números de verdade, ainda que
  // pequenos. Confere isso em vez do texto de app vazio, que não aparece mais.
  ok('o Painel mostra a tela normal, não a de app vazio',
    await page.evaluate(() => !document.body.innerText.includes('Seu app está vazio')));

  // o dado novo tem de sobreviver ao recarregamento, e sem refazer o cofre
  // (o Painel não vazio não tem mais o atalho de cartão — vai pela aba)
  await page.evaluate(() => { location.hash = '#cartoes'; });
  await page.waitForTimeout(350);
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
  // Zerar conta reabriria o tour obrigatório (ele exige pelo menos uma) — não é
  // o que este bloco testa, então tira o documento do tour de propósito.
  await page.evaluate(async () => {
    const { commit } = await import('./src/ui/app.js');
    await commit((d) => {
      d.cards = [];
      d.accounts = [];
      d.debts = [{ id: 'dv1', name: 'Teste', kind: 'overdraft', balanceCents: 100000, monthlyRate: 0.08 }];
      delete d.profile.onboarding;
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

// ------------------------------------------- as telas concordam entre si
//
// Existe porque `minimosAgendados` era a quarta cópia da regra do mínimo e
// ficou para trás: a tela de Dívidas dizia um número e a projeção usava outro,
// levando o caixa a R$ 650 mil negativos com uma dívida de R$ 10 mil.

{
  console.log('\ncoerência entre as telas');
  const { ctx, page } = await novoAparelho('vazio');

  await page.evaluate(async () => {
    const { commit } = await import('./src/ui/app.js');
    await commit((d) => {
      // Zera o que o tour obrigatório deixou (uma renda de teste) para o
      // total abaixo continuar exato — mantém a conta, que o gate exige.
      d.recurring = [];
      d.accounts.push({ id: 'ac', name: 'Conta', type: 'checking', balanceCents: 0 });
      d.recurring.push({ id: 'r1', label: 'Totvs', kind: 'income', amountCents: 470000, dayOfMonth: 7, fixed: true });
      d.recurring.push({ id: 'r2', label: 'Aluguel', kind: 'expense', amountCents: 90000, dayOfMonth: 10, categoryId: 'moradia' });
      d.debts.push({ id: 'dv', name: 'Itau', kind: 'revolving', balanceCents: 1050000,
        monthlyRate: 0.16, minPaymentRate: 36.5, since: '2026-08-10' });
      d.budgets = { moradia: 90000, mercado: 80000 };
    });
  });

  const numeros = await page.evaluate(async () => {
    const { app } = await import('./src/ui/app.js');
    const v = app.view;
    return {
      minimos: v.minimosCents,
      agendado: Math.abs(v.eventos.find((e) => e.kind === 'debt')?.amountCents || 0),
      saldo: Math.abs(app.doc.debts[0].balanceCents),
      pior: v.projecao.min.cents,
      renda: v.rendaFixaCents,
    };
  });
  ok('o mínimo agendado na projeção é o mesmo da tela de Dívidas',
    numeros.agendado === numeros.minimos, `${numeros.agendado} vs ${numeros.minimos}`);
  ok('e nunca passa do saldo devedor', numeros.agendado <= numeros.saldo);
  ok('a projeção fica em ordem de grandeza plausível', numeros.pior > -5000000,
    `pior dia R$ ${(numeros.pior / 100).toFixed(2)}`);
  ok('a renda cadastrada chega às contas', numeros.renda === 470000);

  await page.evaluate(() => { location.hash = '#analise'; });
  await page.waitForTimeout(600);
  ok('e a Saúde tira Moradia da lista de tetos e mostra como gasto fixo',
    await page.evaluate(() => document.body.innerText.includes('Gastos fixos')));

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

// ----------------------------------------------------------- campos numéricos
//
// Existe porque "10,500" digitado num campo de dinheiro virava R$ 10,50: a
// pessoa queria dez mil e quinhentos e o app guardava dez reais e cinquenta,
// calado. E porque campo com menos de 16px faz o Safari do iPhone dar zoom e
// jogar a tela para o lado.

{
  console.log('\ncampos de número e dinheiro');
  const { ctx, page } = await novoAparelho('vazio');

  const digitar = async (sel, texto) => {
    await page.click(sel);
    await page.evaluate((x) => { document.querySelector(x).value = ''; }, sel);
    await page.type(sel, texto, { delay: 12 });
    return page.inputValue(sel);
  };

  await page.evaluate(() => { location.hash = '#dividas'; });
  await page.waitForTimeout(350);
  await page.click('[data-act="nova-divida"]');
  await page.waitForSelector('.sheet #frm');

  ok('campo tem 16px — abaixo disso o iPhone dá zoom ao focar',
    (await page.evaluate(() => getComputedStyle(document.querySelector('.sheet input')).fontSize)) === '16px');

  ok('dinheiro cresce da direita: "10500" vira 105,00',
    (await digitar('.sheet [name="saldo"]', '10500')) === '105,00');
  ok('e "1050000" vira 10.500,00',
    (await digitar('.sheet [name="saldo"]', '1050000')) === '10.500,00');
  ok('porcentagem recusa R$ e letras',
    (await digitar('.sheet [name="taxa"]', 'R$16,5abc')) === '16,5');

  await page.fill('.sheet [name="name"]', 'Itau');
  await digitar('.sheet [name="saldo"]', '1050000');
  await digitar('.sheet [name="taxa"]', '16');
  await digitar('.sheet [name="minimoPct"]', '15');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  const salvo = await page.evaluate(async () => {
    const { app } = await import('./src/ui/app.js');
    return app.doc.debts[0];
  });
  ok('e o que foi salvo é o que apareceu no campo',
    salvo.balanceCents === 1050000 && salvo.monthlyRate === 0.16 && salvo.minPaymentRate === 0.15,
    `R$ ${(salvo.balanceCents / 100).toFixed(2)}`);

  // dia e parcelas fora da faixa ficam presos nela
  await page.evaluate(() => { location.hash = '#cartoes'; });
  await page.waitForTimeout(350);
  await page.click('[data-act="novo-cartao"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="name"]', 'Teste');
  await page.fill('.sheet [name="closingDay"]', '99');
  await page.fill('.sheet [name="dueDay"]', '0');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);
  const cartao = await page.evaluate(async () => (await import('./src/ui/app.js')).app.doc.cards[0]);
  ok('dia de fechamento fora do mês é preso na faixa',
    cartao.closingDay === 31 && cartao.dueDay === 1, `fecha ${cartao.closingDay}, vence ${cartao.dueDay}`);

  await page.evaluate(() => { location.hash = '#painel'; });
  await page.waitForTimeout(350);
  await page.click('[data-act="novo"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="description"]', 'Sofá');
  await digitar('.sheet [name="valor"]', '120000');
  // Parcelas só existe pagando no crédito — escolhe o cartão pra ela aparecer.
  await page.selectOption('.sheet [name="origem"]', { label: 'Teste — crédito' });
  await page.fill('.sheet [name="count"]', '900');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(900);
  const parcelas = await page.evaluate(async () => {
    const { app } = await import('./src/ui/app.js');
    return app.doc.transactions.filter((t) => t.installment).length;
  });
  ok('900 parcelas viram 48, não 900 lançamentos', parcelas === 48, `${parcelas} parcelas`);

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

// ------------------------------------------- avulso do mês aparece no total
//
// Existe porque um avulso lançado hoje some do total: a média só usa meses
// fechados, e a tela dizia "R$ 0 de média" logo abaixo do recebimento visível.

{
  console.log('\nrecebimento avulso do mês');
  const { ctx, page } = await novoAparelho('vazio');
  await page.evaluate(async () => {
    const { commit } = await import('./src/ui/app.js');
    const { today } = await import('./src/core/dates.js');
    const hoje = today();
    await commit((d) => {
      // Zera a renda de teste que o tour obrigatório deixou, para o total
      // abaixo bater exato.
      d.recurring = [];
      d.recurring.push({ id: 'r1', label: 'Totvs', kind: 'income', amountCents: 470000, dayOfMonth: 7, fixed: true });
      d.transactions.push({ id: 't1', date: hoje, competence: hoje.slice(0, 7),
        description: 'Cr7', amountCents: 2000, extraordinary: true, method: 'pix' });
    });
  });
  await page.evaluate(() => { location.hash = '#recebimentos'; });
  await page.waitForTimeout(600);

  const tela = await page.evaluate(() => document.body.innerText);
  ok('o total soma o avulso do mês', tela.includes('R$ 4.720'), (tela.match(/R\$ [\d.]+/) || [])[0]);
  ok('e diz que a média ainda não existe', tela.includes('sem média ainda'));
  ok('explicando por quê', tela.includes('A média só aparece depois de um mês'));

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

// --------------------------------------------------- números que não existem
//
// Existe porque uma dívida de R$ 3.732 apareceu na tela pedindo R$ 136.232 de
// mínimo: o valor em reais tinha sido digitado no campo de porcentagem, e nada
// no caminho questionou 3650% do saldo.

{
  console.log('\nnúmeros impossíveis');
  const { ctx, page } = await novoAparelho('vazio');
  await page.evaluate(() => { location.hash = '#dividas'; });
  await page.waitForTimeout(350);

  await page.click('[data-act="nova-divida"]');
  await page.waitForSelector('.sheet #frm');
  await page.fill('.sheet [name="name"]', 'Cartão');
  await page.fill('.sheet [name="saldo"]', '3.732,39');
  await page.fill('.sheet [name="taxa"]', '16');
  await page.fill('.sheet [name="minimoPct"]', '3650');   // reais no campo de %
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(700);

  const barrado = await page.evaluate(() => ({
    aviso: document.querySelector('.toast')?.textContent || '',
    aberta: !!document.querySelector('.sheet'),
    nome: document.querySelector('.sheet [name="name"]')?.value,
    saldo: document.querySelector('.sheet [name="saldo"]')?.value,
    taxa: document.querySelector('.sheet [name="taxa"]')?.value,
  }));
  ok('valor em reais no campo de porcentagem é recusado', barrado.aviso.includes('não existe'));
  ok('e o formulário volta com tudo que foi digitado',
    barrado.aberta && barrado.nome === 'Cartão' && barrado.saldo === '3.732,39' && barrado.taxa === '16');

  await page.fill('.sheet [name="minimoPct"]', '15');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(800);

  const certo = await page.evaluate(async () => {
    const { app } = await import('./src/ui/app.js');
    return {
      taxa: app.doc.debts[0]?.minPaymentRate,
      naTela: (document.body.innerText.match(/Mínimos obrigatórios\s*R\$\s*[\d.,]+/) || [''])[0],
    };
  });
  ok('com 15% o mínimo fica plausível', certo.taxa === 0.15 && certo.naTela.includes('559,86'), certo.naTela);

  // dado já guardado antes da correção: o mínimo é limitado e a tela avisa
  await page.evaluate(async () => {
    const { commit } = await import('./src/ui/app.js');
    await commit((d) => { d.debts[0].minPaymentRate = 36.5; });
  });
  await page.waitForTimeout(600);
  const velho = await page.evaluate(() => ({
    avisa: document.body.innerText.includes('Confira esta dívida'),
    minimos: (document.body.innerText.match(/Mínimos obrigatórios\s*R\$\s*[\d.,]+/) || [''])[0],
  }));
  ok('dado antigo impossível nunca passa do saldo', velho.minimos.includes('3.732,39'), velho.minimos);
  ok('e a tela pede para corrigir em vez de fingir', velho.avisa);

  await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
  await ctx.close();
}

// ------------------------------------------------------ confirmar por escrito
//
// Existe porque a confirmação exigia "APAGAR" em maiúsculas e o teclado do
// iPhone entrega "Apagar": a pessoa digitava certo, o app recusava, e a única
// resposta era "Nada foi apagado." — sem dizer o que estava errado.

{
  console.log('\nconfirmação por escrito');
  for (const [digitado, deveApagar] of [['Apagar', true], ['APAGAR', true], ['  apagar ', true], ['errado', false]]) {
    const { ctx, page } = await novoAparelho('exemplo');
    await page.evaluate(() => { location.hash = '#tudo'; });
    await page.waitForTimeout(350);
    await page.click('[data-act="apagar"]');
    await page.waitForSelector('.sheet [data-a="ok"]');
    await page.click('.sheet [data-a="ok"]');
    await page.waitForSelector('.sheet [name="palavra"]', { timeout: 8000 });

    if (digitado === 'Apagar') {
      const teclado = await page.evaluate(() => {
        const i = document.querySelector('.sheet [name="palavra"]');
        return { cap: i.getAttribute('autocapitalize'), corr: i.getAttribute('autocorrect') };
      });
      ok('o campo não deixa o teclado autocapitalizar nem autocorrigir',
        teclado.cap === 'off' && teclado.corr === 'off');
    }

    await page.fill('.sheet [name="palavra"]', digitado);
    await page.click('.sheet button[type="submit"]');

    if (!deveApagar) {
      // o aviso some sozinho em poucos segundos: conferir agora, não depois
      const aviso = await page.waitForSelector('.toast', { timeout: 5000 }).catch(() => null);
      ok('o aviso diz por que não apagou',
        !!aviso && (await aviso.textContent()).includes('não confere'));
    }

    const apagou = await page.waitForSelector('#anotei', { timeout: 20000 }).then(() => true).catch(() => false);
    ok(`"${digitado}" ${deveApagar ? 'apaga' : 'é recusado'}`, apagou === deveApagar);

    await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); }).catch(() => {});
    await ctx.close();
  }
}

// -------------------------------------------------- atualização chega sozinha
//
// A pergunta que este bloco responde: publicando uma versão nova, o app
// instalado busca sozinho — e os dados sobrevivem?
//
// Existe porque a resposta já foi "não": o service worker era cache primeiro e
// servia a mesma versão para sempre. Depois, mesmo com rede primeiro, o cache
// HTTP do navegador respondia no lugar do servidor.

{
  console.log('\natualização');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const alvo = `${raiz}src/ui/screens.js`;
  const original = readFileSync(alvo, 'utf8');

  try {
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
    await page.waitForSelector('#exemplo', { timeout: 20000 });
    await page.click('#exemplo');
    await page.waitForSelector('.tabbar', { timeout: 20000 });

    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20000 });
    ok('o service worker assume o controle', true);
    ok('e o cadastro inicial NÃO é interrompido por recarregamento',
      await page.evaluate(() => !!document.querySelector('.tabbar')));

    const antes = await page.evaluate(async () => (await import('./src/ui/app.js')).app.doc.transactions.length);

    // "publica" uma versão nova: muda um texto visível e carimba a versão,
    // que é exatamente o que `npm run versionar` faz antes de cada publicação
    writeFileSync(alvo, original.replace('Últimos lançamentos', 'MARCADOR-DE-VERSAO-NOVA'));
    const { gravar, versaoGravada } = await import('../scripts/versionar.mjs');
    const versaoAntiga = versaoGravada(raiz);
    const versaoNova = gravar(raiz);
    ok('publicar muda a versão carimbada no service worker', versaoAntiga !== versaoNova,
      `${versaoAntiga} → ${versaoNova}`);

    // a pessoa fecha e abre o app
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pw', { timeout: 20000 });
    await page.fill('#pw', SENHA);
    await page.click('#ok');
    await page.waitForSelector('.tabbar', { timeout: 25000 });

    // O app NÃO se reinicia no meio do uso: a versão nova espera na faixa até
    // a pessoa aceitar. Aparecer a faixa já é a atualização ter chegado.
    const faixa = await page.waitForSelector('.atz', { timeout: 25000 }).catch(() => null);
    const jaTrocou = await page.evaluate(() => document.body.innerText.includes('MARCADOR-DE-VERSAO-NOVA'));
    ok('a versão nova chega só de abrir o app', !!faixa || jaTrocou,
      jaTrocou ? 'trocou direto' : 'faixa oferecendo instalar');

    if (faixa && !jaTrocou) {
      // Aceitar recarrega a página, que volta para o desbloqueio.
      // O clique re-consulta o seletor de propósito: `render()` troca o
      // innerHTML inteiro, e uma referência guardada antes disso aponta para um
      // nó que não está mais no documento — o clique iria para o vazio.
      await page.click('.atz');
      await page.waitForSelector('#pw', { timeout: 25000 });
      await page.fill('#pw', SENHA);
      await page.click('#ok');
      await page.waitForSelector('.tabbar', { timeout: 25000 });

      ok('aceitar deixa o service worker servindo a versão nova',
        await page.evaluate(async () =>
          (await fetch('./src/ui/screens.js').then((r) => r.text())).includes('MARCADOR-DE-VERSAO-NOVA')));

      const guardados = await page.evaluate(() => caches.keys());
      ok('e sobra um cache só', guardados.length === 1, guardados.join(', '));

      // A tela em si pode levar mais um carregamento: os módulos velhos já
      // estavam na memória quando a página recarregou. A próxima abertura —
      // que é o que a pessoa faz — mostra a versão nova.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pw', { timeout: 25000 });
      await page.fill('#pw', SENHA);
      await page.click('#ok');
      await page.waitForSelector('.tabbar', { timeout: 25000 });
      ok('e na abertura seguinte a tela é a nova',
        await page.evaluate(() => document.body.innerText.includes('MARCADOR-DE-VERSAO-NOVA')));
    }

    const depois = await page.evaluate(async () => (await import('./src/ui/app.js')).app.doc.transactions.length);
    ok('e os dados atravessam a atualização intactos', depois === antes && depois > 0,
      `${antes} → ${depois} lançamentos`);

    await page.evaluate(async () => { await (await import('./src/data/db.js')).wipe(); });
    await ctx.close();
  } finally {
    // nunca deixar o repositório sujo, mesmo se algo acima falhar
    writeFileSync(alvo, original);
    const { gravar } = await import('../scripts/versionar.mjs');
    gravar(raiz);
  }
}

// ------------------------------------------------------- velocidade de abertura
//
// Existe porque a folha de estilo do Google Fonts, sendo bloqueante, custava
// 14 SEGUNDOS de tela branca numa rede ruim — num app cujos arquivos próprios
// somam 25 ms. Um app que roda no seu aparelho não pode depender do Google
// para abrir.

{
  console.log('\nvelocidade de abertura');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  // simula o Google inalcançável — rede corporativa, DNS envenenado, 4G ruim
  await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());

  const t = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#anotei', { timeout: 30000 });
  const ms = Date.now() - t;
  ok('abre em menos de 3 s mesmo sem alcançar o Google Fonts', ms < 3000, `${ms} ms`);

  ok('e o texto continua legível com as fontes do sistema',
    await page.evaluate(() => {
      const f = getComputedStyle(document.querySelector('.ser') || document.body).fontFamily;
      return f.length > 0;
    }));

  await ctx.close();
}

await browser.close();

console.log(falhas ? `\n${falhas} verificações falharam` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
