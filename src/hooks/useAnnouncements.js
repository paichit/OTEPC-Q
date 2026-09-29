import { useCallback, useEffect, useRef, useState } from 'react';
import { bangkokDate, readSettings } from '../lib/queue';
import { fetchCloudQueueAudio, fetchCloudStartupAudio, requestAudioLease } from '../services/cloudTts';


export default function useAnnouncements(sound) {
  const active = useRef(false);
  const pending = useRef([]);
  const speaking = useRef(false);
  const currentAudio = useRef(null);
  const currentAudioUrl = useRef(null);
  const cloudRequest = useRef(null);
  const audioLockRelease = useRef(null);
  const startingRef = useRef(false);
  const startAttempt = useRef(0);
  const serverLeaseOwner = useRef(null);
  const leaseRenewal = useRef(null);
  const leaseRenewing = useRef(false);
  const seen = useRef(new Set());
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [speechError, setSpeechError] = useState('');

  function releaseAudioLock() {
    audioLockRelease.current?.();
    audioLockRelease.current = null;
  }

  function acquireAudioLock() {
    if (!navigator.locks?.request) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      let release;
      const held = new Promise(done => { release = done; });
      try {
        navigator.locks.request('otepc-q-audio-output', { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) {
            settled = true;
            resolve(false);
            return;
          }
          audioLockRelease.current = release;
          settled = true;
          resolve(true);
          await held;
        }).catch(() => {
          if (!settled) resolve(false);
        });
      } catch { resolve(false); }
    });
  }

  function releaseServerAudioLease() {
    clearInterval(leaseRenewal.current);
    leaseRenewal.current = null;
    leaseRenewing.current = false;
    const owner = serverLeaseOwner.current;
    serverLeaseOwner.current = null;
    if (owner) requestAudioLease('release', owner).catch(() => {});
  }

  const stop = useCallback(() => {
    active.current = false;
    startAttempt.current += 1;
    pending.current = [];
    speaking.current = false;
    cloudRequest.current?.abort();
    cloudRequest.current = null;
    releaseAudioLock();
    releaseServerAudioLease();
    currentAudio.current?.pause();
    currentAudio.current = null;
    if (currentAudioUrl.current) URL.revokeObjectURL(currentAudioUrl.current);
    currentAudioUrl.current = null;
    setStarted(false);
    startingRef.current = false;
    setStarting(false);
  }, []);

  useEffect(() => { if (!sound) stop(); }, [sound, stop]);
  useEffect(() => () => {
    cloudRequest.current?.abort();
    currentAudio.current?.pause();
    if (currentAudioUrl.current) URL.revokeObjectURL(currentAudioUrl.current);
    audioLockRelease.current?.();
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
    if (active.current || startingRef.current) return;
    setSpeechError('');
    if (!sound) {
      active.current = true;
      setStarted(true);
      return;
    }
    startingRef.current = true;
    const attempt = ++startAttempt.current;
    setStarting(true);
    const hasAudioLock = await acquireAudioLock();
    if (attempt !== startAttempt.current) {
      releaseAudioLock();
      return;
    }
    if (!hasAudioLock) {
      setSpeechError('มีแท็บอื่นกำลังเปิดเสียงประกาศอยู่ กรุณาปิดเสียงหรือจอแสดงคิวในแท็บนั้นก่อน');
      startingRef.current = false;
      setStarting(false);
      return;
    }
    const owner = crypto.randomUUID();
    try {
      const claimed = await requestAudioLease('claim', owner);
      if (attempt !== startAttempt.current) {
        if (claimed) requestAudioLease('release', owner).catch(() => {});
        releaseAudioLock();
        return;
      }
      if (!claimed) throw new Error('มีจอแสดงคิวจากอุปกรณ์อื่นกำลังใช้เสียงประกาศอยู่ กรุณาหยุดเสียงที่จอนั้นก่อน');
      serverLeaseOwner.current = owner;
    } catch (error) {
      releaseAudioLock();
      startingRef.current = false;
      setStarting(false);
      setSpeechError(error.message || 'จองสิทธิ์เสียงประกาศไม่สำเร็จ');
      return;
    }
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
      if (attempt !== startAttempt.current) {
        audio.pause();
        return;
      }
      active.current = true;
      setStarted(true);
      leaseRenewal.current = setInterval(async () => {
        if (leaseRenewing.current || !serverLeaseOwner.current) return;
        leaseRenewing.current = true;
        try {
          const renewed = await requestAudioLease('renew', owner);
          if (!renewed && active.current) {
            stop();
            setSpeechError('หมดสิทธิ์ใช้เสียงประกาศ จึงหยุดเสียงเพื่อป้องกันเสียงซ้อน');
          }
        } catch {
          if (active.current) {
            stop();
            setSpeechError('ติดต่อระบบยืนยันสิทธิ์เสียงไม่ได้ จึงหยุดเสียงเพื่อป้องกันเสียงซ้อน');
          }
        } finally { leaseRenewing.current = false; }
      }, 10000);
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
      releaseAudioLock();
      releaseServerAudioLease();
      if (!controller.signal.aborted) setSpeechError(error.message || 'เริ่มระบบเสียงไม่สำเร็จ');
    } finally {
      if (cloudRequest.current === controller) cloudRequest.current = null;
      startingRef.current = false;
      setStarting(false);
    }
  }

  return { announce, start, stop, started, starting, speechError };
}
