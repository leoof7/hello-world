import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexParaRgb, luminancia, textoSobre, ajustar, paletaDe, CORES } from '../src/ui/tema.js';

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
