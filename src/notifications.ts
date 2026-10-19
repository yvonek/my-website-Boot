let audioContext: AudioContext | null = null;

export function unlockNotificationSound() {
  try {
    if (typeof window === 'undefined' || window.localStorage.getItem('notification-sound') !== 'on' || typeof AudioContext === 'undefined') return;
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
  } catch { /* Audio may be unavailable in this browser. */ }
}

export function playNotificationSound() {
  try {
    if (typeof window === 'undefined' || window.localStorage.getItem('notification-sound') !== 'on' || typeof AudioContext === 'undefined') return;
    const context = audioContext ?? new AudioContext();
    audioContext = context;
    if (context.state === 'suspended') void context.resume();
    [[1175, 0, 0.16], [1480, 0.13, 0.16], [1760, 0.26, 0.32]].forEach(([frequency, delay, duration]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    });
  } catch { /* Audio may be unavailable in this browser. */ }
}