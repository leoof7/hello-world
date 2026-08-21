// Carimba o service worker com um hash do conteúdo do app.
//
// Por que isto existe: o navegador decide se há versão nova comparando o
// sw.js byte a byte. Se o sw.js não muda, ele nunca reinstala e o app fica
// congelado na versão que o usuário instalou — foi exatamente o que aconteceu.
//
// A receita comum é "lembrar de trocar a constante a cada publicação". É
// frágil pelo motivo óbvio: basta esquecer uma vez e o app para de atualizar
// sem ninguém perceber. Aqui a constante é calculada a partir dos arquivos, e
// `npm test` falha se ela estiver velha — dá para esquecer, não dá para
// publicar esquecido.
//
//   node scripts/versionar.mjs            grava o hash no sw.js
//   node scripts/versionar.mjs --conferir só confere e sai com erro se mudou

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SW = `${RAIZ}sw.js`;

/** Os arquivos que compõem o app, lidos da própria lista do service worker. */
export function arquivosDoApp(textoDoSW = readFileSync(SW, 'utf8')) {
  const lista = textoDoSW.match(/const ARQUIVOS = \[([\s\S]*?)\];/);
  if (!lista) throw new Error('não achei a lista ARQUIVOS no sw.js');
  return [...lista[1].matchAll(/'\.\/([^']*)'/g)]
    .map((m) => m[1])
    .filter(Boolean);
}

/** Todo .js dentro de src/, com barra normal, relativo à raiz. */
function modulosNoDisco(raiz = RAIZ, pasta = 'src') {
  const achados = [];
  for (const item of readdirSync(`${raiz}${pasta}`, { withFileTypes: true })) {
    const caminho = `${pasta}/${item.name}`;
    if (item.isDirectory()) achados.push(...modulosNoDisco(raiz, caminho));
    else if (item.name.endsWith('.js')) achados.push(caminho);
  }
  return achados;
}

/**
 * Módulos que existem em src/ e não estão na lista do service worker.
 *
 * Este é o erro que mais voltou neste projeto: criar um módulo novo, importar
 * em outro, tudo funcionar no navegador com rede — e o app instalado quebrar
 * porque o arquivo nunca entrou no cache. O navegador não avisa; a tela só
 * fica branca. Conferir aqui é a única forma de isso não depender de memória.
 */
export function modulosForaDoCache(raiz = RAIZ) {
  const listados = new Set(arquivosDoApp(readFileSync(`${raiz}sw.js`, 'utf8')));
  return modulosNoDisco(raiz).filter((m) => !listados.has(m));
}

/**
 * Hash do conteúdo de todos os arquivos.
 * O nome de cada arquivo entra junto, para que renomear também conte como
 * mudança.
 */
export function calcularVersao(raiz = RAIZ) {
  const textoSW = readFileSync(`${raiz}sw.js`, 'utf8');
  // O próprio sw.js entra sem a linha da versão, senão o hash dependeria de si.
  const swSemVersao = textoSW.replace(/const VERSAO = '[^']*';/, '');

  const h = createHash('sha256');
  h.update(swSemVersao);
  for (const arquivo of arquivosDoApp(textoSW).sort()) {
    h.update(arquivo);
    try {
      h.update(readFileSync(`${raiz}${arquivo}`));
    } catch {
      // caminho na lista que não existe mais: entra como ausente, e a
      // diferença aparece no hash em vez de passar em branco
      h.update('(ausente)');
    }
  }
  return h.digest('hex').slice(0, 12);
}

/** A versão que está gravada no sw.js hoje. */
export function versaoGravada(raiz = RAIZ) {
  return (readFileSync(`${raiz}sw.js`, 'utf8').match(/const VERSAO = '([^']*)';/) || [])[1] || null;
}

export function gravar(raiz = RAIZ) {
  const nova = calcularVersao(raiz);
  const texto = readFileSync(`${raiz}sw.js`, 'utf8');
  const atualizado = texto.replace(/const VERSAO = '[^']*';/, `const VERSAO = '${nova}';`);
  if (atualizado === texto && !texto.includes(`'${nova}'`)) {
    throw new Error('não achei a linha `const VERSAO` no sw.js');
  }
  writeFileSync(`${raiz}sw.js`, atualizado);
  return nova;
}

// Rodando direto pela linha de comando.
//
// Comparar o fim do caminho parece bastar e não basta: no Windows o argv[1]
// vem com barra invertida, `split('/')` não separa nada, e o teste dava falso
// sempre. Resultado: `npm test` rodava este arquivo, ele saía 0 sem conferir
// coisa nenhuma, e a conferência de versão existia só no papel. Converter os
// dois lados para URL de arquivo é o jeito que não depende do separador.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const conferir = process.argv.includes('--conferir');

  const faltando = modulosForaDoCache();
  if (faltando.length) {
    console.error('estes módulos não estão na lista ARQUIVOS do sw.js:');
    for (const m of faltando) console.error(`  ./${m}`);
    console.error('o app instalado quebraria com a tela branca. adicione e rode de novo.');
    process.exit(1);
  }

  const esperada = calcularVersao();
  const atual = versaoGravada();

  if (conferir) {
    if (atual === esperada) {
      console.log(`versão em dia: ${atual}`);
      process.exit(0);
    }
    console.error(`versão desatualizada: sw.js diz "${atual}", conteúdo dá "${esperada}"`);
    console.error('rode: npm run versionar');
    process.exit(1);
  }

  const nova = gravar();
  console.log(atual === nova ? `já estava em dia: ${nova}` : `${atual} → ${nova}`);
}
