// As doze palavras.
//
// Sem servidor não existe "esqueci minha senha" — não há ninguém do outro lado
// para te reconhecer. Estas doze palavras são a única chave-mestra: com elas
// você abre um backup em qualquer aparelho, mesmo sem o iPhone antigo e sem a
// conta Apple.
//
// Entropia: 256 palavras (8 bits cada) × 12 = 96 bits. É menos que os 128 bits
// do BIP-39, e a escolha é deliberada: o BIP-39 precisa de uma lista de 2048
// palavras, e 96 bits já estão muito além de qualquer força bruta viável contra
// um arquivo que o atacante precisaria roubar primeiro. Palavras curtas, sem
// acento e sem ambiguidade de escrita — o usuário vai copiar isso à mão.

import { randomBytes, bytesToB64, b64ToBytes } from './crypto.js';

export const WORDS = [
  'abelha', 'abraco', 'acucar', 'agenda', 'agua', 'aguia', 'alface', 'algodao',
  'almoco', 'amendoa', 'amigo', 'amora', 'ancora', 'andar', 'anel', 'anjo',
  'antena', 'apito', 'aranha', 'areia', 'armario', 'arroz', 'arvore', 'asfalto',
  'atalho', 'atlas', 'aveia', 'avenida', 'aviao', 'azeite', 'azul', 'bacia',
  'bagagem', 'baiao', 'balde', 'bambu', 'banana', 'banco', 'bandeira', 'barco',
  'batata', 'baunilha', 'bezerro', 'bicho', 'bilhete', 'boi', 'bolacha', 'bolso',
  'bonde', 'borboleta', 'bosque', 'bota', 'braco', 'brasa', 'brinco', 'bule',
  'buzina', 'cabana', 'cacau', 'cadeira', 'caderno', 'cafe', 'caixa', 'caju',
  'calcada', 'camelo', 'caminho', 'campo', 'cana', 'canela', 'canoa', 'capim',
  'caqui', 'carne', 'carro', 'carta', 'casa', 'casaco', 'castanha', 'cavalo',
  'cebola', 'cedro', 'ceia', 'cenoura', 'cereja', 'cerca', 'cesta', 'chave',
  'cheiro', 'chuva', 'cidade', 'cinema', 'cinto', 'circo', 'coco', 'coelho',
  'colar', 'colher', 'coluna', 'concha', 'coral', 'corda', 'coruja', 'costa',
  'couve', 'cravo', 'creme', 'crianca', 'cristal', 'cubo', 'cuia', 'curva',
  'dado', 'dedal', 'dedo', 'deserto', 'dever', 'dezena', 'diamante', 'dique',
  'disco', 'doce', 'dobra', 'domingo', 'dourado', 'dueto', 'duna', 'elefante',
  'enxada', 'ervilha', 'escada', 'escova', 'esfera', 'espada', 'espelho', 'espiga',
  'estrada', 'estrela', 'fada', 'faca', 'farelo', 'farinha', 'farol', 'favo',
  'feijao', 'feira', 'ferro', 'festa', 'figo', 'filme', 'flauta', 'flor',
  'floresta', 'fogo', 'folha', 'forno', 'fita', 'fruta', 'fumaca', 'funil',
  'gado', 'gaiola', 'galho', 'galo', 'ganso', 'garca', 'garfo', 'gaveta',
  'geada', 'gelo', 'girassol', 'goiaba', 'gota', 'grama', 'granja', 'grilo',
  'gruta', 'guarda', 'harpa', 'hera', 'horta', 'hotel', 'igreja', 'ilha',
  'imagem', 'inverno', 'iogurte', 'irmao', 'janela', 'jardim', 'jarro', 'jasmim',
  'jibota', 'joia', 'jornal', 'jumento', 'lago', 'lampada', 'lanche', 'lapis',
  'laranja', 'leite', 'lenco', 'lenha', 'leque', 'letra', 'limao', 'lingua',
  'linha', 'livro', 'lobo', 'lombo', 'lua', 'luva', 'macaco', 'maca',
  'madeira', 'malha', 'manga', 'manteiga', 'mapa', 'mar', 'marfim', 'martelo',
  'massa', 'mata', 'mel', 'melancia', 'mesa', 'milho', 'mina', 'moeda',
  'moinho', 'molho', 'monte', 'morango', 'mosaico', 'mudanca', 'muro', 'musgo',
  'nabo', 'navio', 'neblina', 'ninho', 'noite', 'nozes', 'nuvem', 'oceano',
  'oleo', 'ombro', 'onda', 'onca', 'orvalho', 'ostra', 'ouro', 'ovelha',
];

if (WORDS.length !== 256) {
  throw new Error(`a lista precisa de 256 palavras, tem ${WORDS.length}`);
}

const INDEX = new Map(WORDS.map((w, i) => [w, i]));

const normalize = (w) =>
  String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Gera 12 palavras a partir de 12 bytes aleatórios. */
export function generatePhrase() {
  const bytes = randomBytes(12);
  return [...bytes].map((b) => WORDS[b]);
}

/** Palavras → os bytes que viram a chave-mestra. */
export function phraseToBytes(words) {
  const list = Array.isArray(words) ? words : String(words).split(/\s+/);
  const clean = list.map(normalize).filter(Boolean);
  if (clean.length !== 12) {
    throw new Error(`a frase precisa de 12 palavras, veio ${clean.length}`);
  }
  const bytes = new Uint8Array(12);
  clean.forEach((w, i) => {
    if (!INDEX.has(w)) throw new Error(`palavra desconhecida: "${w}"`);
    bytes[i] = INDEX.get(w);
  });
  return bytes;
}

/** Confere se o que o usuário digitou bate com a frase gerada. */
export function phraseMatches(original, typed) {
  try {
    return bytesToB64(phraseToBytes(original)) === bytesToB64(phraseToBytes(typed));
  } catch {
    return false;
  }
}

/**
 * Sorteia quais posições pedir na confirmação.
 * Confirmar três palavras é chato de propósito: quem não anotou descobre agora,
 * e não daqui a seis meses com o celular perdido.
 */
export function challengePositions(count = 3) {
  const posicoes = new Set();
  while (posicoes.size < count) {
    posicoes.add(randomBytes(1)[0] % 12);
  }
  return [...posicoes].sort((a, b) => a - b);
}

/** Sugestões para autocompletar enquanto o usuário digita. */
export function suggest(prefix, limit = 5) {
  const p = normalize(prefix);
  if (!p) return [];
  return WORDS.filter((w) => w.startsWith(p)).slice(0, limit);
}

export { normalize, bytesToB64, b64ToBytes };
