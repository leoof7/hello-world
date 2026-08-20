# Arquitetura

Documento de decisões. Cada seção diz o que foi escolhido, contra o quê, e o
que custa. Onde uma decisão tem um custo real, ele está escrito — inclusive
quando é desconfortável.

---

## 1. Sem servidor

O app roda inteiro no navegador do aparelho. IndexedDB guarda, WebCrypto cifra,
o service worker serve os arquivos.

**Contra o quê:** um backend com login e sincronização.

**O que se ganha:** custo zero, privacidade absoluta (não existe base de dados
para vazar), nada para manter, funciona offline.

**O que se perde:**

- **Sincronizar entre aparelhos é impossível.** Não existe meio-termo. O que
  existe é restaurar um backup no outro aparelho — o que serve para trocar de
  celular, não para usar dois ao mesmo tempo.
- **Não existe "esqueci a senha".** Sem servidor não há quem valide a sua
  identidade e devolva o acesso. As doze palavras são a recuperação inteira.
- **Notificação empurrada é limitada no iOS.** O caminho confiável é exportar
  os vencimentos para o Calendário (`src/io/ics.js`), que tem alarme nativo.

---

## 2. O iOS apaga dados de sites

Regra do WebKit: dados graváveis por script (IndexedDB, localStorage, caches)
são apagados após **sete dias** sem uso do site. **Web apps instalados na tela
inicial são isentos.**

Consequência de projeto: **instalar não é sugestão, é requisito.** O README abre
com isso, a tela de segurança mostra se está instalado ou não, e o app pede
`navigator.storage.persist()` como segunda linha de defesa.

Não dá para contornar isso por código. O que dá é ser honesto e insistente.

---

## 3. Face ID é a chave, não a tranca

```
WebAuthn + extensão PRF  →  segredo de 32 bytes  →  HKDF  →  AES-256-GCM
```

A diferença importa: um app que só usa biometria como *gate* guarda os dados em
claro e confia no `if`. Aqui o segredo que o autenticador devolve é o material
da chave — sem o Face ID, o arquivo é ruído.

Requer Safari 18+ / iOS 18+. Os caminhos alternativos:

| Situação | O que acontece |
|---|---|
| PRF disponível | chave vem da passkey · `unlockMethod: 'passkey'` |
| Passkey sem PRF | Face ID destranca, a chave vem das doze palavras · `'passkey-frase'` |
| Sem biometria | senha com PBKDF2-SHA256, 600 mil iterações · `'senha'` |

**Sobre Argon2id:** o plano original pedia Argon2id, que resiste melhor a ataque
com GPU. Argon2 exige biblioteca externa e este app não tem dependências, então
usamos PBKDF2 nativo com o número de iterações que a OWASP recomenda. Para um
arquivo que já está no aparelho do dono, é adequado — mas é uma escolha
consciente, não um esquecimento.

---

## 4. Documento único cifrado

O banco inteiro é **um** registro cifrado, não registros cifrados um a um.

**Por quê:** índice de IndexedDB é texto puro. Com transações guardadas como
registros indexáveis, valor, data e estabelecimento ficariam legíveis nas
ferramentas de desenvolvedor, e a criptografia viraria enfeite.

**O que custa:** carregar tudo na memória. Para uso pessoal é irrelevante — dez
anos de lançamentos dão poucos megabytes.

O registro `meta` fica em texto puro **de propósito**: guarda o sal e o
identificador da passkey, necessários *antes* de conseguir decifrar qualquer
coisa. Nenhum dos dois é segredo.

---

## 5. Doze palavras

256 palavras portuguesas sem acento, 12 sorteadas → **96 bits de entropia**.

Menos que os 128 bits do padrão BIP-39 (2048 palavras). A troca é deliberada:
uma lista pequena de palavras curtas e sem acento é muito mais fácil de copiar
no papel sem erro, e 96 bits estão muito além de qualquer ataque prático contra
um arquivo que ninguém tem. Está documentado em `src/data/recovery.js` para que
a escolha não pareça descuido.

A confirmação pede **três palavras sorteadas**. É chato de propósito: quem não
anotou descobre agora, e não daqui a seis meses com o celular perdido.

---

## 6. Migrações

Duas regras que não se quebram:

1. migração nunca apaga, só transforma;
2. antes de aplicar qualquer uma, `db.js` grava a versão anterior.

Documento vindo de uma versão **mais nova** do app não é adivinhado — é
recusado com uma mensagem que manda atualizar. É metade dos apps pequenos que
perde os dados dos usuários na terceira atualização.

---

## 7. Sem framework, sem build

Sem React, sem bundler, sem `node_modules`. Cada tela devolve HTML como string
e o render troca o conteúdo de uma vez.

**Por quê:** o que está no repositório é exatamente o que roda no navegador —
não há etapa entre escrever e publicar, e não há dependência para auditar ou
atualizar. Num app deste tamanho, trocar `innerHTML` de uma tela é mais rápido
que reconciliar uma árvore virtual.

**O que custa:** tudo que entra em HTML precisa passar por `esc()`. É a
disciplina que substitui a proteção que um framework daria de graça.

**Onde isso deixa de valer:** se o app crescer para várias telas com estado
próprio e animação entre elas, o custo se inverte. Não é o caso hoje.

---

## 8. Camadas

```
src/core/    cálculo puro — sem DOM, sem IndexedDB, 100% testável
src/data/    persistência e criptografia
src/io/      formatos de fora (CSV, OFX, ICS)
src/ui/      state.js deriva · screens.js desenha · actions.js muda
```

A regra que segura tudo: **as telas não calculam.** `state.js/derive()` recebe o
documento e devolve um objeto com tudo já pronto; `screens.js` só formata. Por
isso os testes cobrem o que aparece na tela sem precisar abrir navegador.

---

## 9. `MODO = 'pessoal' | 'produto'`

`src/config.js` tem a chave que decide o que fica ligado:

```js
export const FEATURES = {
  faceId: true, backupLocal: true, importarExtrato: true,
  cofreNuvem: MODO === 'produto',
  licenca:    MODO === 'produto',
};
```

Se um dia o app virar produto, o que muda:

**Cofre cego (sincronização de verdade).** Um Worker que guarda blocos cifrados
sem nunca ver a chave. O servidor armazena bytes opacos; a chave continua
derivada da passkey ou das doze palavras no aparelho. Custa poucos dólares por
mês em Cloudflare Workers + R2 e não cria responsabilidade sobre dados
pessoais, porque não há dado pessoal legível para vazar. `COFRE.endpoint` já
está no config esperando.

**Licença.** Vale dizer com todas as letras: **licença não impede cópia.** Um
app que roda no navegador tem o código na máquina de quem abriu. O que a
licença faz é organizar quem pagou, permitir suporte e atualização, e criar
atrito honesto — não proteção técnica. Quem quiser copiar, copia. O que segura
um produto assim é atualização contínua e confiança, não DRM.

**Onde publicar com custo mínimo:** GitHub Pages (grátis) ou Cloudflare Pages
(grátis). App Store exige empacotar em Capacitor, US$ 99/ano e revisão —
só vale quando houver receita para justificar.

---

## 10. O que ficou de fora, e por quê

| Do PDF original | Decisão |
|---|---|
| Open Finance | exige instituição autorizada pelo BC. Inviável para um app pessoal. O caminho é importar CSV/OFX, que dá 90% do valor e custa zero |
| OCR de nota fiscal | alto custo de acerto, baixo retorno: quem fotografa a nota também consegue lançar em 5 segundos |
| Multi-agente de IA | caro por chamada, imprevisível com dinheiro, e resolve por LLM o que regra determinística resolve melhor — categorização e detecção de vazamento aqui são 100% determinísticas e custam zero |
| Bot de WhatsApp | exige servidor e número aprovado pela Meta. Contraria a decisão nº 1 |
| Score de 0 a 100 | colide com score de crédito no Brasil e não ensina nada. Trocado por quatro indicadores que dizem de onde vieram |
