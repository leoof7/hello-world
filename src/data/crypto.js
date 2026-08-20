// Criptografia local. O Face ID não destranca a porta — ele gera a chave.
//
// Fluxo com passkey (Safari 18+, iOS 18+):
//   WebAuthn com extensão PRF → segredo de 32 bytes → HKDF → chave AES-256-GCM
//
// Fluxo com senha (navegador sem PRF, ou desktop sem biometria):
//   PBKDF2-SHA256 600.000 iterações → mesma chave AES-256-GCM
//
// Nota de engenharia: o plano falava em Argon2id, que resiste melhor a ataque
// com GPU. Argon2 exige biblioteca externa e este app não tem dependências,
// então usamos PBKDF2 nativo do WebCrypto com o número de iterações que a OWASP
// recomenda. Para um arquivo que já está no aparelho do dono, é adequado.

const enc = new TextEncoder();
const dec = new TextDecoder();

const RP_NAME = 'Zero';
const PRF_SALT = enc.encode('zero.cofre.v1');
const KDF_INFO = enc.encode('zero-aes-256-gcm-v1');
const PBKDF2_ITERATIONS = 600000;

export const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** O navegador suporta passkey de plataforma? */
export async function biometricsAvailable() {
  if (!globalThis.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Cria a passkey. Guarde o retorno — o credentialId precisa ser persistido
 * para conseguir pedir o mesmo segredo depois.
 */
export async function createPasskey(label = 'Zero') {
  const challenge = randomBytes(32);
  const userId = randomBytes(16);

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: location.hostname },
      user: { id: userId, name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 60000,
      extensions: { prf: {} },
    },
  });

  if (!cred) throw new Error('passkey não foi criada');

  const ext = cred.getClientExtensionResults?.() || {};
  const prfSupported = !!ext.prf?.enabled;

  return {
    credentialId: bytesToB64(cred.rawId),
    prfSupported,
  };
}

/** Pede o segredo PRF ao autenticador. Devolve 32 bytes ou null. */
export async function prfSecret(credentialIdB64) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: credentialIdB64
        ? [{ id: b64ToBytes(credentialIdB64), type: 'public-key' }]
        : [],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });

  const results = assertion?.getClientExtensionResults?.();
  const first = results?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/** HKDF: segredo bruto → chave AES-256-GCM utilizável. */
export async function deriveKeyFromSecret(secretBytes, saltBytes) {
  const base = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: KDF_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** PBKDF2: senha → mesma chave AES-256-GCM. */
export async function deriveKeyFromPassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Cifra qualquer objeto. O IV é novo a cada chamada — nunca reutilize. */
export async function encryptJSON(key, data) {
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: bytesToB64(iv), data: bytesToB64(cipher), v: 1 };
}

export async function decryptJSON(key, blob) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(blob.iv) },
    key,
    b64ToBytes(blob.data)
  );
  return JSON.parse(dec.decode(plain));
}

/** Impressão digital curta da chave, para conferir que é a mesma sem revelá-la. */
export async function keyFingerprint(saltBytes, secretBytes) {
  const h = await crypto.subtle.digest('SHA-256', new Uint8Array([...saltBytes, ...secretBytes]));
  return bytesToB64(h).slice(0, 12);
}

export { PBKDF2_ITERATIONS };
