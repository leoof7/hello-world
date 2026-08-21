import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfilPorComportamento, perfilPorQuiz, perfilAtual, FASES } from '../src/core/perfil.js';

test('juro comendo a renda é incêndio, mesmo com alguma reserva', () => {
  const r = perfilPorComportamento({
    dividaTotalCents: 1000000, jurosMesCents: 50000, rendaMensalCents: 500000,
    reservaMeses: 2, mesesDeHistorico: 3,
  });
  assert.equal(r.fase.id, 'incendio', '10% da renda em juros manda em tudo');
  assert.match(r.motivo, /10%/);
});

test('dívida pequena sem reserva é aperto, não incêndio', () => {
  const r = perfilPorComportamento({
    dividaTotalCents: 50000, jurosMesCents: 1000, rendaMensalCents: 500000,
    reservaMeses: 0, mesesDeHistorico: 3,
  });
  assert.equal(r.fase.id, 'aperto');
});

test('sem dívida mas sem reserva ainda é aperto', () => {
  const r = perfilPorComportamento({ rendaMensalCents: 500000, reservaMeses: 0.5, mesesDeHistorico: 3 });
  assert.equal(r.fase.id, 'aperto');
});

test('reserva de três meses sem juro caro é construindo', () => {
  const r = perfilPorComportamento({
    dividaTotalCents: 0, jurosMesCents: 0, rendaMensalCents: 500000,
    reservaMeses: 4, mesesDeHistorico: 6,
  });
  assert.equal(r.fase.id, 'construindo');
});

test('sem dívida e com seis meses é livre', () => {
  const r = perfilPorComportamento({
    dividaTotalCents: 0, rendaMensalCents: 500000, reservaMeses: 6, mesesDeHistorico: 6,
  });
  assert.equal(r.fase.id, 'livre');
});

test('entre um e três meses de reserva é respirando', () => {
  const r = perfilPorComportamento({
    dividaTotalCents: 0, rendaMensalCents: 500000, reservaMeses: 2,
    sobraCents: 50000, mesesDeHistorico: 3,
  });
  assert.equal(r.fase.id, 'respirando');
});

test('sem número nenhum, o app admite que não conhece a pessoa', () => {
  const r = perfilPorComportamento({});
  assert.equal(r.fase, null);
  assert.equal(r.confianca, 0);
});

test('a confiança cresce com o histórico', () => {
  const base = { dividaTotalCents: 0, rendaMensalCents: 500000, reservaMeses: 2 };
  assert.equal(perfilPorComportamento({ ...base, mesesDeHistorico: 0 }).confianca, 0.3);
  assert.equal(perfilPorComportamento({ ...base, mesesDeHistorico: 1 }).confianca, 0.6);
  assert.equal(perfilPorComportamento({ ...base, mesesDeHistorico: 6 }).confianca, 1);
});

// ------------------------------------------------------------------- o quiz

test('o quiz devolve a fase mais apertada que as respostas indicam', () => {
  const r = perfilPorQuiz({ divida: 'muita', reserva: 'muito', sobra: 'sobra' });
  assert.equal(r.fase.id, 'incendio', 'dívida que aperta manda, mesmo com o resto bom');
});

test('quiz todo positivo cai em construindo', () => {
  const r = perfilPorQuiz({ divida: 'nenhuma', reserva: 'muito', sobra: 'sobra' });
  assert.equal(r.fase.id, 'respirando', 'a mais apertada das três respostas');
});

test('quiz não respondido não inventa fase', () => {
  assert.equal(perfilPorQuiz({}).fase, null);
});

test('o quiz nunca tem a confiança de um dado real', () => {
  const quiz = perfilPorQuiz({ divida: 'nenhuma', reserva: 'muito', sobra: 'sobra' });
  const real = perfilPorComportamento({ dividaTotalCents: 0, rendaMensalCents: 500000, reservaMeses: 6, mesesDeHistorico: 6 });
  assert.ok(quiz.confianca < real.confianca, 'o que você faz vale mais que o que você diz');
});

// ------------------------------------------------------------- qual prevalece

test('comportamento substitui o quiz assim que existe dado', () => {
  const r = perfilAtual({
    comportamento: { dividaTotalCents: 0, rendaMensalCents: 500000, reservaMeses: 6, mesesDeHistorico: 6 },
    quizRespostas: { divida: 'muita', reserva: 'nada', sobra: 'falta' },
  });
  assert.equal(r.fase.id, 'livre', 'o quiz dizia incêndio; os números dizem livre');
  assert.equal(r.origem, 'comportamento');
});

test('sem comportamento, o quiz cobre o vazio', () => {
  const r = perfilAtual({ comportamento: {}, quizRespostas: { divida: 'muita' } });
  assert.equal(r.fase.id, 'incendio');
  assert.equal(r.origem, 'quiz');
});

test('sem nada, nem quiz nem comportamento, não há rótulo', () => {
  assert.equal(perfilAtual({}).fase, null);
});

test('toda fase tem foco — rótulo sem próximo passo é enfeite', () => {
  for (const fase of Object.values(FASES)) {
    assert.ok(fase.foco && fase.foco.length > 10, `${fase.id} precisa dizer o que fazer`);
    assert.ok(fase.cor, `${fase.id} precisa de cor`);
  }
});
