import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerNome, lerIdade, lerRenda, lerSaldo, lerFixos, dispensou,
  PASSOS, proximoPasso, quantosFaltam, completo, textoDaPergunta,
} from '../src/core/conversa.js';

// ------------------------------------------------------------------ nome

test('o nome vem limpo, com ou sem rodeio na frente', () => {
  assert.equal(lerNome('Leandro').valor, 'Leandro');
  assert.equal(lerNome('meu nome é Leandro').valor, 'Leandro');
  assert.equal(lerNome('meu nome e Leandro').valor, 'Leandro', 'sem acento também');
  assert.equal(lerNome('me chamo Ana Paula').valor, 'Ana', 'só o primeiro — o app cumprimenta, não emite documento');
  assert.equal(lerNome('sou o João').valor, 'João', 'o artigo não é o nome');
  assert.equal(lerNome('LEANDRO').valor, 'Leandro', 'caixa alta vira nome de gente');
});

test('o que não é nome não vira nome', () => {
  assert.equal(lerNome('123'), null);
  assert.equal(lerNome(''), null);
  assert.equal(lerNome('   '), null);
});

// ----------------------------------------------------------------- idade

test('a idade sai de qualquer jeito de dizer', () => {
  assert.equal(lerIdade('34').valor, 34);
  assert.equal(lerIdade('tenho 34 anos').valor, 34);
  assert.equal(lerIdade('34 anos').valor, 34);
});

test('número que não pode ser idade é recusado', () => {
  assert.equal(lerIdade('200'), null);
  assert.equal(lerIdade('3'), null);
  assert.equal(lerIdade('sei lá'), null);
});

// ----------------------------------------------------------------- renda

test('a renda aceita frase torta, que é como a pessoa fala', () => {
  assert.equal(lerRenda('ganho 4700 por mês').valor, 470000);
  assert.equal(lerRenda('uns quatro mil e setecentos').valor, 470000);
  assert.equal(lerRenda('4.700,00').valor, 470000);
  assert.equal(lerRenda('3 mil').valor, 300000, 'e o "3 mil" que valia R$ 3,00');
});

test('renda sem número nenhum não vira zero silencioso', () => {
  assert.equal(lerRenda('não sei'), null, 'melhor perguntar de novo que gravar zero');
});

// ----------------------------------------------------------------- saldo

test('o saldo aceita o valor e aceita "está zerada"', () => {
  assert.equal(lerSaldo('21,73').valor, 2173);
  assert.equal(lerSaldo('tá zerada').valor, 0);
  assert.equal(lerSaldo('zero').valor, 0);
});

test('conta no vermelho entra negativa, não positiva', () => {
  assert.equal(lerSaldo('to no vermelho em 300').valor, -30000);
});

// ------------------------------------------------------- gastos fixos
//
// A pergunta que mais rende do roteiro: uma frase vira vários registros.

test('uma frase com vírgulas vira vários gastos fixos', () => {
  const r = lerFixos('aluguel 1200, luz 180, internet 120');
  assert.equal(r.valor.length, 3);
  assert.deepEqual(r.valor.map((x) => x.amountCents), [120000, 18000, 12000]);
  assert.deepEqual(r.valor.map((x) => x.label), ['Aluguel', 'Luz', 'Internet']);
});

test('um gasto só também funciona', () => {
  const r = lerFixos('pago 1200 de aluguel');
  assert.equal(r.valor.length, 1);
  assert.equal(r.valor[0].amountCents, 120000);
});

test('"não tenho" é resposta válida, não erro', () => {
  const r = lerFixos('não');
  assert.deepEqual(r.valor, []);
});

test('frase sem valor nenhum pede para repetir em vez de gravar vazio', () => {
  assert.equal(lerFixos('tenho umas contas aí'), null);
});

test('dispensou reconhece as formas de dizer não', () => {
  for (const t of ['não', 'nao', 'nenhum', 'zero', 'ainda não', 'pular', '']) {
    assert.equal(dispensou(t), true, t);
  }
  assert.equal(dispensou('aluguel 1200'), false);
});

// --------------------------------------------------------------- roteiro

test('o roteiro é curto — chat longo é o mesmo formulário, mais devagar', () => {
  assert.ok(PASSOS.length <= 5, `${PASSOS.length} perguntas é demais para um começo`);
});

test('só renda, conta e fixos são obrigatórios', () => {
  const obrigatorios = PASSOS.filter((p) => p.obrigatorio).map((p) => p.id);
  assert.deepEqual(obrigatorios, ['renda', 'conta', 'fixos']);
});

test('todo passo obrigatório explica por que está perguntando', () => {
  for (const p of PASSOS.filter((x) => x.obrigatorio)) {
    assert.ok(p.porQue, `${p.id} pergunta sem dizer para quê`);
  }
});

test('o roteiro anda e sabe quanto falta', () => {
  assert.equal(proximoPasso({}).id, 'nome');
  assert.equal(quantosFaltam({}), PASSOS.length);

  const meio = { nome: 'Leandro', idade: 34 };
  assert.equal(proximoPasso(meio).id, 'renda');
  assert.equal(quantosFaltam(meio), PASSOS.length - 2);
});

test('só está completo quando os três obrigatórios entraram', () => {
  assert.equal(completo({ nome: 'Leandro' }), false);
  assert.equal(completo({ renda: 470000, conta: 2173 }), false);
  assert.equal(completo({ renda: 470000, conta: 2173, fixos: [] }), true,
    'nome e idade são cortesia, não requisito');
});

test('a pergunta usa o nome depois que ele é dito', () => {
  const passo = PASSOS.find((p) => p.id === 'idade');
  assert.match(textoDaPergunta(passo, { nome: 'Leandro' }), /Leandro/);
  assert.doesNotMatch(textoDaPergunta(passo, {}), /undefined/, 'sem nome não vaza undefined na tela');
});

test('quando não há mais passos, não há próximo', () => {
  const tudo = Object.fromEntries(PASSOS.map((p) => [p.id, 'x']));
  assert.equal(proximoPasso(tudo), null);
  assert.equal(quantosFaltam(tudo), 0);
});
