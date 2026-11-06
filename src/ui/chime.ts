let context: AudioContext | undefined;

/** Browsers only allow sound after someone has interacted with the page. */
export async function unlockChime() {
  context ??= new AudioContext();
  await context.resume();
  return context.state === 'running';
}

export function playChime() {
  if (context?.state !== 'running') return;
  const start = context.currentTime;
  [880, 1175].forEach((frequency, index) => {
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    const at = start + index * 0.18;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  });
}
