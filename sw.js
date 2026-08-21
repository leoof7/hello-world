// Service worker.
//
// Estratégia: cache primeiro para servir, versão inteira trocada de uma vez
// quando o conteúdo muda.
//
// Duas tentativas anteriores erraram, cada uma para um lado:
//
//   1. Cache primeiro com versão fixa. O app instalado nunca mais via uma
//      atualização — servia o mesmo cache para sempre.
//   2. Rede primeiro. Atualizava, mas custava uma revalidação por módulo: com
//      ~30 arquivos, a abertura passou de instantânea para 13 segundos. Um app
//      de finanças que demora 13 s para abrir não é usado.
//
// O que funciona é o meio: servir do cache (rápido, e offline funciona) e
// trocar o cache INTEIRO quando o hash do conteúdo muda. A troca é atômica —
// ou você está inteiramente na versão velha, ou inteiramente na nova. Meia
// versão de um app que calcula dinheiro seria pior que versão velha.
//
// VERSAO é gravada por `npm run versionar` a partir do conteúdo dos arquivos,
// e `npm test` falha se estiver velha. Não dá para publicar esquecendo.
//
// O cofre vive no IndexedDB e o service worker nem o enxerga. Nada aqui toca
// nos seus dados.

const VERSAO = '76e7f32a6d8f';
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
  './src/core/cards.js',
  './src/core/conversa.js',
  './src/core/categorize.js',
  './src/core/leaks.js',
  './src/core/health.js',
  './src/core/history.js',
  './src/core/goals.js',
  './src/core/insights.js',
  './src/core/perfil.js',
  './src/core/parse.js',
  './src/data/db.js',
  './src/data/crypto.js',
  './src/data/recovery.js',
  './src/data/migrations.js',
  './src/data/backup.js',
  './src/data/avisos.js',
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
  './src/ui/tema.js',
  './src/ui/frase.js',
  './src/ui/bate-papo.js',
  './src/ui/graficos.js',
  './src/ui/carrossel.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ARQUIVOS.map((a) =>
        // `no-cache` obriga a ir ao servidor: sem isso o cache HTTP do
        // navegador devolve os arquivos velhos e a "versão nova" nasce igual à
        // antiga. addAll falharia inteiro por um caminho errado, então cada
        // arquivo entra por conta própria.
        fetch(a, { cache: 'no-cache' })
          .then((r) => (r.ok ? c.put(a, r) : null))
          .catch(() => {})
      )))
      // Não espera todas as abas fecharem: o app trata a troca de controlador
      // recarregando uma vez, e a troca do cache é atômica.
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

  // Cache primeiro, para tudo: é o que faz o app abrir instantaneamente e
  // funcionar offline. A atualização não depende daqui — ela vem da troca de
  // versão do próprio service worker, no `install` acima.
  e.respondWith(
    caches.match(req).then((achado) => {
      if (achado) return achado;
      // Cache vazio significa instalação nova ou "buscar atualização": os dois
      // casos querem o arquivo do servidor, não a cópia velha que o cache HTTP
      // do navegador guarda por conta própria. Como só acontece em falta de
      // cache, isso não custa nada nas aberturas normais.
      return fetch(req, { cache: 'no-cache' })
        .then((r) => guardar(req, r))
        .catch(async () =>
          // Navegação offline de uma rota que não está no cache ainda abre o app.
          (req.mode === 'navigate' ? await caches.match('./index.html') : undefined)
        );
    })
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
