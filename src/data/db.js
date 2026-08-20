// Persistência no aparelho.
//
// Decisão de desenho: o banco inteiro é UM documento cifrado, não registros
// cifrados um a um.
//
// O motivo é simples — índice de IndexedDB é texto puro. Se guardássemos as
// transações como registros com campos indexáveis, o valor, a data e o nome do
// estabelecimento ficariam legíveis para quem abrisse as ferramentas de
// desenvolvedor, e a criptografia viraria enfeite. Com documento único, o que
// está gravado é um bloco opaco.
//
// O custo é carregar tudo na memória. Para um app pessoal isso é irrelevante:
// dez anos de lançamentos dão poucos megabytes.
//
// O registro `meta` fica em texto puro de propósito: ele guarda o sal e o
// identificador da passkey, que são necessários ANTES de conseguir decifrar
// qualquer coisa. Nenhum deles é segredo.

import { encryptJSON, decryptJSON, randomBytes, bytesToB64, b64ToBytes } from './crypto.js';
import { CURRENT_VERSION, migrate, emptyDocument } from './migrations.js';

const DB_NAME = 'zero';
const DB_VERSION = 1;
const STORE = 'vault';
const VAULT_ID = 'documento';
const META_ID = 'meta';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try { result = fn(store); } catch (e) { reject(e); return; }
        // Cuidado com `??` aqui: um get que não achou nada tem `result`
        // undefined, e `undefined ?? request` devolveria o próprio IDBRequest —
        // que é sempre verdadeiro. Registro ausente precisa virar undefined.
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const get = (id) => tx('readonly', (s) => s.get(id));
const put = (value) => tx('readwrite', (s) => s.put(value));

// ---------------- meta (texto puro, sem segredo) ----------------

export async function readMeta() {
  const row = await get(META_ID);
  return row?.value || null;
}

export async function writeMeta(patch) {
  const atual = (await readMeta()) || {};
  const novo = { ...atual, ...patch, updatedAt: new Date().toISOString() };
  await put({ id: META_ID, value: novo });
  return novo;
}

/** Primeira execução: cria o sal e marca a versão do documento. */
export async function initMeta() {
  const existente = await readMeta();
  if (existente?.salt) return existente;
  return writeMeta({
    salt: bytesToB64(randomBytes(16)),
    docVersion: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    unlockMethod: null,
    credentialId: null,
    lastBackupAt: null,
  });
}

export async function saltBytes() {
  const meta = await readMeta();
  if (!meta?.salt) throw new Error('cofre ainda não foi inicializado');
  return b64ToBytes(meta.salt);
}

export const isInitialized = async () => !!(await readMeta())?.salt;

// ---------------- documento (cifrado) ----------------

/** Lê e decifra o documento inteiro, já migrado para a versão atual. */
export async function load(key) {
  const row = await get(VAULT_ID);
  if (!row) return emptyDocument();

  const doc = await decryptJSON(key, row.blob);
  const { document: migrado, applied } = migrate(doc);

  if (applied.length) {
    // Guarda a versão anterior antes de sobrescrever. Migração que dá errado
    // não pode custar os dados de ninguém.
    await put({ id: `${VAULT_ID}.backup.v${doc.version || 0}`, blob: row.blob, savedAt: new Date().toISOString() });
    await save(key, migrado);
    await writeMeta({ docVersion: CURRENT_VERSION, lastMigrationAt: new Date().toISOString() });
  }

  return migrado;
}

export async function save(key, doc) {
  const documento = { ...doc, version: CURRENT_VERSION, updatedAt: new Date().toISOString() };
  const blob = await encryptJSON(key, documento);
  await put({ id: VAULT_ID, blob, updatedAt: documento.updatedAt });
  return documento;
}

export async function hasVault() {
  return !!(await get(VAULT_ID));
}

/** Apaga tudo. Sem volta — a UI precisa confirmar antes de chamar. */
export async function wipe() {
  await tx('readwrite', (s) => s.clear());
  _db?.close();
  _db = null;
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/**
 * Pede ao navegador para não descartar os dados.
 * No iOS, o que realmente protege é o app estar na tela inicial — isto é a
 * segunda linha de defesa.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const jaTem = await navigator.storage.persisted?.();
  if (jaTem) return { supported: true, persisted: true };
  const ok = await navigator.storage.persist();
  return { supported: true, persisted: ok };
}

export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usageBytes: usage, quotaBytes: quota };
}

export { CURRENT_VERSION };
