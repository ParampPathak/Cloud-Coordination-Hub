import type { Slot } from '../shared/types';
const escape = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
    .replaceAll('\r', '');
const stamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
export function appointmentCalendar(slot: Slot, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cloud Coordination Hub//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${slot.id}@cloud-coordination-hub`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(slot.startsAt)}`,
    `DTEND:${stamp(slot.endsAt)}`,
    `SUMMARY:${escape(slot.title)}`,
    `LOCATION:${escape(slot.location)}`,
    'STATUS:CONFIRMED',
    'DESCRIPTION:Exported appointment snapshot. Delete this entry if you cancel or reschedule. Download the updated appointment after moving.',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // Fold by UTF-8 bytes, leaving room for the continuation space.
  return (
    lines
      .map((line) => {
        let output = '',
          bytes = 0;
        for (const char of line) {
          const size = new TextEncoder().encode(char).length;
          if (bytes + size > 74) {
            output += '\r\n ';
            bytes = 1;
          }
          output += char;
          bytes += size;
        }
        return output;
      })
      .join('\r\n') + '\r\n'
  );
}
export function downloadAppointment(slot: Slot) {
  const url = URL.createObjectURL(
    new Blob([appointmentCalendar(slot)], {
      type: 'text/calendar;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'appointment.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
