"""Original score for the Antibiome PICU film, synthesised from scratch and cut to the picture.

120 BPM (a beat is 0.5 s, a bar 2 s) so every scene change in film/index.html lands on the grid.
  0–5    minimal       pad, accelerating data ticks, riser into the first impact
  5–12   tension       kick enters at 6, sub bass at 8, plucked arp at 10
  12–25  acceleration  full groove, clap on 2 and 4, hats to sixteenths, riser into 25
  25–33  transformation  filtered half-time, then a 4-bar build with a snare roll
  33–38  climax        the drop: everything open, under the intelligence dashboard
  38–45  resolution    logo impact, sustained chord, long tail
Sound design (clicks, whooshes, low impacts) is placed on the same frames as the visuals.

Usage: python film/score.py   → film/score.wav (48 kHz, 16-bit stereo)
       python film/score.py --vertical   → film/score-vertical.wav: the 50 s portrait cut
       (film/vertical.html), whose resolution holds 5 s longer under the download card.
"""
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from pathlib import Path
import sys

VERTICAL = '--vertical' in sys.argv
SR = 48000
DUR = 50.0 if VERTICAL else 45.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(20261009)
L = np.zeros(N); R = np.zeros(N)
send = np.zeros(N)  # reverb bus (mono)


def t_axis(n):
    return np.arange(n) / SR


def add(sig, at, pan=0.0, gain=1.0, rev=0.0):
    """Mix `sig` in at time `at` (s), equal-power pan -1..1, with a reverb send."""
    i = int(round(at * SR))
    if i >= N:
        return
    sig = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i:i + len(sig)] += sig * np.cos(a)
    R[i:i + len(sig)] += sig * np.sin(a)
    if rev:
        send[i:i + len(sig)] += sig * rev


def env(n, a=0.005, d=0.3, curve=4.0):
    t = t_axis(n)
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-curve * np.maximum(0, t - a) / max(d, 1e-4))
    return e


def lp(x, hz, order=2):
    return sosfilt(butter(order, min(hz, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz / (SR / 2), 'high', output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], 'band', output='sos'), x)


def note(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def saw(f, n, detune=0.0):
    t = t_axis(n)
    ph = (f * (1 + detune)) * t + rng.random()
    return 2 * (ph % 1) - 1


# ── harmony: Am(add9) – Fmaj7 – Cmaj7 – G6, two bars each, looping ──
CHORDS = [
    (45, [57, 60, 64, 71]),  # A minor add9
    (41, [57, 60, 64, 65]),  # F major 7
    (48, [55, 60, 64, 67]),  # C major 7
    (43, [55, 59, 62, 64]),  # G6
]


def chord_at(t):
    return CHORDS[int(t // 4) % 4]


# ── pad (whole film, filter opens with the story) ──
def pad_layer():
    out_l = np.zeros(N); out_r = np.zeros(N)
    for k in range(int(DUR // 4) + 1):
        t0 = k * 4.0
        if t0 >= DUR:
            break
        n = int(4.6 * SR)
        _, notes = CHORDS[k % 4]
        if t0 >= 36:  # resolution: hold the home chord to the end
            notes = CHORDS[0][1]
            n = int((DUR - t0) * SR)
        sig_l = np.zeros(n); sig_r = np.zeros(n)
        for m in notes:
            f = note(m)
            sig_l += saw(f, n, -0.004) + 0.6 * saw(f / 2, n, 0.003)
            sig_r += saw(f, n, 0.005) + 0.6 * saw(f / 2, n, -0.002)
        # brightness follows the arc: dark → open at the drop → warm at the end
        bright = 700 if t0 < 5 else 1200 if t0 < 12 else 1800 if t0 < 25 else 900 if t0 < 29 else 1600 if t0 < 33 else 3200 if t0 < 38 else 1400
        att = 1.2 if t0 < 1 else 0.4
        e = np.minimum(1, t_axis(n) / att) * np.minimum(1, (n / SR - t_axis(n)) / 0.6)
        sig_l = lp(sig_l, bright) * e; sig_r = lp(sig_r, bright) * e
        i = int(t0 * SR); j = min(N, i + n)
        out_l[i:j] += sig_l[: j - i]; out_r[i:j] += sig_r[: j - i]
    return out_l, out_r


pl, pr = pad_layer()
pad_gain = np.interp(t_axis(N), [0, 2, 5, 5.2, 12, 25, 29, 33, 38, 40, DUR - 1, DUR], [0, .05, .08, .05, .06, .055, .07, .06, .07, .09, .07, 0])
L += pl * pad_gain; R += pr * pad_gain
send += (pl + pr) * pad_gain * 0.35

# ── drums ──
def kick(strength=1.0):
    n = int(0.45 * SR); t = t_axis(n)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n) * np.exp(-t * 260), 2500) * 0.35
    return np.tanh((body + click) * 1.6 * strength) * 0.9


def clap():
    n = int(0.35 * SR); t = t_axis(n)
    e = np.zeros(n)
    for k, o in enumerate([0, 0.011, 0.022, 0.033]):
        e += np.exp(-np.maximum(0, t - o) * (180 if k < 3 else 22)) * (t >= o)
    return bp(rng.standard_normal(n), 900, 5200) * e * 0.55


def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR); t = t_axis(n)
    return hp(rng.standard_normal(n), 7000) * np.exp(-t * (18 if open_ else 90)) * 0.28


def snare():
    n = int(0.22 * SR); t = t_axis(n)
    return (bp(rng.standard_normal(n), 1500, 7000) * np.exp(-t * 26) * 0.5 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.4)


kick_times = []
for b in np.arange(6.0, 25.0, BEAT):
    kick_times.append(b)
for b in [25.0, 26.0, 27.0, 28.0]:  # half-time
    kick_times.append(b)
for b in np.arange(29.0, 31.0, BEAT):
    kick_times.append(b)
for b in np.arange(31.0, 32.0, BEAT / 2):
    kick_times.append(b)
for b in np.arange(33.0, 38.0, BEAT):
    kick_times.append(b)
for kt in kick_times:
    add(kick(1.15 if kt in (12.0, 25.0, 33.0) else 1.0), kt, gain=0.95 if kt < 33 else 1.0)

for b in np.arange(10.5, 25.0, 1.0):
    add(clap(), b, pan=0.05, gain=0.9, rev=0.25)
for b in np.arange(33.5, 38.0, 1.0):
    add(clap(), b, pan=0.05, gain=1.0, rev=0.3)
# hats: eighths 12–18.5, sixteenths 18.5–25 and in the drop
for h in np.arange(12.25, 18.5, BEAT):
    add(hat(), h, pan=0.35, gain=0.8)
for k, h in enumerate(np.arange(18.5, 25.0, BEAT / 2)):
    add(hat(k % 4 == 2), h, pan=0.35 if k % 2 else -0.25, gain=0.65 + 0.2 * (k % 2))
for k, h in enumerate(np.arange(33.0, 38.0, BEAT / 2)):
    add(hat(k % 4 == 2), h, pan=0.35 if k % 2 else -0.25, gain=0.75)
# snare roll into the drop (bars 31–33): accelerating
roll = []
t = 31.0
while t < 33.0:
    roll.append(t)
    t += BEAT / 2 if t < 32.0 else BEAT / 4 if t < 32.5 else BEAT / 8
for k, rt in enumerate(roll):
    add(snare(), rt, gain=0.25 + 0.6 * (k / len(roll)), rev=0.2)

# sidechain envelope from the kick (pumps bass, pad and arp)
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR); n = int(0.32 * SR)
    seg = 1 - 0.65 * np.exp(-t_axis(n) * 9)
    j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], seg[: j - i])

# ── sub bass: roots, eighth-note pulse from 8 s, held through the half-time, full in the drop ──
bass = np.zeros(N)
for b in np.arange(8.0, 38.0, BEAT / 2):
    if 25 <= b < 29 and (b * 2) % 2:  # sparser in the breakdown
        continue
    root, _ = chord_at(b)
    n = int(0.24 * SR); tt = t_axis(n)
    f = note(root - 12 if root > 44 else root)
    s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt) + 0.15 * saw(f, n)
    s = lp(s, 380) * env(n, 0.004, 0.22, 3.2)
    i = int(b * SR); j = min(N, i + n)
    bass[i:j] += s[: j - i]
bass_gain = np.interp(t_axis(N), [0, 8, 8.5, 25, 25.2, 29, 33, 38, 38.3], [0, 0, .32, .32, .22, .26, .36, .36, 0])
L += bass * bass_gain * duck; R += bass * bass_gain * duck

# ── plucked arp (16ths), from 10 s; filtered in the breakdown; open in the drop ──
PATTERN = [0, 2, 1, 3, 2, 1, 3, 2]
for k, a in enumerate(np.arange(10.0, 38.0, BEAT / 2)):
    _, notes = chord_at(a)
    m = notes[PATTERN[k % 8]] + (12 if (k // 8) % 2 and a > 18 else 0)
    n = int(0.3 * SR)
    s = saw(note(m), n, 0.002) * 0.6 + saw(note(m) * 1.003, n) * 0.4
    cutoff = 1400 + 2600 * (a > 18) + 3000 * (a >= 33) - 1800 * (25 <= a < 29)
    s = lp(s, cutoff) * env(n, 0.003, 0.16, 3.0)
    g = 0.07 if a < 12 else 0.085
    if 25 <= a < 29:
        g *= 0.6
    add(s * duck[int(a * SR): int(a * SR) + n][: len(s)] if int(a * SR) + n <= N else s, a, pan=0.45 if k % 2 else -0.45, gain=g, rev=0.3)

# ── data ticks (0–5 s): match the fragments' accelerating arrivals in the picture ──
PENTA = [76, 79, 81, 84, 86, 88, 91, 93]
for i in range(0, 170, 2):
    ts = 4.55 * (i / 170) ** 0.62
    n = int(0.05 * SR); tt = t_axis(n)
    s = np.sin(2 * np.pi * note(PENTA[rng.integers(len(PENTA))]) * tt) * np.exp(-tt * 70)
    add(s, ts, pan=float(rng.uniform(-0.8, 0.8)), gain=0.05 + 0.05 * (ts / 4.55), rev=0.4)

# ── risers, whooshes, impacts, clicks ──
def riser(dur, f0=200, f1=4000):
    n = int(dur * SR); tt = t_axis(n)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 24
    for s in range(steps):
        a, b = s * n // steps, (s + 1) * n // steps
        fc = f0 * (f1 / f0) ** (s / steps)
        out[a:b] = bp(nz, fc * 0.7, fc * 1.4)[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(f0 / 2 * (f1 / f0) ** (tt / dur) / 4) / SR)
    return (out * 0.6 + tone * 0.15) * (tt / dur) ** 2


def whoosh(dur=0.6, up=True):
    n = int(dur * SR); tt = t_axis(n)
    nz = rng.standard_normal(n)
    e = np.sin(np.pi * tt / dur) ** 2
    lo, hi = (300, 3000) if up else (3000, 300)
    out = np.zeros(n)
    for s in range(12):
        a, b = s * n // 12, (s + 1) * n // 12
        fc = lo * (hi / lo) ** (s / 12)
        out[a:b] = bp(nz, fc * 0.6, fc * 1.6)[a:b]
    return out * e * 0.5


def impact(big=1.0):
    n = int(2.8 * SR); tt = t_axis(n)
    f = 30 + 45 * np.exp(-tt * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.2)
    crack = lp(rng.standard_normal(n), 6000) * np.exp(-tt * 30) * 0.5
    return np.tanh((boom * 1.4 + crack) * big) * 0.8


def click(pitch=2600, g=1.0):
    n = int(0.03 * SR); tt = t_axis(n)
    return (np.sin(2 * np.pi * pitch * tt) * np.exp(-tt * 200) + hp(rng.standard_normal(n), 4000) * np.exp(-tt * 400) * 0.3) * g


def swell(dur=1.2):
    n = int(dur * SR); tt = t_axis(n)
    return lp(rng.standard_normal(n), 2500) * (tt / dur) ** 3 * 0.35


for a, d in [(2.9, 2.1), (23.6, 1.4), (30.6, 2.4), (36.2, 1.8)]:
    add(riser(d), a, gain=0.55 if a != 30.6 else 0.7, rev=0.4)
for at, big in [(5.0, 0.9), (12.0, 1.0), (25.0, 0.9), (33.0, 1.25), (38.0, 1.35)]:
    add(impact(big), at, gain=0.85, rev=0.5)
for at, up in [(11.55, True), (18.0, False), (23.2, False), (24.45, True), (28.95, False), (30.7, True), (32.0, False), (36.0, True)]:
    add(whoosh(0.65, up), at - 0.3, pan=0.2 if up else -0.2, gain=0.55, rev=0.3)
add(swell(1.0), 1.5, gain=0.6, rev=0.5)
add(swell(0.9), 3.15, gain=0.5, rev=0.5)
# UI clicks: chain nodes, KPI cards, notices, scene labels, dashboard panels, wordmark
for at in [5.0, 5.5, 6.0, 6.5, 7.0]:
    add(click(2400), at, pan=-0.6 + 0.3 * (at - 5) / 0.5, gain=0.5, rev=0.2)
for k in range(5):
    add(click(2200 + 120 * k), 13.0 + 0.25 * k, pan=-0.5 + 0.25 * k, gain=0.45)
for k in range(3):
    add(click(3000), 16.4 + 0.5 * k, pan=0.4, gain=0.4)
for at in [25.15, 29.05, 32.0]:
    add(click(1800, 1.2), at, gain=0.5, rev=0.3)
for k in range(6):
    add(click(2600 + 150 * k), 33.0 + 0.125 * k, pan=-0.6 + 0.24 * k, gain=0.35)
for k in range(9):
    add(click(3200, 0.6), 38.6 + 0.045 * k, pan=-0.4 + 0.1 * k, gain=0.3, rev=0.3)
add(click(1500, 1.4), 28.45, gain=0.5, rev=0.3)   # Phoenix: septic shock chip
add(click(1300, 1.4), 40.4, gain=0.35, rev=0.6)   # tagline
if VERTICAL:  # download card: link, then QR code
    add(click(1600, 1.2), 42.2, gain=0.4, rev=0.5)
    add(click(2400, 1.0), 42.9, gain=0.35, rev=0.5)

# ── reverb (synthetic hall) ──
irn = int(2.6 * SR)
ir = rng.standard_normal(irn) * np.exp(-t_axis(irn) * 2.4)
ir = lp(ir, 5000)
ir /= np.sqrt(np.sum(ir ** 2))
wet = fftconvolve(send, ir)[:N] * 0.35
L += wet; R += np.roll(wet, int(0.013 * SR))

# ── master: gentle glue, fades, limiter ──
master = np.stack([L, R])
master = hp(master, 25)
fade = np.interp(t_axis(N), [0, 0.15, DUR - 0.8, DUR], [0, 1, 1, 0])
master *= fade
master = np.tanh(master * 1.4) / np.tanh(1.4)
master /= np.max(np.abs(master)) / 0.89
out = (master.T * 32767).astype(np.int16)

import wave
path = Path(__file__).with_name('score-vertical.wav' if VERTICAL else 'score.wav')
with wave.open(str(path), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(out.tobytes())
print(f'score -> {path} ({DUR:.0f} s)')
