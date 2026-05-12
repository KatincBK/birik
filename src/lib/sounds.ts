/**
 * Programmatic ses jeneratörü — PLAN §6.3.
 *
 * Mp3/ogg dosyası kullanmıyoruz; Web Audio API ile her ses runtime'da
 * üretiliyor. Avantajları: app self-contained (asset yok), boyut sıfır,
 * her sistemde aynı çıktı. "Apple Pay" zarafeti — kısa, hafif, agresif
 * değil. Master volume settings store'undan, default %30.
 *
 * Kullanım:
 *   playSound("ding") — işlem kaydedildi
 *   playSound("swoosh") — işlem silindi
 *   playSound("click") — currency cycle, ufak etkileşim
 *   playSound("error") — validation/api hatası
 *   playSound("achievement") — hedefe ulaşma (Faz 6'da kullanılacak)
 */

import { useSettingsStore } from "../stores/useSettingsStore";

export type SoundName = "ding" | "swoosh" | "click" | "error" | "achievement";

let _ctx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!_ctx) {
    // Bazı tarayıcılarda webkitAudioContext fallback'i lazım — modern
    // Tauri webview Chromium tabanlı, AudioContext direkt mevcut.
    _ctx = new AudioContext();
  }
  // Suspended ise resume et (Chrome autoplay policy)
  if (_ctx.state === "suspended") {
    _ctx.resume().catch(() => {});
  }
  return _ctx;
}

/** ADSR-benzeri envelope — kısa attack, exponential decay. */
function envelope(
  ac: AudioContext,
  start: number,
  attack: number,
  decay: number,
  peak: number
) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  return g;
}

/** Ton — sinüs/triangle oscillator + envelope. */
function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = "sine",
  peak = 0.3
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  const env = envelope(ac, start, 0.01, duration, peak);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + duration + 0.05);
  return env;
}

/** Pitch glide (örn. swoosh için). */
function glide(
  ac: AudioContext,
  fromFreq: number,
  toFreq: number,
  start: number,
  duration: number,
  type: OscillatorType = "sine",
  peak = 0.25
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, start);
  osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);
  const env = envelope(ac, start, 0.005, duration, peak);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + duration + 0.05);
  return env;
}

function masterGain(ac: AudioContext): GainNode {
  const m = ac.createGain();
  m.gain.value = 0.3; // settings'ten okunacak
  m.connect(ac.destination);
  return m;
}

function playDing(ac: AudioContext, t0: number, master: GainNode) {
  // İki harmonik üst üste, hafif gecikmeli — "tatlı tıngır"
  tone(ac, 880, t0, 0.18, "sine", 0.35).connect(master);
  tone(ac, 1320, t0 + 0.02, 0.14, "sine", 0.18).connect(master);
}

function playClick(ac: AudioContext, t0: number, master: GainNode) {
  // Çok kısa, yüksek tıkırtı
  tone(ac, 1800, t0, 0.04, "triangle", 0.18).connect(master);
}

function playSwoosh(ac: AudioContext, t0: number, master: GainNode) {
  // Yukarıdan aşağıya glide + hafif gürültü
  glide(ac, 600, 200, t0, 0.18, "sine", 0.18).connect(master);

  // Bant filtreli kısa noise (gerçek nefes hissi)
  const noise = ac.createBuffer(1, ac.sampleRate * 0.18, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = noise;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1500;
  filter.Q.value = 0.6;
  const env = envelope(ac, t0, 0.005, 0.16, 0.06);
  src.connect(filter).connect(env).connect(master);
  src.start(t0);
  src.stop(t0 + 0.2);
}

function playError(ac: AudioContext, t0: number, master: GainNode) {
  // Düşük, kısa, dissonant iki ton
  tone(ac, 220, t0, 0.10, "square", 0.10).connect(master);
  tone(ac, 233, t0, 0.10, "square", 0.10).connect(master);
}

function playAchievement(ac: AudioContext, t0: number, master: GainNode) {
  // 3-tone arpeggio — major triad, "FF7 victory" zarif kısa hâl
  // C5, E5, G5
  tone(ac, 523.25, t0 + 0.0, 0.16, "triangle", 0.30).connect(master);
  tone(ac, 659.25, t0 + 0.10, 0.16, "triangle", 0.30).connect(master);
  tone(ac, 783.99, t0 + 0.20, 0.32, "triangle", 0.34).connect(master);
}

const PLAYERS: Record<SoundName, (ac: AudioContext, t0: number, m: GainNode) => void> = {
  ding: playDing,
  click: playClick,
  swoosh: playSwoosh,
  error: playError,
  achievement: playAchievement,
};

/**
 * Sesi çal — settings.soundEnabled false ise no-op.
 *
 * AudioContext kullanıcı etkileşimi olmadan başlatılırsa Chrome
 * autoplay policy gereği "suspended" kalır; ilk tıklamada resume olur.
 * Birik'te ilk ses zaten kullanıcı tıklamasıyla tetikleniyor (modal,
 * buton vs.) — sorun olmuyor.
 */
export function playSound(name: SoundName): void {
  const enabled = useSettingsStore.getState().soundEnabled;
  if (!enabled) return;
  try {
    const ac = ctx();
    const master = masterGain(ac);
    PLAYERS[name](ac, ac.currentTime, master);
  } catch (err) {
    // Sessiz başarısız — ses olmazsa app çalışmaya devam etsin
    console.warn("[birik] sound failed", err);
  }
}
