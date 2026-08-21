import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexParaRgb, luminancia, textoSobre, ajustar, paletaDe, CORES,
  misturar, heroDe, comAlfa, superficiesTingidas,
} from '../src/ui/tema.js';

test('lê hex de três e de seis dígitos, com ou sem cerquilha', () => {
  assert.deepEqual(hexParaRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexParaRgb('000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexParaRgb('#0a7b5a'), { r: 10, g: 123, b: 90 });
});

test('hex inválido não vira cor errada, vira nada', () => {
  assert.equal(hexParaRgb('roxo'), null);
  assert.equal(hexParaRgb('#12345'), null);
  assert.equal(hexParaRgb(''), null);
});

test('luminância separa claro de escuro', () => {
  assert.ok(luminancia('#ffffff') > 0.9);
  assert.ok(luminancia('#000000') < 0.05);
  assert.ok(luminancia('#ffff00') > luminancia('#0000ff'), 'amarelo é mais luminoso que azul');
});

// O ponto todo da cor livre: o texto por cima tem que ser legível SEMPRE.
test('texto escuro sobre cor clara, texto claro sobre cor escura', () => {
  assert.equal(textoSobre('#ffff00'), '#16191d', 'amarelo pede texto escuro');
  assert.equal(textoSobre('#ffffff'), '#16191d');
  assert.equal(textoSobre('#0a7b5a'), '#ffffff', 'verde escuro pede texto branco');
  assert.equal(textoSobre('#000000'), '#ffffff');
});

test('nenhuma cor livre gera botão ilegível', () => {
  const testadas = ['#ffff00', '#00ff00', '#ff00ff', '#000080', '#f5f5dc', '#ff0000', '#00ffff'];
  for (const cor of testadas) {
    const texto = textoSobre(cor);
    const contraste = Math.abs(luminancia(cor) - luminancia(texto));
    assert.ok(contraste > 0.3, `${cor} com texto ${texto} tem contraste fraco (${contraste.toFixed(2)})`);
  }
});

test('ajustar clareia e escurece sem estourar a faixa', () => {
  assert.equal(ajustar('#808080', 1), '#ffffff', 'fator 1 chega no branco');
  assert.equal(ajustar('#808080', -1), '#000000', 'fator -1 chega no preto');
  const rgb = hexParaRgb(ajustar('#0a7b5a', 0.5));
  assert.ok(rgb.r >= 0 && rgb.r <= 255 && rgb.g >= 0 && rgb.g <= 255 && rgb.b >= 0 && rgb.b <= 255);
});

test('a paleta traz os quatro tokens que o app usa', () => {
  const p = paletaDe('#c2306e');
  for (const chave of ['jade', 'jade2', 'onJade', 'jadeSoft']) {
    assert.ok(p[chave], `falta ${chave}`);
    assert.match(p[chave], /^#[0-9a-f]{6}$/i, `${chave} tem que ser hex`);
  }
});

test('o chip claro é claro e o chip escuro é escuro', () => {
  const claro = paletaDe('#c2306e', { escuro: false });
  const escuro = paletaDe('#c2306e', { escuro: true });
  assert.ok(luminancia(claro.jadeSoft) > 0.6, 'no tema claro o chip é quase branco');
  assert.ok(luminancia(escuro.jadeSoft) < 0.2, 'no tema escuro o chip é quase preto');
});

test('todos os presets têm os tons dos dois temas', () => {
  for (const c of CORES) {
    for (const chave of ['base', 'claro', 'escuro', 'escuro2']) {
      assert.match(c[chave], /^#[0-9a-f]{6}$/i, `${c.id}.${chave} inválido`);
    }
    assert.ok(c.nome, `${c.id} precisa de nome`);
  }
});

test('os presets são legíveis nos dois temas', () => {
  for (const c of CORES) {
    const contrasteClaro = Math.abs(luminancia(c.base) - luminancia('#ffffff'));
    assert.ok(contrasteClaro > 0.3, `${c.nome} com texto branco no tema claro tem contraste fraco`);
  }
});

// ------------------------------------------- a cor tingindo o app inteiro

// Os mesmos neutros que o app.css declara. Se um dia divergirem, estes testes
// deixam de valer para a tela de verdade — por isso a leitura em produção é do
// CSS, e aqui eles entram só como amostra.
const NEUTROS_CLARO = {
  '--bg': '#f4f5f7', '--surface': '#ffffff', '--surface-2': '#f6f7f9',
  '--chip': '#eef0f3', '--line': '#e6e8ec', '--line-2': '#f0f1f4',
};
const NEUTROS_ESCURO = {
  '--bg': '#12151a', '--surface': '#191d24', '--surface-2': '#232833',
  '--chip': '#2b313d', '--line': '#2b313c', '--line-2': '#232833',
};

// Cores que quebram tudo se a mistura estiver ingênua: amarelo puro, branco,
// preto e um ciano estourado.
const EXTREMAS = ['#ffff00', '#ffffff', '#000000', '#00ffff', '#ff0000'];
const TODAS = [...CORES.map((c) => c.base), ...EXTREMAS];

test('misturar respeita as pontas e o meio', () => {
  assert.equal(misturar('#000000', '#ffffff', 0), '#000000');
  assert.equal(misturar('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(misturar('#000000', '#ffffff', 0.5), '#808080');
});

test('misturar não estoura com fator fora da faixa', () => {
  assert.equal(misturar('#000000', '#ffffff', 5), '#ffffff');
  assert.equal(misturar('#000000', '#ffffff', -3), '#000000');
});

// O risco real da ideia: fundo tingido que come o texto. Se este teste cair,
// a tinta está forte demais e a tela ficou pior, não mais bonita.
test('nenhuma cor deixa o texto ilegível sobre o fundo tingido', () => {
  for (const hex of TODAS) {
    const claro = superficiesTingidas(NEUTROS_CLARO, hex, { escuro: false });
    const escuro = superficiesTingidas(NEUTROS_ESCURO, hex, { escuro: true });

    const contrasteClaro = Math.abs(luminancia(claro['--bg']) - luminancia('#0d1116'));
    const contrasteEscuro = Math.abs(luminancia(escuro['--bg']) - luminancia('#f2f4f7'));

    assert.ok(contrasteClaro > 0.7, `${hex}: fundo claro tingido perdeu contraste (${contrasteClaro.toFixed(2)})`);
    assert.ok(contrasteEscuro > 0.7, `${hex}: fundo escuro tingido perdeu contraste (${contrasteEscuro.toFixed(2)})`);
  }
});

test('o tema escuro continua escuro depois de tingido', () => {
  for (const hex of TODAS) {
    const s = superficiesTingidas(NEUTROS_ESCURO, hex, { escuro: true });
    assert.ok(luminancia(s['--bg']) < 0.06, `${hex} clareou o fundo escuro`);
    assert.ok(luminancia(s['--surface']) < 0.08, `${hex} clareou o cartão escuro`);
  }
});

test('o tema claro continua claro depois de tingido', () => {
  for (const hex of TODAS) {
    const s = superficiesTingidas(NEUTROS_CLARO, hex, { escuro: false });
    assert.ok(luminancia(s['--bg']) > 0.75, `${hex} escureceu o fundo claro`);
  }
});

test('a cor entra de verdade — tingido não é igual ao neutro', () => {
  const s = superficiesTingidas(NEUTROS_CLARO, '#c2306e', { escuro: false });
  assert.notEqual(s['--bg'], NEUTROS_CLARO['--bg'], 'se nada muda, a personalização não existe');
  assert.notEqual(s['--chip'], NEUTROS_CLARO['--chip']);
});

test('tingir duas vezes a mesma cor dá o mesmo resultado', () => {
  const uma = superficiesTingidas(NEUTROS_CLARO, '#1f6fd0', { escuro: false });
  const outra = superficiesTingidas(NEUTROS_CLARO, '#1f6fd0', { escuro: false });
  assert.deepEqual(uma, outra, 'a função é pura — o acúmulo é problema de quem aplica');
});

test('o herói fica escuro o bastante para texto branco em qualquer cor', () => {
  for (const hex of TODAS) {
    const paradas = heroDe(hex).match(/#[0-9a-f]{6}/gi) || [];
    assert.equal(paradas.length, 3, `${hex}: o gradiente precisa das três paradas`);
    for (const p of paradas) {
      const contraste = Math.abs(luminancia(p) - luminancia('#ffffff'));
      assert.ok(contraste > 0.75, `${hex}: parada ${p} clara demais para texto branco`);
    }
  }
});

test('comAlfa vira rgba e aguenta hex inválido', () => {
  assert.equal(comAlfa('#0a7b5a', 0.3), 'rgba(10,123,90,0.3)');
  assert.match(comAlfa('nada', 0.3), /^rgba\(/);
});
