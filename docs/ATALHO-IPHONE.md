# Lançar o dia inteiro com um toque

O Zero lê print de notificação de banco. Este documento é a parte que mora
fora do app: um Atalho do iPhone que junta os prints do dia, extrai o texto e
deixa tudo copiado. Depois é abrir o Zero, tocar em **Print**, conferir a
lista e confirmar.

Um toque por dia, para o dia inteiro.

## Por que a área de transferência, e não um link

Um Atalho consegue abrir um endereço. Aqui isso seria o caminho errado.

No iPhone, um app adicionado à Tela de Início tem armazenamento **separado do
Safari**. Abrir `https://…/hello-world/` por um Atalho abriria o Safari, e o
lançamento cairia num cofre diferente do que você usa — mesma tela, dados que
nunca se encontram. Já a área de transferência é do sistema: o Atalho copia,
você cola dentro do app instalado, e o dado entra no cofre certo.

Sai de graça um ganho: o **OCR é o da Apple**, que é melhor que o embutido no
app, roda no aparelho e não custa download nenhum. O leitor de imagem do Zero
continua existindo para quem não quer configurar nada.

## O Atalho

Abra o app **Atalhos** → **+** → dê o nome de "Lançar no Zero" e monte:

| # | Ação | Como configurar |
|---|------|-----------------|
| 1 | **Buscar Fotos** | Filtro: `Álbum` é `Capturas de Tela`. Adicione um segundo filtro: `Data de Criação` `é hoje`. Ordenar por `Data de Criação`, crescente. |
| 2 | **Extrair Texto da Imagem** | Entrada: `Fotos` (o resultado do passo 1). |
| 3 | **Combinar Texto** | Entrada: `Texto`. Separador: **Novas Linhas**. |
| 4 | **Copiar para a Área de Transferência** | Entrada: `Texto Combinado`. |
| 5 | **Mostrar Notificação** | Texto: `Prints do dia prontos — abra o Zero e toque em Print`. |

Pronto. Rode uma vez à mão para conferir.

### Opcional: apagar os prints depois de ler

Acrescente no fim:

| # | Ação | Como configurar |
|---|------|-----------------|
| 6 | **Apagar Fotos** | Entrada: `Fotos` (o passo 1). Marque `Não Perguntar`, senão ele pede confirmação toda vez. |

Isso evita a fototeca virar um álbum de extrato. As fotos vão para "Apagadas
Recentemente" e ficam 30 dias lá, então dá para voltar atrás.

## Os gatilhos — do mais automático ao menos

### Todo dia, sem tocar em nada

**Atalhos** → aba **Automação** → **+** → **Hora do Dia** → escolha 22:00 →
**Executar Imediatamente** (importante: sem isso ele só manda um aviso pedindo
para você tocar).

Às 22 h o texto do dia já está copiado. Você abre o Zero quando quiser.

> A área de transferência do iPhone guarda só a última coisa copiada. Se você
> copiar outra coisa depois das 22 h, é só rodar o Atalho de novo à mão.

### Batendo duas vezes atrás do telefone

**Ajustes** → **Acessibilidade** → **Toque** → role até o fim → **Toque nas
Costas** → **Toque Duplo** → escolha "Lançar no Zero".

Tirou o print, bateu duas vezes atrás, abriu o Zero. Funciona com o telefone
bloqueado.

### No Botão de Ação (iPhone 15 Pro ou mais novo)

**Ajustes** → **Botão de Ação** → deslize até **Atalho** → escolha o seu.

### Na folha de compartilhamento

No próprio Atalho, toque em **ⓘ** (Detalhes) → ligue **Mostrar na Folha de
Compartilhamento** → em Tipos de Entrada deixe só **Imagens**.

Aí o caminho vira: tirou o print → toca na miniatura do canto → **Compartilhar**
→ **Lançar no Zero**. Serve também para print que chegou pelo WhatsApp.

Nesse formato, troque o passo 1 por **Obter Imagens da Entrada** e ligue
"Receber Imagens da folha de compartilhamento".

### Pela Siri

Funciona sem configurar nada: "E aí Siri, Lançar no Zero" — o nome do Atalho
é o comando.

### Outros gatilhos que valem

- **Chegar em Casa** — automação por localização
- **Antes de Dormir** — encaixa no horário que você já definiu no Saúde
- **Ao carregar** — quando põe o telefone no carregador da noite
- **Etiqueta NFC** — colada na carteira, encosta o telefone quando paga

## No Android é mais direto

Não precisa de atalho nenhum: o Zero se registra como destino de
compartilhamento. Tira o print → **Compartilhar** → **Zero**. O app abre já
lendo a imagem.

Para isso o Zero precisa estar instalado (menu do navegador → "Instalar app"
ou "Adicionar à tela inicial").

## Fazendo o app reconhecer o cartão sozinho

Quase toda notificação de compra diz "final 4321". Cadastre esses quatro
dígitos em cada cartão — **Finanças** → toque no cartão → **Quatro últimos
dígitos** — e o lançamento vai para o cartão certo sem você escolher nada.

## O que esperar da leitura

- **Vem marcado** o que o app entendeu com folga: título de notificação
  reconhecido, valor, estabelecimento, cartão.
- **Vem desmarcado** o que ele não tem certeza, e o que parece já lançado —
  a mesma compra chega pela notificação hoje e pelo extrato no fim do mês.
- **A data é hoje.** Print de notificação quase nunca traz o dia; traz "há
  2 h". Corrija no lançamento se for de ontem.
- **A categoria fica vazia** e cai na fila de **Revisão**. O app aprende com o
  que você classifica, então chutar categoria aqui faria ele errar sozinho
  depois.
