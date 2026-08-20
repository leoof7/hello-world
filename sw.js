// Service worker.
//
// Estratégia: REDE PRIMEIRO para os arquivos do próprio app, cache primeiro só
// para as fontes.
//
// A versão anterior fazia cache primeiro em tudo, e o resultado é que um app já
// instalado nunca mais via uma atualização: o navegador servia o cache antigo
// para sempre, e a única saída era apagar o site. Trocar uma constante a cada
// publicação seria remédio frágil demais — bastava esquecer uma vez.
//
// Com rede primeiro, quem está online sempre roda a versão publicada, e quem
// está offline continua abrindo pelo cache. O custo é uma ida à rede na
// abertura; para um app deste tamanho, é ruído.
//
// O cofre vive no IndexedDB e o service worker nem o enxerga. Nada aqui toca
// nos seus dados.

const VERSAO = 'v2';
const CACHE = `zero-${VERSAO}`;

const ARQUIVOS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './src/config.js',
  './src/core/money.js',
  './src/core/dates.js',
  './src/core/statements.js',
  './src/core/installments.js',
  './src/core/projection.js',
  './src/core/debts.js',
  './src/core/budget.js',
  './src/core/categorize.js',
  './src/core/leaks.js',
  './src/core/health.js',
  './src/core/parse.js',
  './src/data/db.js',
  './src/data/crypto.js',
  './src/data/recovery.js',
  './src/data/migrations.js',
  './src/data/backup.js',
  './src/io/csv.js',
  './src/io/ofx.js',
  './src/io/ics.js',
  './src/seed/categories.js',
  './src/seed/seed.js',
  './src/ui/app.js',
  './src/ui/screens.js',
  './src/ui/actions.js',
  './src/ui/state.js',
  './src/ui/dom.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falha inteiro se um arquivo faltar; guardamos um a um para que
      // um caminho errado não derrube a instalação toda.
      .then((c) => Promise.all(ARQUIVOS.map((a) => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Guarda a resposta boa e devolve ela. */
async function guardar(req, resposta) {
  if (resposta && resposta.ok) {
    const copia = resposta.clone();
    caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
  }
  return resposta;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const propria = url.origin === location.origin;

  // Fontes e afins: cache primeiro. Elas não mudam, e assim o app abre offline
  // com a tipografia certa.
  if (!propria) {
    e.respondWith(
      caches.match(req).then((achado) =>
        achado || fetch(req).then((r) => guardar(req, r)).catch(() => achado)
      )
    );
    return;
  }

  // Arquivos do app: rede primeiro, cache como rede de segurança.
  //
  // O `cache: 'no-cache'` não é exagero — sem ele o "rede primeiro" é mentira:
  // o cache HTTP do próprio navegador responde no lugar do servidor e devolve
  // a versão antiga sem sequer perguntar. Com ele há revalidação: se o arquivo
  // não mudou, o servidor responde 304 e não trafega nada.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => guardar(req, r))
      .catch(async () =>
        (await caches.match(req))
        // Navegação offline sem a rota em cache ainda abre o app.
        || (req.mode === 'navigate' ? await caches.match('./index.html') : undefined)
      )
  );
});

self.addEventListener('message', (e) => {
  // O app avisou que a pessoa aceitou a versão nova: assume agora, sem esperar
  // que todas as abas fechem.
  if (e.data === 'pular-espera') {
    self.skipWaiting();
    return;
  }

  // Saída manual de "Buscar atualização", para quando algo trava mesmo assim.
  if (e.data === 'limpar-cache') {
    e.waitUntil(
      caches.keys()
        .then((chaves) => Promise.all(chaves.map((k) => caches.delete(k))))
        .then(() => e.source?.postMessage('cache-limpo'))
    );
  }
});
