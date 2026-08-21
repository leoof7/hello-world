// Helpers de renderização. Sem framework — o app é pequeno o bastante para
// montar HTML com template string e trocar innerHTML de uma tela por vez.

/** Escapa texto vindo de dados do usuário antes de entrar no HTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Template tag que escapa tudo que for interpolado. Use html`` sempre. */
export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const rendered = Array.isArray(v) ? v.join('') : v;
    // `raw` marca trechos já montados por outro html`` — não escapa de novo.
    const safe = rendered && rendered.__raw ? rendered.value : esc(rendered);
    return acc + safe + s;
  }, '');
}

/** Marca uma string como HTML já pronto. */
export const raw = (value) => ({ __raw: true, value: String(value ?? '') });

/** Junta pedaços já montados. */
export const join = (parts) => raw(parts.join(''));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Ícone do conjunto próprio. Traço, grade de 24, sem emoji. */
const ICONS = {
  casa: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>',
  cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
  escudo: '<path d="M12 21s7-4.5 7-10V5.5L12 3 5 5.5V11c0 5.5 7 10 7 10z"/>',
  escudoOk: '<path d="M12 21s7-4.5 7-10V5.5L12 3 5 5.5V11c0 5.5 7 10 7 10z"/><path d="m9.5 11.5 1.8 1.8 3.4-3.6"/>',
  grafico: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>',
  menu: '<circle cx="5.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="12" r="2.5"/><circle cx="5.5" cy="18.5" r="2.5"/><path d="M11 5.5h9M11 12h9M11 18.5h9"/>',
  microfone: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sino: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  voltar: '<path d="M15 6l-6 6 6 6"/>',
  cima: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  baixo: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
  x: '<path d="M5 5l14 14M19 5 5 19"/>',
  alerta: '<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cofre: '<path d="M4 10.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v3a6 6 0 0 1-6 6h-3a6 6 0 0 1-6-6z"/><path d="M8.5 10.5h.01M4 12H2.5"/>',
  cadeado: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/>',
  copiar: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  colar: '<path d="M8 4H6.5A1.5 1.5 0 0 0 5 5.5v14A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 17.5 4H16"/><rect x="8" y="2.5" width="8" height="4" rx="1.3"/>',
  upload: '<path d="M12 21V9M7.5 13.5 12 9l4.5 4.5M4 4h16"/>',
  lista: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  carro: '<path d="M3 12.5h18v4H3zM4.5 12.5 6 7h12l1.5 5.5"/><circle cx="7" cy="16.5" r="1.4"/><circle cx="17" cy="16.5" r="1.4"/>',
  pix: '<path d="M12 3 21 12l-9 9-9-9z"/>',
  mercado: '<path d="M6 2l1 5h10l1-5"/><path d="M3 7h18l-2 13H5z"/>',
  dinheiro: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6M12 16.6h.01"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-2.82 1.18 2 2 0 1 1-4 0 1.65 1.65 0 0 0-2.82-1.18 2 2 0 1 1-2.83-2.83A1.65 1.65 0 0 0 4.6 15a2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.18-2.82 2 2 0 1 1 2.83-2.83A1.65 1.65 0 0 0 11.4 4.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 2.82 1.18 2 2 0 1 1 2.83 2.83A1.65 1.65 0 0 0 19.4 11a2 2 0 1 1 0 4z"/>',
  banco: '<path d="M3 6.5h18v11H3z"/><path d="M3 10h18"/>',
  face: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M9 10h.01M15 10h.01M8.8 14.6a4.2 4.2 0 0 0 6.4 0"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.lista;
  return `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Sparkline simples a partir de uma série de números. */
export function sparkline(values, { color = 'var(--jade)', width = 120, height = 30 } = {}) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

let toastTimer = null;
export function toast(message, ms = 2600) {
  const antigo = $('.toast');
  if (antigo) antigo.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/**
 * Copia para a área de transferência. Devolve se deu certo.
 *
 * `navigator.clipboard` só existe em contexto seguro, e o app roda em http://
 * na rede local enquanto não tem HTTPS — justamente onde a pessoa mais precisa
 * do botão. Por isso o plano B com textarea e execCommand continua aqui.
 */
export async function copiar(texto) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* sem permissão ou sem contexto seguro: tenta o plano B */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, texto.length); // o iOS ignora select() sozinho
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Lê a área de transferência. Devolve '' quando o aparelho não deixa.
 *
 * Vazio aqui não é erro: no iPhone o Safari pode pedir permissão e a pessoa
 * pode negar. Quem chama trata isso pedindo o colar manual, sem alarde.
 */
export async function colar() {
  try {
    return (await navigator.clipboard?.readText?.()) || '';
  } catch {
    return '';
  }
}

/**
 * Entrega um arquivo pelo melhor caminho do aparelho.
 *
 * No iPhone o share sheet é o que leva para o app Arquivos ou para o iCloud;
 * o download com <a> é o caminho do desktop e do Android.
 */
export async function entregar(conteudo, nome, tipo = 'text/plain') {
  const arquivo = new File([conteudo], nome, { type: tipo });
  if (navigator.canShare?.({ files: [arquivo] })) {
    try { await navigator.share({ files: [arquivo], title: nome }); return 'compartilhado'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelado'; }
  }
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'baixado';
}

/** Folha inferior. Devolve uma promessa que resolve com o que o conteúdo enviar. */
export function sheet(innerHTML, { onMount } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet';
    wrap.innerHTML = `<div class="card" role="dialog" aria-modal="true">${innerHTML}</div>`;

    const fechar = (value) => { wrap.remove(); document.removeEventListener('keydown', esc); resolve(value); };
    const esc = (e) => { if (e.key === 'Escape') fechar(null); };

    wrap.addEventListener('click', (e) => { if (e.target === wrap) fechar(null); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(wrap);

    onMount?.(wrap.querySelector('.card'), fechar);
    wrap.querySelector('input, select, button')?.focus();
  });
}

export async function confirmar({ titulo, texto, ok = 'Confirmar', perigo = false }) {
  return sheet(
    `<h4>${esc(titulo)}</h4><p class="sub">${esc(texto)}</p>
     <div class="btns">
       <button class="btn ${perigo ? 'danger' : 'primary'}" data-a="ok">${esc(ok)}</button>
       <button class="btn ghost" data-a="no">Cancelar</button>
     </div>`,
    {
      onMount: (card, fechar) => {
        card.querySelector('[data-a="ok"]').onclick = () => fechar(true);
        card.querySelector('[data-a="no"]').onclick = () => fechar(false);
      },
    }
  );
}
