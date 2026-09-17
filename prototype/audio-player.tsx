import {useEffect, useRef, useState, type RefObject} from 'react';

/** One output route: whichever control started it, only one clip can speak. */
export function useAudioPlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const source = useRef<MediaElementAudioSourceNode | null>(null);
  const sequence = useRef(0);

  function stop() {
    sequence.current++;
    audio.current?.pause();
    source.current?.disconnect();
    analyser.current?.disconnect();
    source.current = null;
    analyser.current = null;
    setPlaying(null);
  }
  async function play(id: string, url: string, fraction = 0) {
    stop();
    const ticket = sequence.current;
    const element = new Audio(url);
    audio.current = element;
    setError('');
    element.onended = () => { if (audio.current === element) stop(); };
    element.onerror = () => {
      if (audio.current === element) { stop(); setError('This sample could not load. Please try again.'); }
    };
    if (fraction) element.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(element.duration)) element.currentTime = fraction * element.duration;
    }, {once: true});
    // Resume from the user gesture, and only route audio after the context is running.
    // Playback still works if Web Audio is unavailable.
    try {
      if (window.AudioContext) {
        context.current ??= new AudioContext();
        await context.current.resume();
        if (ticket !== sequence.current) return;
        if (context.current.state === 'running') {
          const node = context.current.createAnalyser();
          node.fftSize = 256;
          node.smoothingTimeConstant = .68;
          const input = context.current.createMediaElementSource(element);
          input.connect(node);
          node.connect(context.current.destination);
          source.current = input;
          analyser.current = node;
        }
      }
    } catch { /* A static waveform is preferable to losing the audio. */ }
    if (ticket !== sequence.current) return;
    try {
      await element.play();
      if (ticket === sequence.current) setPlaying(id);
    } catch {
      if (ticket === sequence.current) { stop(); setError('This sample could not play. Please try again.'); }
    }
  }
  function toggle(id: string, url: string) {
    if (playing === id) stop(); else void play(id, url);
  }
  function switchClip(id: string, url: string) {
    const element = audio.current;
    const fraction = element && Number.isFinite(element.duration) && element.duration > 0
      ? Math.min(.99, element.currentTime / element.duration) : 0;
    void play(id, url, fraction);
  }
  useEffect(() => () => {
    sequence.current++;
    audio.current?.pause();
    source.current?.disconnect();
    analyser.current?.disconnect();
    void context.current?.close();
  }, []);
  return {playing, error, analyser, toggle, switchClip, stop, clearError: () => setError('')};
}

export function Wave({active = false, analyser}: {
  active?: boolean; analyser: RefObject<AnalyserNode | null>;
}) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bars = [...(root.current?.querySelectorAll('i') ?? [])];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const rest = () => bars.forEach(bar => { bar.style.transform = 'scaleY(.16)'; });
    const draw = () => {
      const node = analyser.current;
      if (!active || motion.matches || !node) { rest(); return; }
      const data = new Uint8Array(node.frequencyBinCount);
      const tick = () => {
        if (analyser.current !== node) { rest(); return; }
        node.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          // Speech-frequency buckets, with a small quiet floor rather than a fake pulse.
          const start = 1 + Math.floor(i * (data.length / 2 - 1) / bars.length);
          const amplitude = (data[start] + data[Math.min(start + 1, data.length - 1)]) / 510;
          bar.style.transform = `scaleY(${Math.max(.10, amplitude)})`;
        });
        frame = requestAnimationFrame(tick);
      };
      tick();
    };
    const refresh = () => { cancelAnimationFrame(frame); draw(); };
    motion.addEventListener('change', refresh);
    draw();
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', refresh); rest(); };
  }, [active, analyser]);
  return <span ref={root} className={`wave ${active ? 'speaking' : ''}`} aria-hidden="true">
    {Array.from({length: 26}, (_, i) => <i key={i} style={{height: 30, transform: 'scaleY(.16)'}} />)}
  </span>;
}
