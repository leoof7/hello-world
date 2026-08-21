// Backup — a única rede de segurança de um app sem servidor.
//
// Sobre "automático": um site NÃO grava arquivo no seu disco sozinho. É regra
// de segurança do navegador, não limitação nossa.
//
//   Chrome/Edge no computador  → File System Access API regrava no mesmo
//                                arquivo depois da permissão inicial.
//                                Aí sim é automático de verdade.
//   Safari no iPhone           → não existe. O caminho é o app preparar o
//                                arquivo e você confirmar na folha de
//                                compartilhamento, salvando no iCloud Drive.
//
// Por isso o backup semanal é AGENDADO E ASSISTIDO: o app lembra na hora certa
// e deixa tudo pronto; você confirma em dois toques.

import { encryptJSON, decryptJSON, deriveKeyFromSecret, randomBytes, bytesToB64, b64ToBytes } from './crypto.js';
import { phraseToBytes } from './recovery.js';
import { looksLikeDocument, migrate, CURRENT_VERSION } from './migrations.js';
import { readMeta, writeMeta } from './db.js';
import { today, daysBetween } from '../core/dates.js';

const MAGIC = 'zero-backup';
const FORMAT = 1;

/**
 * Monta o arquivo de backup.
 *
 * O arquivo é cifrado com uma chave derivada das DOZE PALAVRAS, não da passkey.
 * Isso é proposital: a passkey é do aparelho; a frase é sua. Um backup que só
 * abre no aparelho que o gerou não é backup.
 */
export async function buildBackup(document, phrase) {
  const salt = randomBytes(16);
  const key = await deriveKeyFromSecret(phraseToBytes(phrase), salt);
  const payload = await encryptJSON(key, document);

  return {
    magic: MAGIC,
    format: FORMAT,
    docVersion: document.version || CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    salt: bytesToB64(salt),
    payload,
  };
}

/** Lê o arquivo de volta. Precisa das mesmas doze palavras. */
/**
 * Abre o envelope e confere se é backup do Zero — sem pedir as doze palavras.
 *
 * Existe separado de `readBackup` porque a ordem importa: digitar doze
 * palavras e só então ouvir "esse arquivo não é um backup" é trabalho jogado
 * fora, e faz a pessoa desconfiar das palavras quando o problema era o arquivo.
 */
export function openEnvelope(file) {
  let envelope;
  if (typeof file === 'string') {
    try {
      envelope = JSON.parse(file);
    } catch {
      // Sem esta guarda o erro que chegava na tela era o SyntaxError do
      // JSON.parse — "Unexpected token < in JSON at position 0" não diz a
      // ninguém que ele escolheu o arquivo errado.
      throw new Error('Este arquivo não é um backup do Zero — o conteúdo não é do formato certo.');
    }
  } else {
    envelope = file;
  }

  if (envelope?.magic !== MAGIC) {
    throw new Error('Este arquivo não é um backup do Zero.');
  }
  if (envelope.format > FORMAT) {
    throw new Error('Backup gerado por uma versão mais nova do app. Atualize antes de restaurar.');
  }
  return envelope;
}

export async function readBackup(file, phrase) {
  const envelope = openEnvelope(file);

  const key = await deriveKeyFromSecret(phraseToBytes(phrase), b64ToBytes(envelope.salt));

  let documento;
  try {
    documento = await decryptJSON(key, envelope.payload);
  } catch {
    throw new Error('As doze palavras não abrem este arquivo. Confira a ordem e a grafia.');
  }

  if (!looksLikeDocument(documento)) {
    throw new Error('O arquivo abriu, mas o conteúdo não parece um backup do Zero.');
  }

  return migrate(documento).document;
}

export const backupFilename = (date = today()) => `zero-${date}.zbk`;

/**
 * Entrega o arquivo ao usuário pelo melhor caminho que o aparelho oferece.
 *
 * 1. Folha de compartilhamento (iOS) — leva direto ao iCloud Drive
 * 2. Download comum (computador)
 */
export async function deliver(backupObject, filename = backupFilename()) {
  const json = JSON.stringify(backupObject);
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup do Zero' });
      return { method: 'compartilhamento', ok: true };
    } catch (e) {
      if (e?.name === 'AbortError') return { method: 'compartilhamento', ok: false, cancelled: true };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { method: 'download', ok: true };
}

/** Marca que o backup foi feito. */
export async function markDone(date = today()) {
  return writeMeta({ lastBackupAt: date });
}

/**
 * O app deve cobrar backup?
 * Devolve também há quantos dias foi o último, para a UI escolher o tom.
 */
export async function backupStatus(todayISO = today()) {
  const meta = (await readMeta()) || {};
  const ultimo = meta.lastBackupAt || null;
  const intervalo = meta.backupEveryDays || 7;

  if (!ultimo) {
    return { due: true, never: true, daysSince: null, intervalDays: intervalo, severity: 'alta' };
  }

  const dias = daysBetween(ultimo, todayISO);
  return {
    due: dias >= intervalo,
    never: false,
    lastAt: ultimo,
    daysSince: dias,
    intervalDays: intervalo,
    severity: dias >= intervalo * 4 ? 'alta' : dias >= intervalo ? 'media' : 'ok',
  };
}

/** Texto do aviso, no tom certo para o atraso. */
export function backupMessage(status) {
  if (status.never) return 'Você ainda não fez nenhum backup. Sem servidor, ele é a sua única cópia.';
  if (status.daysSince >= status.intervalDays * 4) {
    return `Seu último backup foi há ${status.daysSince} dias. Se perder o aparelho agora, perde tudo desde então.`;
  }
  if (status.due) return `Já faz ${status.daysSince} dias desde o último backup.`;
  return `Backup em dia — o último foi há ${status.daysSince} ${status.daysSince === 1 ? 'dia' : 'dias'}.`;
}

/** Lê um arquivo escolhido pelo usuário. */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    reader.readAsText(file);
  });
}
