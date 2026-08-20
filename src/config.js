// Configuração do app.
//
// MODO decide se o Zero roda como app pessoal ou como produto. O código é o
// mesmo; o que muda é o que fica ligado. Isso existe desde agora para que o dia
// da decisão não custe uma reescrita.

export const MODO = 'pessoal'; // 'pessoal' | 'produto'

export const FEATURES = {
  // Sempre ligados
  faceId: true,
  backupLocal: true,
  importarExtrato: true,

  // Só no modo produto
  cofreNuvem: MODO === 'produto',
  licenca: MODO === 'produto',
  varios_usuarios: false,
};

export const APP = {
  nome: 'Zero',
  versao: '0.1.0',
  // O rpId da passkey é o domínio. Trocar de domínio exige recriar a
  // credencial — recuperando pela frase de doze palavras.
  dominio: globalThis.location?.hostname || 'localhost',
};

export const PADROES = {
  backupACadaDias: 7,
  metodoDivida: 'avalanche',
  reservaMesesAlvo: 6,
  projecaoDias: 90,
  muroMeses: 12,
  // Teto de comprometimento da renda acima do qual o app alerta
  comprometimentoSaudavel: 0.3,
};

/** No modo produto, isto aponta para o Worker do cofre. */
export const COFRE = {
  endpoint: FEATURES.cofreNuvem ? 'https://cofre.zero.app' : null,
};
