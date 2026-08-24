import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linhasDeNotificacao, valorDaLinha, finalDoCartao, direcaoDaLinha,
  parcelasDaLinha, estabelecimentoDaLinha, lancamentosDoPrint, jaExiste,
} from '../src/core/notificacao.js';

const HOJE = '2026-08-24';

// Um print de central de notificações do jeito que ele sai do OCR: com o
// relógio, a data, o nome do app repetido e a barra de "limpar tudo".
const PRINT = `9:41
Seg, 24 de agosto
Nubank
Compra aprovada
R$ 45,90 em PADARIA CENTRAL LTDA · há 2 h
Nubank
Compra aprovada no cartão final 4321
R$ 189,00 em MAGAZINE LUIZA em 3x
Itaú
Pix enviado
Você enviou R$ 50,00 para João Silva
Nubank
Pix recebido
Você recebeu R$ 1.200,00 de EMPRESA XPTO
Central de Notificações
Limpar tudo`;

// ------------------------------------------------------ o valor

test('o valor sai com centavos e com separador de milhar', () => {
  assert.equal(valorDaLinha('R$ 45,90 em PADARIA'), 4590);
  assert.equal(valorDaLinha('Você recebeu R$ 1.200,00'), 120000);
  assert.equal(valorDaLinha('R$ 12.345,67 em ALGO'), 1234567);
});

// O erro que faria o app inventar dinheiro: ler o número do cartão como preço.
test('número solto não vira valor — "final 1234" não são mil e duzentos reais', () => {
  assert.equal(valorDaLinha('Compra aprovada no cartão final 1234'), null);
  assert.equal(valorDaLinha('Nubank'), null);
  assert.equal(valorDaLinha('9:41'), null);
});

test('valor zerado não vira lançamento', () => {
  assert.equal(valorDaLinha('R$ 0,00 em ALGO'), null);
});

// ------------------------------------------------------ o ruído

test('relógio, data e barra do sistema não viram lançamento', () => {
  const linhas = linhasDeNotificacao(PRINT);
  const juntas = linhas.join(' | ');
  assert.ok(!/9:41/.test(juntas), `o relógio passou: ${juntas}`);
  assert.ok(!/Limpar tudo/.test(juntas));
  assert.ok(!/Central de Notifica/.test(juntas));
});

test('o título gruda no corpo, senão metade da notificação se perde', () => {
  const linhas = linhasDeNotificacao('Compra aprovada\nR$ 45,90 em PADARIA');
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /Compra aprovada/);
  assert.match(linhas[0], /PADARIA/);
});

// ------------------------------------------------------ entrada ou saída

test('compra e pix enviado são saída', () => {
  assert.equal(direcaoDaLinha('Compra aprovada R$ 45,90 em PADARIA'), 'out');
  assert.equal(direcaoDaLinha('Pix enviado Você enviou R$ 50,00 para João'), 'out');
  assert.equal(direcaoDaLinha('Pagamento de conta realizado R$ 90,00'), 'out');
});

test('pix recebido e estorno são entrada', () => {
  assert.equal(direcaoDaLinha('Pix recebido Você recebeu R$ 1.200,00'), 'in');
  assert.equal(direcaoDaLinha('Estorno de R$ 30,00'), 'in');
  assert.equal(direcaoDaLinha('Transferência recebida R$ 200,00'), 'in');
});

// "Pix enviado" contém "pix". Se o padrão genérico viesse antes, todo Pix
// enviado viraria dinheiro entrando — e o app diria que o mês está sobrando.
test('"pix enviado" não é lido como pix recebido', () => {
  assert.equal(direcaoDaLinha('Pix enviado R$ 50,00'), 'out');
});

test('na dúvida é saída, que é o que notificação de banco quase sempre é', () => {
  assert.equal(direcaoDaLinha('Alguma coisa R$ 10,00'), 'out');
});

// ------------------------------------------------------ o final do cartão

test('os quatro dígitos finais são achados em vários jeitos de escrever', () => {
  assert.equal(finalDoCartao('no cartão final 4321'), '4321');
  assert.equal(finalDoCartao('cartão com final 1234'), '1234');
  assert.equal(finalDoCartao('cartão terminado em 9876'), '9876');
  assert.equal(finalDoCartao('R$ 45,90 em PADARIA'), null);
});

test('e levam o gasto para o cartão certo sozinhos', () => {
  const r = lancamentosDoPrint('Compra aprovada no cartão final 4321\nR$ 189,00 em LOJA', {
    cards: [{ id: 'c1', name: 'Nu', last4: '1111' }, { id: 'c2', name: 'Itaú', last4: '4321' }],
    todayISO: HOJE,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].cardId, 'c2', 'foi para o cartão dos quatro dígitos, não para o primeiro da lista');
});

// ------------------------------------------------------ o estabelecimento

test('o nome do lugar sai de depois do "em"', () => {
  assert.equal(estabelecimentoDaLinha('R$ 45,90 em PADARIA CENTRAL LTDA'), 'Padaria Central');
  assert.equal(estabelecimentoDaLinha('Você enviou R$ 50,00 para João Silva'), 'João Silva');
});

test('caixa alta vira nome de gente, porque lista inteira gritando não se lê', () => {
  assert.equal(estabelecimentoDaLinha('R$ 10,00 em MERCADO DO ZE'), 'Mercado do Ze');
});

test('sem nome de lugar devolve nada, em vez de chutar', () => {
  // Chute vira descrição errada, e o categorizador aprende com a descrição —
  // um chute hoje é uma categoria errada em todas as próximas.
  assert.equal(estabelecimentoDaLinha('R$ 45,90'), null);
  assert.equal(estabelecimentoDaLinha('Compra aprovada no seu cartão'), null);
});

test('sobra de horário e de final do cartão não entra no nome', () => {
  assert.equal(estabelecimentoDaLinha('R$ 45,90 em PADARIA CENTRAL · há 2 h'), 'Padaria Central');
  assert.equal(estabelecimentoDaLinha('R$ 20,00 em BAR DO JOAO final 1234'), 'Bar do Joao');
});

// ------------------------------------------------------ parcelas

test('"em 3x" vira três parcelas', () => {
  assert.equal(parcelasDaLinha('R$ 189,00 em LOJA em 3x'), 3);
  assert.equal(parcelasDaLinha('R$ 189,00 em 12 parcelas'), 12);
  assert.equal(parcelasDaLinha('R$ 45,90 em PADARIA'), 1);
});

test('número absurdo de parcelas não passa', () => {
  assert.equal(parcelasDaLinha('R$ 10,00 em 900x'), 1);
});

// ------------------------------------------------------ o print inteiro

test('um print vira todos os lançamentos dele, com os sinais certos', () => {
  const r = lancamentosDoPrint(PRINT, {
    cards: [{ id: 'c1', name: 'Nubank', last4: '4321' }],
    todayISO: HOJE,
  });

  assert.equal(r.length, 4, `veio ${r.length}: ${r.map((x) => x.amountCents).join(', ')}`);
  assert.deepEqual(r.map((x) => x.amountCents), [-4590, -18900, -5000, 120000]);
  assert.equal(r[1].cardId, 'c1');
  assert.equal(r[1].installments, 3);
  assert.equal(r[3].description, 'Empresa Xpto');
  assert.ok(r.every((x) => x.date === HOJE), 'a data é hoje — o print não traz o dia');
});

test('a confiança sobe com o que o app conseguiu isolar sozinho', () => {
  const [completo] = lancamentosDoPrint('Compra aprovada no cartão final 4321\nR$ 189,00 em LOJA BOA', {
    cards: [{ id: 'c1', last4: '4321' }], todayISO: HOJE,
  });
  const [solto] = lancamentosDoPrint('R$ 189,00', { todayISO: HOJE });
  assert.ok(completo.confianca > solto.confianca);
  assert.ok(completo.confianca > 0.6, 'esse já pode vir marcado');
  assert.ok(solto.confianca < 0.6, 'esse pede olho humano');
});

test('print sem nada de dinheiro não devolve lançamento nenhum', () => {
  assert.deepEqual(lancamentosDoPrint('Instagram\nfulano curtiu sua foto', { todayISO: HOJE }), []);
});

// ------------------------------------------------------ duplicata

test('o mesmo gasto duas vezes é reconhecido', () => {
  const candidato = { amountCents: -4590, date: '2026-08-24' };
  const jaLancados = [{ id: 't1', amountCents: -4590, date: '2026-08-23' }];
  assert.ok(jaExiste(candidato, jaLancados), 'a notificação chega no dia, o extrato no dia seguinte');
});

test('valor diferente não é duplicata', () => {
  assert.ok(!jaExiste({ amountCents: -4590, date: '2026-08-24' },
    [{ amountCents: -4591, date: '2026-08-24' }]));
});

test('mesmo valor em mês diferente não é duplicata — é a assinatura de novo', () => {
  assert.ok(!jaExiste({ amountCents: -2990, date: '2026-08-24' },
    [{ amountCents: -2990, date: '2026-07-24' }]));
});

test('entrada não é confundida com saída do mesmo tamanho', () => {
  assert.ok(!jaExiste({ amountCents: 5000, date: '2026-08-24' },
    [{ amountCents: -5000, date: '2026-08-24' }]));
});
