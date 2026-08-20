# Zero — o que o app faz e por quê

## O problema

Um assalariado com fatura de cartão em atraso (rotativo) e cheque especial
aberto. A pergunta que nenhum app respondia direito era simples:

> **quanto eu realmente tenho, considerando o que já está comprometido?**

Os apps de mercado erram isso de duas formas. Ou tratam a compra parcelada como
uma saída única no dia da compra — e a projeção fica pessimista hoje e otimista
nos onze meses seguintes. Ou tratam a fatura como uma saída só no vencimento —
e o orçamento por categoria perde a noção de quando o gasto aconteceu.

**A resposta certa precisa dos dois regimes ao mesmo tempo:**

- **competência** — em que mês o gasto conta para o orçamento
- **caixa** — em que dia o dinheiro sai da conta

Uma parcela de notebook comprada em junho tem competência de agosto (é a
terceira) e caixa de 27 de setembro (vencimento da fatura). São três datas
diferentes para o mesmo lançamento, e todas importam.

## Quem usa

Uma pessoa. Um iPhone. Sem CNPJ, mas com entradas irregulares — trader
esportivo, Pix de serviço por fora. Endividada, tentando sair.

Isso define o que o app **não** é: não é multiusuário, não tem convite, não tem
compartilhamento de carteira, não tem categoria de empresa.

## Prioridades, em ordem

1. Fatura e parcelamento certos na projeção de caixa
2. Plano de saída das dívidas com data e ordem
3. Diagnóstico honesto quando a conta não fecha
4. Registro rápido o bastante para não ser abandonado na segunda semana
5. Não perder os dados

## As telas

### Painel
O número grande é **quanto falta para sair**, não o saldo. Abaixo, a frase do
consultor — uma só, escolhida pelo que está mais urgente hoje: plano inviável,
juros comendo a sobra, caixa que vai furar, categoria acima do ritmo, ou a data
da liberdade.

### Cartões
Contas, cartões, fatura aberta e a que vai vencer, limite usado, e o **muro de
parcelas**: doze barras mostrando quanto de cada mês futuro já está vendido. É
o gráfico que quase nenhum app mostra e que muda decisão de compra.

### Dívidas
Ordem de ataque por juro (avalanche) ou por saldo (bola de neve), a data de
quitação de cada uma, quanto de cada real vai para juros e quanto abate, e a
curva do saldo caindo até zero.

Quando o orçamento não cobre nem os mínimos, o app **diz isso** e mostra os três
caminhos reais — trocar por empréstimo mais barato, cortar fixo, aumentar
entrada — em vez de inventar uma data de liberdade que não vai acontecer.

### Análise
Caixa dia a dia em 90 dias com o primeiro dia negativo marcado. Tetos por
categoria com **marca de ritmo** — a linha que diz onde você deveria estar hoje,
o que transforma a barra de progresso em ferramenta. Caça-vazamentos: assinatura
que subiu de preço em silêncio, cobrança duplicada, recorrência esquecida.
Diagnóstico com quatro indicadores que explicam de onde vieram.

### Tudo
Recebimentos (garantido separado de avulso, de propósito), cofrinhos, gastos
fixos, tetos, patrimônio, projetos de vida, backup, importação, segurança — e
**Como usar**, o guia dentro do app.

### Como usar
Sete passos de configuração com o que já está feito marcado, e as rotinas
separadas por frequência: todo dia, toda semana, todo mês. Cada item diz **onde**
fazer e **quanto tempo leva**. Fica em *Tudo*, abaixo de Projetos de vida.

## Regras de negócio que valem escrever

| Regra | Onde |
|---|---|
| Compra no dia do fechamento vai para a fatura seguinte | `core/statements.js` |
| Vencimento no mesmo mês se `dueDay > closingDay`, senão no seguinte | `core/statements.js` |
| Fechamento dia 31 em fevereiro cai no dia 28 (ou 29) | `core/dates.js` |
| O resto da divisão vai na **primeira** parcela | `core/money.js` |
| Cada parcela tem competência, ciclo e vencimento próprios | `core/installments.js` |
| Antecipar parcela economiza zero | `core/installments.js` |
| Ordem de quitação segue o juro, não o saldo | `core/debts.js` |
| Parcelamento nunca disputa a fila de quitação | `core/debts.js` |
| Mínimo de cartão é percentual do saldo e encolhe com ele | `core/debts.js` |
| "Livre até dia 5" exclui a entrada do dia 5 | `core/projection.js` |
| Custo de vida mínimo ignora o mês corrente, que está incompleto | `core/health.js` |
| Quando não sabe a categoria, pergunta em vez de chutar | `core/categorize.js` |
| Dinheiro é centavo inteiro, sempre | `core/money.js` |

## Entradas irregulares

Trader esportivo e Pix de serviço por fora entram marcados como
`extraordinary`. Ficam **fora** da renda que a projeção usa como garantida, e
aparecem como média histórica separada.

O motivo está escrito na própria tela: se o orçamento depende do avulso, um mês
fraco vira dívida nova.

## O que ficaria para uma etapa 2

- Atalho da Siri lançando direto no app (exige Shortcuts com URL scheme)
- Reconhecimento de voz — `SpeechRecognition` não existe no Safari do iOS; hoje
  o campo "Falar gasto" aceita a frase em linguagem natural digitada, e o
  parser em `core/parse.js` já entende "gastei 85 no mercado ontem"
- Projeto de vida somando categorias no relatório (a estrutura já existe)
- Cofre cego para sincronizar entre aparelhos (`MODO = 'produto'`)
