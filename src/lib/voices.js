export const googleThaiPreference = 'google-thai';

export function thaiVoices(synth = globalThis.speechSynthesis) {
  return synth ? synth.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('th')) : [];
}

export function googleThaiVoice(voices) {
  return voices.find(voice =>
    voice.lang.toLowerCase().startsWith('th') &&
    /google/i.test(voice.name + ' ' + voice.voiceURI)
  );
}

export function selectedThaiVoice(preference, voices) {
  if (preference === googleThaiPreference) return googleThaiVoice(voices) || preferredThaiFallback(voices);
  return voices.find(voice => voice.voiceURI === preference) || preferredThaiFallback(voices);
}

export function preferredThaiFallback(voices) {
  return voices.find(voice => /premwadee|female|ผู้หญิง/i.test(voice.name)) || voices[0];
}

export function voiceNotice(preference, voices) {
  const selected = selectedThaiVoice(preference, voices);
  if (!selected) return 'เครื่องนี้ยังไม่พบเสียงภาษาไทย ระบบจะลองใช้เสียงภาษาไทยเริ่มต้นของเบราว์เซอร์ กรุณากดทดสอบเสียงบนเครื่องจอแสดงผล';
  if (preference === googleThaiPreference && !googleThaiVoice(voices)) return `ไม่พบเสียง Google ไทยบนเครื่องนี้ ระบบจะใช้ ${selected.name} แทน กรุณาทดสอบเสียงบนเครื่องจอแสดงผล`;
  if (preference !== googleThaiPreference && selected.voiceURI !== preference) return `ไม่พบเสียงที่เลือกไว้ ระบบจะใช้ ${selected.name} แทน`;
  return '';
}
