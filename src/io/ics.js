// Calendário — os vencimentos no app nativo do iPhone.
//
// Vale mais do que parece: notificação de PWA no iOS é limitada, mas um evento
// no Calendário com alarme de um dia antes funciona igual ao de qualquer app.
// O arquivo .ics é aberto pelo Calendário direto da folha de compartilhamento.

import { brl } from '../core/money.js';

const stamp = (iso) => `${iso.replace(/-/g, '')}`;
const agora = () => new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

/** Escapa vírgula, ponto e vírgula e quebra de linha, como o RFC 5545 exige. */
const escape = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

/** Quebra a linha em 75 octetos, também exigência do formato. */
function dobrar(linha) {
  const partes = [];
  let resto = linha;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ` ${resto.slice(74)}`;
  }
  partes.push(resto);
  return partes.join('\r\n');
}

function evento({ uid, date, title, description, alarmeDiasAntes = 1 }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@zero.local`,
    `DTSTAMP:${agora()}`,
    `DTSTART;VALUE=DATE:${stamp(date)}`,
    `DTEND;VALUE=DATE:${stamp(date)}`,
    dobrar(`SUMMARY:${escape(title)}`),
    dobrar(`DESCRIPTION:${escape(description)}`),
    'BEGIN:VALARM',
    `TRIGGER:-P${alarmeDiasAntes}D`,
    'ACTION:DISPLAY',
    dobrar(`DESCRIPTION:${escape(title)}`),
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

/** Faturas e vencimentos → um arquivo .ics para o Calendário. */
export function buildCalendar(statements, { nome = 'Zero · vencimentos' } = {}) {
  const eventos = statements
    .filter((s) => s.dueDate && s.totalCents)
    .map((s) =>
      evento({
        uid: `fatura-${s.cardId}-${s.cycleId}`,
        date: s.dueDate,
        title: `Fatura ${s.cardName} · ${brl(s.totalCents)}`,
        description: `Fatura fechada em ${s.closeDate}. Lançado pelo Zero — confira antes de pagar.`,
      })
    );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zero//PT-BR//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    dobrar(`X-WR-CALNAME:${escape(nome)}`),
    ...eventos,
    'END:VCALENDAR',
  ].join('\r\n');
}
