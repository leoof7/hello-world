import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anel, anelDePassos, rosca, barraEmpilhada, termometro } from '../src/ui/graficos.js';

const paths = (svg) => (svg.match(/<path /g) || []).length;
const temNaN = (s) => /NaN|Infinity|undefined/.test(s);

// A regra que vale para todos: um gráfico que imprime NaN no atributo de um
// SVG não quebra a página — ele desenha errado, calado. Por isso todo caso de
// borda passa por aqui.

test('o anel desenha trilho e progresso', () => {
  const cheio = anel({ fracao: 0.5, centro: '50%' });
  assert.equal(paths(cheio), 2, 'trilho mais o arco do progresso');
  assert.ok(!temNaN(cheio));
});

test('anel em zero desenha só o trilho, sem arco vazio', () => {
  assert.equal(paths(anel({ fracao: 0 })), 1);
});

test('o anel não estoura fora da faixa', () => {
  for (const f of [-1, 0, 0.5, 1, 2, NaN]) {
    const svg = anel({ fracao: f });
    assert.ok(!temNaN(svg), `fracao ${f} produziu SVG inválido`);
  }
});

test('anel de passos desenha um trilho por passo', () => {
  const seis = anelDePassos({ feitos: 2, total: 6 });
  // 6 trilhos + 2 preenchidos
  assert.equal(paths(seis), 8);
  assert.ok(!temNaN(seis));
});

test('passo pela metade aparece pela metade', () => {
  const meio = anelDePassos({ feitos: 1.5, total: 6 });
  assert.equal(paths(meio), 6 + 2, 'um cheio e um parcial');
});

test('reserva zerada não desenha preenchimento nenhum', () => {
  assert.equal(paths(anelDePassos({ feitos: 0, total: 6 })), 6);
});

test('a rosca junta o rabo da lista em "outros"', () => {
  const partes = Array.from({ length: 9 }, (_, i) => ({ nome: `C${i}`, cents: 1000 - i * 50 }));
  const svg = rosca({ partes });
  // cinco maiores mais "outros"
  assert.equal(paths(svg), 6, 'doze fatias de 2% não são doze informações, são uma mancha');
  assert.match(svg, /Outros/);
});

test('rosca com poucas fatias não inventa "outros"', () => {
  const svg = rosca({ partes: [{ nome: 'A', cents: 100 }, { nome: 'B', cents: 50 }] });
  assert.equal(paths(svg), 2);
  assert.doesNotMatch(svg, /Outros/);
});

test('rosca sem valor nenhum não desenha nada', () => {
  assert.equal(rosca({ partes: [] }), '');
  assert.equal(rosca({ partes: [{ nome: 'A', cents: 0 }] }), '');
});

test('a barra empilhada marca quando as saídas passam da entrada', () => {
  const cabe = barraEmpilhada({ totalCents: 100000, partes: [{ nome: 'A', cents: 40000, cor: 'red', rotulo: 'R$ 400' }] });
  const estoura = barraEmpilhada({ totalCents: 100000, partes: [{ nome: 'A', cents: 150000, cor: 'red', rotulo: 'R$ 1.500' }] });
  assert.doesNotMatch(cabe, /estourou/);
  assert.match(estoura, /estourou/, 'se as cores enchem a barra, o mês não fecha');
});

test('a sobra aparece só quando existe sobra', () => {
  const comSobra = barraEmpilhada({ totalCents: 100000, sobraTexto: 'R$ 600', partes: [{ nome: 'A', cents: 40000, cor: 'red', rotulo: 'x' }] });
  const semSobra = barraEmpilhada({ totalCents: 100000, partes: [{ nome: 'A', cents: 120000, cor: 'red', rotulo: 'x' }] });
  assert.match(comSobra, /empilha-sobra/);
  assert.doesNotMatch(semSobra, /empilha-sobra/);
});

test('barra sem entrada declarada não divide por zero', () => {
  const svg = barraEmpilhada({ totalCents: 0, partes: [{ nome: 'A', cents: 100, cor: 'red', rotulo: 'x' }] });
  assert.ok(!temNaN(svg));
});

test('o termômetro fica dentro da faixa e aceita a marca', () => {
  for (const f of [-1, 0, 0.5, 1, 3, NaN]) {
    assert.ok(!temNaN(termometro({ fracao: f, marca: 0.5 })), `fracao ${f}`);
  }
  assert.match(termometro({ fracao: 0.5, marca: 0.8 }), /termo-marca/);
  assert.doesNotMatch(termometro({ fracao: 0.5 }), /termo-marca/, 'sem marca, sem risco na tela');
});

test('termômetro em alerta muda de cor', () => {
  assert.match(termometro({ fracao: 0.2, alerta: true }), /var\(--red\)/);
});

test('nome de categoria com HTML não escapa para a tela', () => {
  const svg = rosca({ partes: [{ nome: '<script>x</script>', cents: 100 }] });
  assert.doesNotMatch(svg, /<script>/);
});
