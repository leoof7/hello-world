import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomBytes, bytesToB64, b64ToBytes,
  deriveKeyFromSecret, deriveKeyFromPassword,
  encryptJSON, decryptJSON, keyFingerprint,
} from '../src/data/crypto.js';
import {
  WORDS, generatePhrase, phraseToBytes, phraseMatches, challengePositions, suggest,
} from '../src/data/recovery.js';

// btoa/atob existem no Node 22, mas garantimos o ambiente do teste.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

const dadosReais = {
  transactions: [
    { id: 't1', date: '2026-08-15', description: 'Pão de Açúcar', amountCents: -51230 },
    { id: 't2', date: '2026-08-05', description: 'Salário', amountCents: 840000 },
  ],
  cards: [{ id: 'nu', name: 'Nubank', closingDay: 20, dueDay: 27 }],
};

test('base64 vai e volta sem perder byte', () => {
  const b = randomBytes(32);
  assert.deepEqual([...b64ToBytes(bytesToB64(b))], [...b]);
});

test('cifra e decifra com chave derivada de segredo', async () => {
  const segredo = randomBytes(32);
  const salt = randomBytes(16);
  const chave = await deriveKeyFromSecret(segredo, salt);
  const blob = await encryptJSON(chave, dadosReais);

  assert.ok(blob.iv && blob.data);
  assert.ok(!JSON.stringify(blob).includes('Salário'), 'o texto original não pode aparecer no blob');

  const volta = await decryptJSON(chave, blob);
  assert.deepEqual(volta, dadosReais);
});

test('o mesmo segredo e sal geram sempre a mesma chave', async () => {
  const segredo = randomBytes(32);
  const salt = randomBytes(16);
  const a = await deriveKeyFromSecret(segredo, salt);
  const b = await deriveKeyFromSecret(segredo, salt);
  const blob = await encryptJSON(a, { ok: true });
  assert.deepEqual(await decryptJSON(b, blob), { ok: true }, 'a chave B tem que abrir o que A fechou');
});

test('chave errada não abre', async () => {
  const salt = randomBytes(16);
  const certa = await deriveKeyFromSecret(randomBytes(32), salt);
  const errada = await deriveKeyFromSecret(randomBytes(32), salt);
  const blob = await encryptJSON(certa, dadosReais);
  await assert.rejects(() => decryptJSON(errada, blob));
});

test('sal diferente com o mesmo segredo dá chave diferente', async () => {
  const segredo = randomBytes(32);
  const a = await deriveKeyFromSecret(segredo, randomBytes(16));
  const b = await deriveKeyFromSecret(segredo, randomBytes(16));
  const blob = await encryptJSON(a, { ok: true });
  await assert.rejects(() => decryptJSON(b, blob));
});

test('cada cifragem usa IV novo — nunca repete', async () => {
  const chave = await deriveKeyFromSecret(randomBytes(32), randomBytes(16));
  const ivs = new Set();
  for (let i = 0; i < 20; i++) ivs.add((await encryptJSON(chave, { i })).iv);
  assert.equal(ivs.size, 20);
});

test('senha derivada abre o mesmo cofre', async () => {
  const salt = randomBytes(16);
  // iterações reduzidas só para o teste rodar rápido; o app usa 600.000
  const a = await deriveKeyFromPassword('senha bem longa e boa', salt, 1000);
  const b = await deriveKeyFromPassword('senha bem longa e boa', salt, 1000);
  const blob = await encryptJSON(a, dadosReais);
  assert.deepEqual(await decryptJSON(b, blob), dadosReais);
});

test('senha errada não abre', async () => {
  const salt = randomBytes(16);
  const a = await deriveKeyFromPassword('senha certa', salt, 1000);
  const b = await deriveKeyFromPassword('senha errada', salt, 1000);
  const blob = await encryptJSON(a, dadosReais);
  await assert.rejects(() => decryptJSON(b, blob));
});

test('impressão digital identifica a chave sem revelá-la', async () => {
  const segredo = randomBytes(32);
  const salt = randomBytes(16);
  const f1 = await keyFingerprint(salt, segredo);
  const f2 = await keyFingerprint(salt, segredo);
  const f3 = await keyFingerprint(salt, randomBytes(32));
  assert.equal(f1, f2);
  assert.notEqual(f1, f3);
  assert.equal(f1.length, 12);
});

// ---------------- frase de recuperação ----------------

test('a lista tem 256 palavras únicas e sem acento', () => {
  assert.equal(WORDS.length, 256);
  assert.equal(new Set(WORDS).size, 256);
  assert.ok(WORDS.every((w) => /^[a-z]{3,}$/.test(w)));
});

test('gera 12 palavras da lista', () => {
  const f = generatePhrase();
  assert.equal(f.length, 12);
  assert.ok(f.every((w) => WORDS.includes(w)));
});

test('frase vira bytes e os bytes voltam a ser a mesma frase', () => {
  const f = generatePhrase();
  const bytes = phraseToBytes(f);
  assert.equal(bytes.length, 12);
  assert.deepEqual([...bytes].map((b) => WORDS[b]), f);
});

test('a frase abre o cofre em outro aparelho', async () => {
  const frase = generatePhrase();
  const salt = randomBytes(16);

  // aparelho antigo cifra
  const chaveOrigem = await deriveKeyFromSecret(phraseToBytes(frase), salt);
  const backup = await encryptJSON(chaveOrigem, dadosReais);

  // aparelho novo: só tem as palavras e o arquivo
  const chaveDestino = await deriveKeyFromSecret(phraseToBytes(frase.join(' ')), salt);
  assert.deepEqual(await decryptJSON(chaveDestino, backup), dadosReais);
});

test('aceita a frase digitada com espaços, maiúsculas e acentos', () => {
  const f = ['abelha', 'agua', 'anel', 'barco', 'casa', 'chave', 'dedo', 'fogo', 'gelo', 'ilha', 'lua', 'mar'];
  assert.ok(phraseMatches(f, ' ABELHA  Água  Anel barco casa chave dedo fogo gelo ilha lua mar '));
});

test('uma palavra trocada invalida a frase', () => {
  const f = generatePhrase();
  const errada = [...f];
  errada[5] = errada[5] === 'casa' ? 'chave' : 'casa';
  assert.equal(phraseMatches(f, errada), false);
});

test('palavra fora da lista dá erro claro', () => {
  assert.throws(
    () => phraseToBytes('abelha agua anel barco casa chave dedo fogo gelo ilha lua bitcoin'),
    /palavra desconhecida: "bitcoin"/
  );
});

test('frase com número errado de palavras é recusada', () => {
  assert.throws(() => phraseToBytes('abelha agua anel'), /precisa de 12 palavras/);
});

test('a confirmação pede três posições distintas', () => {
  const p = challengePositions(3);
  assert.equal(p.length, 3);
  assert.equal(new Set(p).size, 3);
  assert.ok(p.every((i) => i >= 0 && i < 12));
});

test('autocompletar ajuda a digitar sem errar', () => {
  const s = suggest('ca');
  assert.ok(s.length > 0);
  assert.ok(s.every((w) => w.startsWith('ca')));
});
