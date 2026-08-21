// A cor do app.
//
// O app inteiro pinta a partir de `--jade` e `--jade-2`. Trocar a cor é trocar
// esses dois tokens — nenhuma tela precisa saber que isso existe.
//
// A cor livre não é solta: o texto que vai POR CIMA dela é calculado, não
// escolhido. Sem isso, um amarelo claro com texto branco vira um botão
// ilegível — e o botão ilegível costuma ser justamente o principal.

export const CORES = [
  { id: 'jade', nome: 'Verde', base: '#0a7b5a', claro: '#0e9a70', escuro: '#3ddc9a', escuro2: '#2ec288' },
  { id: 'azul', nome: 'Azul', base: '#1f6fd0', claro: '#2f8ae8', escuro: '#5fa8f5', escuro2: '#4b95e6' },
  { id: 'roxo', nome: 'Roxo', base: '#6d55d8', claro: '#8570e8', escuro: '#9d8cf5', escuro2: '#8b78ea' },
  { id: 'rosa', nome: 'Rosa', base: '#c2306e', claro: '#d94b87', escuro: '#f57fae', escuro2: '#e86e9d' },
  { id: 'ambar', nome: 'Âmbar', base: '#b7791f', claro: '#d1912f', escuro: '#f0b34a', escuro2: '#dda23c' },
];

export const CINZA_DEFAULT = CORES[0];

/** '#0a7b5a' → { r, g, b }. Aceita com ou sem o #, três ou seis dígitos. */
export function hexParaRgb(hex) {
  let s = String(hex || '').trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

const paraCanal = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Luminância relativa (WCAG). 0 = preto, 1 = branco. */
export function luminancia(hex) {
  const rgb = hexParaRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * paraCanal(rgb.r) + 0.7152 * paraCanal(rgb.g) + 0.0722 * paraCanal(rgb.b);
}

/**
 * Que cor de texto vai por cima desta. Não é gosto: é a que enxerga.
 * O corte em 0.45 favorece texto claro, porque a cor entra em botão cheio.
 */
export const textoSobre = (hex) => (luminancia(hex) > 0.45 ? '#16191d' : '#ffffff');

/** Clareia ou escurece uma cor, para gerar o tom de apoio. */
export function ajustar(hex, fator) {
  const rgb = hexParaRgb(hex);
  if (!rgb) return hex;
  const mover = (c) => {
    const alvo = fator > 0 ? 255 : 0;
    return Math.round(c + (alvo - c) * Math.abs(fator));
  };
  const hexar = (c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  return `#${hexar(mover(rgb.r))}${hexar(mover(rgb.g))}${hexar(mover(rgb.b))}`;
}

/**
 * Monta a paleta a partir de uma cor qualquer.
 * `soft` é o fundo de chip: a mesma cor bem diluída, que muda com o tema.
 */
export function paletaDe(hex, { escuro = false } = {}) {
  const base = escuro ? ajustar(hex, 0.35) : hex;
  return {
    jade: base,
    jade2: ajustar(base, escuro ? -0.15 : 0.12),
    onJade: textoSobre(base),
    jadeSoft: escuro ? ajustar(hex, -0.72) : ajustar(hex, 0.88),
  };
}

/**
 * Aplica a cor no documento. Chamado no arranque e a cada troca.
 * `corId` é um dos presets; `corLivre` é um hex e vence o preset quando existe.
 */
export function aplicarCor({ corId = 'jade', corLivre = null } = {}, raiz = document.documentElement) {
  const preset = CORES.find((c) => c.id === corId) || CINZA_DEFAULT;
  const hex = corLivre && hexParaRgb(corLivre) ? corLivre : preset.base;

  const escuro = raiz.dataset.theme === 'dark'
    || (!raiz.dataset.theme && matchMedia?.('(prefers-color-scheme: dark)')?.matches);

  const p = corLivre && hexParaRgb(corLivre)
    ? paletaDe(hex, { escuro })
    : {
        jade: escuro ? preset.escuro : preset.base,
        jade2: escuro ? preset.escuro2 : preset.claro,
        onJade: escuro ? '#08251b' : '#ffffff',
        jadeSoft: escuro ? ajustar(preset.base, -0.72) : ajustar(preset.base, 0.88),
      };

  raiz.style.setProperty('--jade', p.jade);
  raiz.style.setProperty('--jade-2', p.jade2);
  raiz.style.setProperty('--on-jade', p.onJade);
  raiz.style.setProperty('--jade-soft', p.jadeSoft);
  return p;
}
