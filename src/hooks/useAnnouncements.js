import { useCallback, useEffect, useRef, useState } from 'react';
import { bangkokDate, readSettings } from '../lib/queue';
import { fetchCloudQueueAudio, fetchCloudStartupAudio } from '../services/cloudTts';

export default function useAnnouncements(sound) {
  const active = useRef(false);
  const pending = useRef([]);
  const speaking = useRef(false);
  const currentAudio = useRef(null);
  const currentAudioUrl = useRef(null);
  const cloudRequest = useRef(null);
  const seen = useRef(new Set());
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [speechError, setSpeechError] = useState('');

  const stop = useCallback(() => {
    active.current = false;
    pending.current = [];
    speaking.current = false;
    cloudRequest.current?.abort();
    cloudRequest.current = null;
    currentAudio.current?.pause();
    currentAudio.current = null;
    if (currentAudioUrl.current) URL.revokeObjectURL(currentAudioUrl.current);
    currentAudioUrl.current = null;
    setStarted(false);
    setStarting(false);
  }, []);

  useEffect(() => { if (!sound) stop(); }, [sound, stop]);
  useEffect(() => () => {
    cloudRequest.current?.abort();
    currentAudio.current?.pause();
    if (currentAudioUrl.current) URL.revokeObjectURL(currentAudioUrl.current);
  }, []);

  function pump() {
    if (speaking.current || !active.current || !pending.current.length) return;
    const settings = readSettings();
    if (!settings.sound) { pending.current = []; return; }
    const queue = pending.current.shift();
    if (queue.queue_date !== bangkokDate()) { pump(); return; }

    speaking.current = true;
    const controller = new AbortController();
    cloudRequest.current = controller;
    fetchCloudQueueAudio(queue, settings.announcement, controller.signal).then(blob => {
      if (!active.current || cloudRequest.current !== controller) return;
      cloudRequest.current = null;
      const url = URL.createObjectURL(blob);
      currentAudioUrl.current = url;
      const audio = new Audio(url);
      currentAudio.current = audio;
      audio.volume = settings.ttsVolume;
      // The cached MP3 is generated at rate 0.9.
      audio.playbackRate = settings.ttsRate / 0.9;
      const finish = error => {
        if (currentAudio.current !== audio) return;
        currentAudio.current = null;
        URL.revokeObjectURL(url);
        currentAudioUrl.current = null;
        setSpeechError(error || '');
        speaking.current = false;
        pump();
      };
      audio.onended = () => finish('');
      audio.onerror = () => finish('เล่นเสียง Google Cloud ไม่ได้ กรุณาตรวจสอบอุปกรณ์เสียง');
      audio.play().catch(() => finish('เบราว์เซอร์ไม่อนุญาตให้เล่นเสียง กรุณากดเริ่มระบบและเปิดเสียงอีกครั้ง'));
    }).catch(error => {
      if (controller.signal.aborted || cloudRequest.current !== controller) return;
      cloudRequest.current = null;
      setSpeechError(`${error.message} — ไม่สามารถประกาศคิวด้วย Google Cloud ได้`);
      speaking.current = false;
      pump();
    });
  }

  function announce(queue) {
    const key = `${queue.id}:${queue.called_at}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value);
    if (!active.current || !readSettings().sound) return;
    pending.current.push(queue);
    pump();
  }

  async function start() {
    if (active.current || starting) return;
    setSpeechError('');
    if (!sound) {
      active.current = true;
      setStarted(true);
      return;
    }
    setStarting(true);
    const controller = new AbortController();
    cloudRequest.current = controller;
    try {
      const blob = await fetchCloudStartupAudio(controller.signal);
      if (cloudRequest.current !== controller) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioUrl.current = url;
      currentAudio.current = audio;
      const settings = readSettings();
      audio.volume = settings.ttsVolume;
      audio.playbackRate = settings.ttsRate / 0.9;
      audio.onended = () => {
        if (currentAudio.current !== audio) return;
        currentAudio.current = null;
        URL.revokeObjectURL(url);
        currentAudioUrl.current = null;
        speaking.current = false;
        pump();
      };
      audio.onerror = () => setSpeechError('เล่นเสียงยืนยันไม่สำเร็จ กรุณาตรวจสอบลำโพง');
      speaking.current = true;
      await audio.play();
      active.current = true;
      setStarted(true);
    } catch (error) {
      if (currentAudio.current) {
        currentAudio.current.pause();
        currentAudio.current = null;
      }
      if (currentAudioUrl.current) {
        URL.revokeObjectURL(currentAudioUrl.current);
        currentAudioUrl.current = null;
      }
      speaking.current = false;
      if (!controller.signal.aborted) setSpeechError(error.message || 'เริ่มระบบเสียงไม่สำเร็จ');
    } finally {
      if (cloudRequest.current === controller) cloudRequest.current = null;
      setStarting(false);
    }
  }

  return { announce, start, stop, started, starting, speechError };
}
