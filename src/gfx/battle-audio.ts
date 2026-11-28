import { readStore, writeStore } from '../core/infra/storage';
import type { CardCommit } from '../core/infra/events';
import hurtUrl from '../../assets/sfx/hurt.wav';
import blockUrl from '../../assets/sfx/block.wav';
import thrustUrl from '../../assets/sfx/thrust.wav';
import selectUrl from '../../assets/sfx/select.wav';
import drawUrl from '../../assets/sfx/draw.wav';
import playUrl from '../../assets/sfx/play.wav';
import discardUrl from '../../assets/sfx/discard.wav';
import guardUrl from '../../assets/sfx/guard.wav';
import healUrl from '../../assets/sfx/heal.wav';
import fizzleUrl from '../../assets/sfx/fizzle.wav';
import victoryUrl from '../../assets/sfx/victory.wav';
import defeatUrl from '../../assets/sfx/defeat.wav';

// Vite embeds these short clips in the standalone HTML.
const clips = {
  hurt: { url: hurtUrl, gain: 0.79 },
  block: { url: blockUrl, gain: 0.88 },
  thrust: { url: thrustUrl, gain: 0.73 },
  select: { url: selectUrl, gain: 0.20 },
  draw: { url: drawUrl, gain: 0.32 },
  play: { url: playUrl, gain: 0.38 },
  discard: { url: discardUrl, gain: 0.34 },
  guard: { url: guardUrl, gain: 0.26 },
  heal: { url: healUrl, gain: 0.50 },
  fizzle: { url: fizzleUrl, gain: 0.55 },
  victory: { url: victoryUrl, gain: 0.53 },
  defeat: { url: defeatUrl, gain: 0.58 },
};
type Cue = keyof typeof clips;
const kinds = Object.keys(clips) as Cue[];

// Keep the key so previous mute preferences carry over from "打击音效".
const KEY = 'cognirogue.impactSound';
const VOLUME = 0.86;
let enabled = readStore(KEY) !== 'off';
let ctx: AudioContext | undefined;
let bus: GainNode | undefined;
const sounds = new Map<Cue, AudioBuffer>();
const prefetched = new Map<Cue, Promise<ArrayBuffer | null>>();
const decoding = new Set<Cue>();

export const battleSoundEnabled = () => enabled;

export function toggleBattleSound() {
  enabled = !enabled;
  writeStore(KEY, enabled ? 'on' : 'off');
  if (bus) bus.gain.value = enabled ? VOLUME : 0;
  if (enabled) unlock();
}

function unlock() {
  if (!enabled || typeof AudioContext === 'undefined') return;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      bus = ctx.createGain();
      bus.gain.value = VOLUME;
      bus.connect(ctx.destination);
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    preload(ctx);
  } catch {
    // Audio availability must not affect the game.
  }
}

export function bindBattleAudio() {
  if (enabled) {
    for (const kind of kinds) void loadClip(kind);
    // Decode ahead of the first input so even the first card's immediate cue
    // can play. This context can't output audio and needs no user gesture.
    try {
      if (typeof OfflineAudioContext !== 'undefined') preload(new OfflineAudioContext(1, 1, 32000));
    } catch { /* The live context will decode on first input instead. */ }
  }
  // Some browsers only allow resume during user input, not in the impact frame.
  const unlockFromInput = (event: Event) => { if (event.isTrusted) unlock(); };
  // Give the audio context the press-to-release window for immediate pick-up cues.
  window.addEventListener('pointerdown', unlockFromInput, true);
  window.addEventListener('pointerup', unlockFromInput, true);
  window.addEventListener('keydown', unlockFromInput, true);
}

function loadClip(kind: Cue) {
  let pending = prefetched.get(kind);
  if (!pending) {
    pending = readClip(clips[kind].url)
      .catch(() => null)
      .then((bytes) => {
        if (!bytes) prefetched.delete(kind);
        return bytes;
      });
    prefetched.set(kind, pending);
  }
  return pending;
}

async function readClip(url: string) {
  if (url.startsWith('data:')) {
    // A standalone file must work even when the browser is in offline mode.
    const bytes = atob(url.slice(url.indexOf(',') + 1));
    const data = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i);
    return data.buffer;
  }
  const response = await fetch(url);
  return response.ok ? response.arrayBuffer() : null;
}

function preload(context: BaseAudioContext) {
  for (const kind of kinds) {
    if (sounds.has(kind) || decoding.has(kind)) continue;
    decoding.add(kind);
    void loadClip(kind)
      .then(async (bytes) => {
        if (bytes) sounds.set(kind, await context.decodeAudioData(bytes));
      })
      .catch(() => {}) // Audio load or decode failures must not block play.
      .finally(() => { prefetched.delete(kind); decoding.delete(kind); });
  }
}

export function playBattleSound(kind: Cue, force?: number, segment = 0) {
  if (!enabled || document.hidden || ctx?.state !== 'running' || !bus) return;
  const sample = sounds.get(kind);
  if (!sample) return; // Never play a late impact if the clip is still loading.
  try {
    const hit = ctx.createBufferSource();
    const level = ctx.createGain();
    hit.buffer = sample;
    if (force !== undefined) {
      const weight = Math.min(1, Math.sqrt(Math.max(0, force) / 20));
      hit.playbackRate.value = 1.02 - weight * 0.06 + (segment % 3) * 0.018;
      level.gain.value = clips[kind].gain * (0.76 + weight * 0.24);
    } else {
      level.gain.value = clips[kind].gain;
    }
    hit.connect(level).connect(bus);
    hit.onended = () => { hit.disconnect(); level.disconnect(); };
    hit.start();
  } catch {
    // An interrupted audio device should not interrupt the animation.
  }
}

/** 按整手选主音，不按抽牌、飘字等事件的先后抢播。 */
function cardCue(card: CardCommit): Cue {
  if (card.attack) return 'thrust';
  if (card.wrong) return 'fizzle';
  if (card.hurt > 0) return 'hurt';
  if (card.block > 0) return 'guard';
  if (card.heal > 0) return 'heal';
  if (card.draw > 0) return 'draw';
  return 'play';
}

export function playCardSound(card: CardCommit) {
  const kind = cardCue(card);
  // 穿刺、焰灭、护盾亮起在实际开始演出时播放，不在出牌瞬间抢播。
  if (kind === 'thrust' || kind === 'fizzle' || kind === 'guard') return;
  playBattleSound(kind, kind === 'hurt' ? card.hurt : undefined);
}

const litCards = new WeakSet<CardCommit>();

export function playGuardGlow(card?: CardCommit) {
  if (card) {
    if (cardCue(card) !== 'guard' || litCards.has(card)) return;
    litCards.add(card);
  }
  playBattleSound('guard');
}
