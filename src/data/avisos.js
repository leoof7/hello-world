// Notificação local — o app te procura, sem servidor no meio.
//
// Não é push: push exige servidor, chave VAPID e um endereço para onde mandar,
// e nada disso combina com um app que promete não ter servidor. Aqui a
// notificação nasce e morre no aparelho, disparada quando você abre o app ou
// quando ele volta do segundo plano.
//
// A troca é honesta e precisa ser dita: se você nunca abrir o app, ele não
// avisa. Um app sem servidor não tem como te alcançar dormindo. O que ele
// pode fazer — e faz — é nunca deixar você abrir sem ver o que importa.

const CHAVE_VISTOS = 'zero.avisos.vistos';
const CHAVE_LIGADO = 'zero.avisos.ligado';

/** O navegador deste aparelho sabe notificar? */
export const suportaAvisos = () => typeof Notification !== 'undefined';

export const permissaoAtual = () => (suportaAvisos() ? Notification.permission : 'unsupported');

/** A pessoa ligou os avisos nas configurações do app? */
export const avisosLigados = () => {
  try { return localStorage.getItem(CHAVE_LIGADO) === '1'; } catch { return false; }
};

export function ligarAvisos(ligado) {
  try { localStorage.setItem(CHAVE_LIGADO, ligado ? '1' : '0'); } catch { /* modo privado */ }
}

/**
 * Pede permissão. Só chame a partir de um toque da pessoa: navegador nenhum
 * concede permissão pedida sozinha, e queimar o pedido é definitivo — negado
 * uma vez, só volta pelas configurações do sistema.
 */
export async function pedirPermissao() {
  if (!suportaAvisos()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

/**
 * O que já foi mostrado, para o mesmo aviso não repetir todo dia.
 *
 * A chave carrega a data: "fatura vence em 2 dias" hoje e "vence amanhã"
 * amanhã são avisos diferentes e ambos merecem aparecer. O que não pode é o
 * mesmo aviso, no mesmo dia, aparecer a cada vez que o app abre.
 */
function jaVistos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_VISTOS) || '{}'); } catch { return {}; }
}

function marcarVisto(chave, hojeISO) {
  const vistos = jaVistos();
  vistos[chave] = hojeISO;
  // guarda pouco: o que é de outro mês não interessa mais
  const corte = hojeISO.slice(0, 7);
  for (const k of Object.keys(vistos)) {
    if (String(vistos[k]).slice(0, 7) < corte) delete vistos[k];
  }
  try { localStorage.setItem(CHAVE_VISTOS, JSON.stringify(vistos)); } catch { /* modo privado */ }
}

const foiVistoHoje = (chave, hojeISO) => jaVistos()[chave] === hojeISO;

/**
 * Mostra os avisos que ainda não foram mostrados hoje.
 * Devolve quantos apareceram — zero é resultado normal, não erro.
 */
export async function mostrarAvisos(avisos, hojeISO) {
  if (!suportaAvisos() || !avisosLigados()) return 0;
  if (Notification.permission !== 'granted') return 0;

  let mostrados = 0;
  for (const aviso of avisos) {
    const chave = `${aviso.id}`;
    if (foiVistoHoje(chave, hojeISO)) continue;

    try {
      // Pelo service worker quando existe: no iPhone instalado é o único
      // caminho que funciona com o app fechado em segundo plano.
      const reg = await navigator.serviceWorker?.getRegistration();
      const opcoes = {
        body: aviso.texto,
        tag: aviso.id,
        icon: './icon.svg',
        badge: './icon.svg',
        data: { tela: aviso.tela },
      };
      if (reg?.showNotification) await reg.showNotification(aviso.titulo, opcoes);
      else new Notification(aviso.titulo, opcoes);

      marcarVisto(chave, hojeISO);
      mostrados++;
    } catch {
      // Notificação que não aparece não pode derrubar o app: ela é o extra,
      // não o serviço.
    }
  }
  return mostrados;
}

/** Esquece o que já foi visto — usado ao desligar e voltar a ligar os avisos. */
export function limparVistos() {
  try { localStorage.removeItem(CHAVE_VISTOS); } catch { /* modo privado */ }
}
