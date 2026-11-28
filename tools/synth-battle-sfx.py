"""Regenerate the original hurt and guard cues (stdlib only)."""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 32_000
OUT = Path(__file__).resolve().parents[1] / "assets" / "sfx"


def tone(frequency, t):
    return math.sin(math.tau * frequency * t)


def envelope(t, rise, decay):
    return (1 - math.exp(-t / rise)) * math.exp(-t / decay) if t >= 0 else 0


def noise_band(low, high, seed):
    rng = random.Random(seed)
    a = 1 - math.exp(-math.tau * low / RATE)
    b = 1 - math.exp(-math.tau * high / RATE)
    lo = hi = 0.0
    while True:
        white = rng.uniform(-1, 1)
        lo += a * (white - lo)
        hi += b * (white - hi)
        yield hi - lo


def hurt(t, edge, cloth):
    # One compact contact: an abrasive edge, followed by a falling, muffled body.
    phase = 96 * t + 112 * 0.018 * (1 - math.exp(-t / 0.018))
    body = (math.sin(math.tau * phase) + 0.31 * math.sin(math.tau * 2 * phase))
    weight = 0.52 * body * envelope(t, 0.002, 0.032)
    scrape = 0.87 * edge * envelope(t, 0.0007, 0.013)
    rasp = 0.41 * cloth * envelope(t, 0.003, 0.032)
    bite = 0.13 * (tone(1590, t) + 0.46 * tone(2517, t)) * envelope(t, 0.0008, 0.008)
    return weight + scrape + rasp + bite


def guard(t):
    # Keep the pitches; give the warm chord time to open before the light catches.
    root = 0.46 * (tone(392, t) + 0.18 * tone(784, t)) * envelope(t, 0.054, 0.176)
    fifth_at = t - 0.026
    third_at = t - 0.055
    fifth = 0.32 * tone(587.33, fifth_at) * envelope(fifth_at, 0.050, 0.145)
    third = 0.21 * tone(987.77, third_at) * envelope(third_at, 0.048, 0.115)
    light = envelope(t - 0.083, 0.032, 0.083)
    glimmer = light * (0.078 * tone(1174.66, t) + 0.033 * tone(1568, t))
    return root + fifth + third + glimmer


def write_clip(name, duration, synth, bands, fade=0.022):
    noise = [noise_band(*band) for band in bands]
    frames = [
        synth(i / RATE, *(next(band) for band in noise))
        * math.sin(math.pi / 2 * min(1, (duration - i / RATE) / fade)) ** 2
        for i in range(round(duration * RATE))
    ]
    scale = 0.82 * 32767 / max(map(abs, frames))
    with wave.open(str(OUT / f"{name}.wav"), "wb") as wav:
        wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(struct.pack(f"<{len(frames)}h", *(round(x * scale) for x in frames)))


if __name__ == "__main__":
    write_clip("hurt", 0.141, hurt, ((1200, 5700, 271), (330, 1740, 287)))
    write_clip("guard", 0.520, guard, (), fade=0.060)
