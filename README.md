# Zero

Gestor financeiro pessoal que roda inteiro no seu iPhone. Sem servidor, sem
conta, sem mensalidade — e por isso mesmo, sem ninguém para recuperar os seus
dados no seu lugar.

Foi feito para um problema específico: **fatura de cartão e parcelamento
aparecerem certos na projeção de caixa**, e uma seção a mais para sair do
rotativo e do cheque especial.

---

## Instalar na tela inicial não é opcional

O Safari do iOS apaga os dados de sites que você não instalou depois de **sete
dias sem uso**. Um app instalado na tela inicial é isento dessa regra.

No iPhone: abra o endereço no **Safari** (não no Chrome), toque em
**Compartilhar** → **Adicionar à Tela de Início**.

Enquanto você não fizer isso, considere que os seus dados podem sumir. O app
avisa sobre isso em *Tudo → Segurança e espaço*.

---

## Publicar no GitHub Pages

1. No repositório: **Settings → Pages**
2. *Source*: **Deploy from a branch**
3. *Branch*: `claude/financial-app-improvements-3dd0r0`, pasta `/ (root)`
4. Salve e espere um ou dois minutos

O endereço sai como `https://<usuario>.github.io/<repositorio>/`.

**Sobre o domínio:** a passkey do Face ID é amarrada ao domínio (`rpId`). Se
você trocar de endereço depois, a credencial antiga não vale mais e você
recupera pelas doze palavras. Nada se perde, mas é um passo extra — escolha o
endereço definitivo antes de começar a digitar dados de verdade.

---

## Como abrir e como recuperar

Na primeira vez o app entrega **doze palavras**. Escreva no papel. Foto na
galeria não conta.

- **Face ID** destranca no dia a dia. No iOS 18+ com Safari 18+, a passkey não é
  só a tranca: ela deriva a chave que cifra o banco (extensão PRF do WebAuthn).
- **As doze palavras** abrem o arquivo de backup em **qualquer** aparelho. Elas
  são a única recuperação que existe — não há servidor, não há "esqueci a
  senha", não há suporte.
- Sem Face ID disponível, o app cai para **senha** derivada com PBKDF2-SHA256,
  600 mil iterações.

O banco inteiro é um único documento cifrado com **AES-256-GCM**. Documento
único, e não registro a registro, porque índice de IndexedDB é texto puro — com
registros separados, valor, data e nome do estabelecimento ficariam legíveis
para quem abrisse as ferramentas de desenvolvedor.

---

## Backup

Um site não grava arquivo no seu disco sozinho — é regra de segurança do
navegador, não limitação do app. No iPhone o caminho é: o app prepara o arquivo
e você confirma na folha de compartilhamento, salvando no iCloud Drive.

Por isso o backup semanal aqui é **agendado e assistido**, não automático. O app
cobra na hora certa (*Tudo → Fazer backup agora*) e deixa tudo pronto; você
confirma em dois toques. O arquivo `.zbk` é cifrado com as **doze palavras**, não
com o Face ID — um backup que só abre no aparelho que o gerou não é backup.

---

## O que tem dentro

| Tela | Para quê |
|---|---|
| **Painel** | o resumo do dia; o número grande é quanto falta para sair |
| **Cartões** | contas, cartões, fatura aberta, muro de parcelas |
| **Dívidas** | a ordem certa de pagar e a data em que você fica livre |
| **Análise** | caixa em 90 dias, tetos com marca de ritmo, vazamentos, diagnóstico |
| **Tudo** | recebimentos, cofrinhos, projetos, backup, **Como usar** |

Decisões de cálculo que valem saber:

- **Compra no dia do fechamento cai na fatura seguinte.** É onde quase todo app
  brasileiro erra.
- **Parcela não é compra.** R$ 1.200 em 12x são doze saídas de R$ 100 em doze
  faturas, cada uma com sua competência de orçamento.
- **O resto da divisão vai na primeira parcela** (R$ 100 em 3x = 33,34 + 33,33 +
  33,33), como fazem os emissores brasileiros.
- **A ordem de pagamento segue o juro, não o saldo.** Rotativo a 14,9% ao mês
  custa quase o dobro do cheque especial a 8%, ainda que o saldo do cheque
  pareça mais assustador.
- **Antecipar parcela não economiza nada** — o juro já está embutido no valor.
- **Dinheiro é sempre centavo inteiro.** Nunca ponto flutuante.
- **Quando o app não sabe a categoria, ele pergunta** em vez de chutar.

---

## Rodar e testar

```bash
npm test          # 122 testes de cálculo, node --test, sem dependência nenhuma
npm run serve     # http://localhost:8000
```

Não há passo de build, não há `node_modules`, não há framework. O que está no
repositório é exatamente o que roda no navegador.

Há ainda uma verificação no navegador que cobre o que `node --test` não alcança
— IndexedDB, WebCrypto, o ciclo de backup e as nove telas numa viewport de
iPhone, nos dois temas. Ela precisa do Playwright instalado e do servidor no ar,
por isso fica fora do `npm test`:

```bash
npm run serve            # num terminal
npm run test:browser     # noutro
```

## Estrutura

```
index.html · app.css · manifest.webmanifest · sw.js · icon.svg
src/config.js                 MODO 'pessoal' | 'produto'
src/core/                     cálculo puro e testado, sem DOM
  money dates statements installments projection
  debts budget categorize leaks health parse
src/data/                     db crypto recovery migrations backup
src/io/                       csv ofx ics
src/seed/                     categorias, comércios BR e cenário de exemplo
src/ui/                       app state screens actions dom
test/                         *.test.js
```

`src/config.js` tem `MODO = 'pessoal' | 'produto'`. O código é o mesmo; o que
muda é o que fica ligado. Cofre na nuvem e licença estão desligados hoje, mas o
encaixe já existe para o dia em que a decisão for tomada — ver
[docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Privacidade

Nenhum dado sai deste aparelho. Não há analytics, não há telemetria, não há
chamada de rede além das fontes do Google no primeiro carregamento (depois
ficam no cache do service worker e o app abre offline).
