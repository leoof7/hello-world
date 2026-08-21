// A cor do app.
//
// O app inteiro pinta a partir de `--jade` e `--jade-2`. Trocar a cor é trocar
// esses dois tokens — nenhuma tela precisa saber que isso existe.
//
// A cor livre não é solta: o texto que vai POR CIMA dela é calculado, não
// escolhido. Sem isso, um amarelo claro com texto branco vira um botão
// ilegível — e o botão ilegível costuma ser justamente o principal.

export const CORES = [
  // O padrão é o neutro: o app abre em branco e areia, sem cor escolhida por
  // ele. Isso resolve de um jeito honesto o problema de "com que cor começar" —
  // qualquer palpite sobre a pessoa erra em alguém, e um app de dinheiro não
  // precisa ter opinião sobre quem você é para funcionar. O grafite quente
  // deixa botão e link legíveis; o tour avisa que dá para trocar.
  { id: 'neutro', nome: 'Neutro', base: '#3a3628', claro: '#2b2820', escuro: '#ddd8cc', escuro2: '#c9c3b4' },
  // O verde é o primeiro porque é o padrão, e o padrão agora é o do redesign:
  // um verde de mata, não o jade elétrico de antes. O id continua 'jade' de
  // propósito — quem já escolheu essa cor não pode ver o app trocar sozinho.
  { id: 'jade', nome: 'Verde', base: '#4a7a5e', claro: '#3d6a50', escuro: '#7cb894', escuro2: '#6aa682' },
  { id: 'areia', nome: 'Areia', base: '#8a5a24', claro: '#6e4519', escuro: '#d9a86a', escuro2: '#c4a46a' },
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

/** Mistura duas cores. t=0 devolve `a`, t=1 devolve `b`. */
export function misturar(a, b, t) {
  const ca = hexParaRgb(a);
  const cb = hexParaRgb(b);
  if (!ca || !cb) return a;
  const q = Math.max(0, Math.min(1, t));
  const hexar = (c) => Math.round(c).toString(16).padStart(2, '0');
  return `#${hexar(ca.r + (cb.r - ca.r) * q)}${hexar(ca.g + (cb.g - ca.g) * q)}${hexar(ca.b + (cb.b - ca.b) * q)}`;
}

/**
 * Quanto de cor entra em cada superfície neutra, por tema.
 *
 * No claro os números são pequenos de propósito: fundo tingido é ambiente, não
 * decoração, e passando de ~6% o app deixa de parecer um app de dinheiro e o
 * texto cinza começa a brigar com o fundo.
 *
 * No escuro é o contrário — a mesma proporção some. Um cinza escuro tem pouca
 * distância até qualquer cor escura, então 5% ali não é sutil, é invisível. Por
 * isso a força é umas três vezes maior, e ainda assim o fundo continua escuro.
 */
const TINTA = {
  // O fundo claro recebe pouquíssimo. A base agora é um areia escolhido, não
  // um cinza neutro — tingir com força puxava o areia para o verde e ainda
  // escurecia a tela. Quando a base já tem temperatura própria, o papel da
  // tinta é lembrar a cor, não substituí-la.
  '--bg': { claro: 0.022, escuro: 0.2 },
  '--surface': { claro: 0.012, escuro: 0.13 },
  '--surface-2': { claro: 0.035, escuro: 0.17 },
  '--chip': { claro: 0.1, escuro: 0.22 },
  '--line': { claro: 0.11, escuro: 0.24 },
  '--line-2': { claro: 0.07, escuro: 0.16 },
};

/**
 * O gradiente do cartão-herói, puxado para a cor escolhida.
 *
 * O herói é escuro nos dois temas — é o cartão preto do topo do Painel. Aqui
 * ele deixa de ser preto-neutro e passa a ser a versão bem escura da cor: é o
 * lugar onde a personalização aparece mais e custa menos legibilidade, porque
 * o texto por cima é sempre branco.
 */
export function heroDe(hex) {
  const escuro = misturar('#0d1116', hex, 0.14);
  const meio = misturar('#181d24', hex, 0.18);
  const claro = misturar('#212832', hex, 0.22);
  return `linear-gradient(160deg, ${escuro} 0%, ${meio} 55%, ${claro} 100%)`;
}

/** rgba() a partir de um hex — para o brilho do herói, que precisa de alfa. */
export function comAlfa(hex, alfa) {
  const rgb = hexParaRgb(hex);
  if (!rgb) return `rgba(0,0,0,${alfa})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alfa})`;
}

/**
 * As superfícies neutras tingidas pela cor escolhida.
 *
 * Recebe os neutros que o CSS declarou em vez de guardar cópia deles: duas
 * listas de cinzas, uma no CSS e outra aqui, saem de sincronia no primeiro
 * ajuste de tema que alguém fizer.
 */
export function superficiesTingidas(neutros, hex, { escuro = false } = {}) {
  // No escuro a cor precisa vir mais escura que ela mesma, senão tingir o
  // fundo o clareia — e um fundo que clareia arruína o tema escuro inteiro.
  // Escurecer multiplicando os canais mantém o matiz: rosa continua rosa.
  const tinta = escuro ? ajustar(hex, -0.42) : hex;
  const saida = {};
  for (const [token, forca] of Object.entries(TINTA)) {
    if (neutros[token]) saida[token] = misturar(neutros[token], tinta, escuro ? forca.escuro : forca.claro);
  }
  return saida;
}

/**
 * A cor da barra do sistema no app instalado.
 *
 * É a faixa acima do app na tela cheia do iPhone e a barra de endereço no
 * Android. Sem isto ela fica no cinza fixo do index.html e cria uma emenda
 * visível logo acima do conteúdo tingido — o app parece colado dentro de outro.
 *
 * Com tema explícito as duas metas recebem a mesma cor: o app decidiu ignorar
 * a preferência do sistema, e a barra tem que ignorar junto. No automático só
 * a meta do esquema atual muda, porque a outra ainda vale se o sistema virar.
 */
export function pintarBarraDoSistema(cor, { escuro = false, explicito = false, doc = document } = {}) {
  const metas = [...doc.querySelectorAll('meta[name="theme-color"]')];
  if (!metas.length) return null;
  const alvo = escuro ? 'dark' : 'light';
  for (const meta of metas) {
    const media = meta.getAttribute('media') || '';
    if (explicito || !media || media.includes(alvo)) meta.setAttribute('content', cor);
  }
  return cor;
}

/**
 * Aplica a cor no documento. Chamado no arranque e a cada troca.
 * `corId` é um dos presets; `corLivre` é um hex e vence o preset quando existe.
 */
export function aplicarCor({ corId = 'neutro', corLivre = null } = {}, raiz = document.documentElement) {
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

  // Ambiente: as superfícies neutras ganham um fio da cor. Os neutros são
  // lidos do CSS com os overrides removidos primeiro — senão a segunda troca
  // de cor tingiria o resultado da primeira, e a cada clique o app escureceria.
  for (const token of Object.keys(TINTA)) raiz.style.removeProperty(token);
  if (typeof getComputedStyle === 'function') {
    const css = getComputedStyle(raiz);
    const neutros = {};
    for (const token of Object.keys(TINTA)) neutros[token] = css.getPropertyValue(token).trim();
    const tingidas = superficiesTingidas(neutros, hex, { escuro });
    for (const [token, valor] of Object.entries(tingidas)) raiz.style.setProperty(token, valor);
    if (tingidas['--bg']) {
      pintarBarraDoSistema(tingidas['--bg'], { escuro, explicito: !!raiz.dataset.theme });
    }
  }

  raiz.style.setProperty('--hero', heroDe(p.jade));
  raiz.style.setProperty('--hero-glow', comAlfa(p.jade, escuro ? 0.22 : 0.34));

  return p;
}
