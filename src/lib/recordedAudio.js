export const recordedAudioPreference = 'recorded-mp3';

export function queueAudioPath(queueNumber) {
  if (!/^[AB]\d{3,4}$/.test(queueNumber || '')) return null;
  return `${import.meta.env?.BASE_URL || '/'}queue-audio/${queueNumber}.mp3`;
}
