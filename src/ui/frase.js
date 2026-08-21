// Copiar, salvar e colar as doze palavras.
//
// Este arquivo existe porque as duas pontas do backup ficam em módulos
// diferentes — a criação do cofre em app.js, a restauração em actions.js — e
// as duas precisam exatamente dos mesmos botões. Duplicar isso seria garantir
// que um dia só um dos lados aceitasse o texto colado.
//
// Sobre a segurança: papel continua sendo o melhor lugar, e a tela continua
// dizendo isso. Mas a pessoa que não anota nada porque digitar doze palavras
// é chato fica com zero backup — o que é pior do que um arquivo mal guardado.
// O botão de copiar existe para o gerenciador de senhas, que é cifrado; o de
// salvar existe para quem vai jogar no Arquivos mesmo, e avisa o que está
// fazendo.

import { limparFrase, fraseParaTexto } from '../data/recovery.js';
import { icon, toast, copiar, colar, entregar } from './dom.js';

/** O arquivo que a pessoa salva: as palavras e o mínimo para entender o que são. */
export function textoDoArquivo(palavras) {
  return [
    'Zero — frase de recuperação',
    '',
    fraseParaTexto(palavras),
    '',
    'Estas doze palavras abrem o seu arquivo de backup em qualquer aparelho.',
    'Quem tiver as duas coisas — este texto e o backup — tem os seus dados.',
    'Guarde em um cofre de senhas ou no papel. Não mande por mensagem.',
    '',
  ].join('\n');
}

/** Os dois botões que aparecem junto das palavras recém-criadas. */
export function botoesDaFrase() {
  return `<button class="btn ghost" data-frase="copiar">${icon('copiar')} Copiar as doze</button>
          <button class="btn ghost" data-frase="salvar">${icon('download')} Salvar arquivo</button>`;
}

/** Liga os botões de `botoesDaFrase` dentro de qualquer container. */
export function ligarBotoesDaFrase(raiz, palavras) {
  const btnCopiar = raiz.querySelector('[data-frase="copiar"]');
  const btnSalvar = raiz.querySelector('[data-frase="salvar"]');

  if (btnCopiar) {
    btnCopiar.onclick = async () => {
      const ok = await copiar(fraseParaTexto(palavras));
      toast(ok
        ? 'Copiado. Cole agora no seu cofre de senhas — a área de transferência não é lugar de guardar.'
        : 'Este aparelho não deixou copiar. Anote no papel.');
    };
  }

  if (btnSalvar) {
    btnSalvar.onclick = async () => {
      const r = await entregar(textoDoArquivo(palavras), 'zero-frase-de-recuperacao.txt');
      if (r === 'cancelado') return;
      toast('Arquivo gerado. Ele está em texto puro: guarde em lugar trancado.');
    };
  }
}

/** O botão de colar, para as telas que pedem a frase de volta. */
export function botaoColar() {
  return `<button class="btn ghost" data-frase="colar">${icon('colar')} Colar</button>`;
}

/**
 * Cola no campo e já normaliza.
 *
 * Quando o aparelho não entrega a área de transferência — e o iPhone às vezes
 * não entrega — o campo ganha o foco e a pessoa cola do jeito dela. Um botão
 * que não faz nada e não explica é pior do que botão nenhum.
 */
export async function colarNoCampo(campo) {
  const texto = await colar();
  if (!texto) {
    campo.focus();
    toast('Não consegui ler a área de transferência. Segure o campo e toque em Colar.');
    return false;
  }
  const palavras = limparFrase(texto);
  if (!palavras.length) {
    toast('O que estava copiado não tem palavras.');
    return false;
  }
  campo.value = fraseParaTexto(palavras);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
