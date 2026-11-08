# Bedside monitor network protocol

This is the stream between the unit's Scalis bedside monitors and their M3100 central station
(`CMS.exe`, OEM tag "DDT", monitor MAC prefix `44:44:54` = ASCII "DDT"). There is no vendor
documentation. Everything here comes from a one-hour packet capture of three monitors (beds 4, 13
and 14) and the central station's own configuration files (`Para.cfg`, `Wave.cfg`, `M3100.ini`). The
implementation is `shared/monitor/protocol.ts`, and `tests/monitor.test.ts` uses the non-identifying
bytes from that capture.

## Network

| | |
|---|---|
| Central station address | `192.168.10.251` / `255.255.255.0` (fixed in the monitors) |
| Monitor addresses | `192.168.10.<bed>` (bed 4 = `.4`) |
| Transport | One TCP connection per monitor, **monitor → central station**, to port **510 + bed** |
| Reconnect | A monitor retries every few seconds while the port is closed (SYN → RST) |

## Framing

```
[len u16 LE] [body …len bytes]

body[0]     bed number
body[1]     class
body[2..3]  header checksum = ~(bed + class + (len & 0xff) + (len >> 8)) & 0xffff, LE
body[4]     type (class 0x46) / first payload byte (others)
body[5]     sub-index
…
body[-2..]  trailer = ~sum(body[4 .. len-2]) & 0xffff, LE — on every frame except ECG (type 0x14)
```

All 63,000+ frames in the capture pass the header checksum; every non-ECG frame passes the trailer.

## Monitor → central station

Sent once on connect: classes `0x3c`, `0x3e` (patient), `0x41` (list of modules), `0x43`, `0x45`.
Then once a second: one class `0x46` frame of each data type and one class `0x47` status frame.

### Class 0x3e — patient information (237 bytes)

| Offset | Field |
|---|---|
| 36 | bed |
| 37–68 | name (ASCII, NUL-separated parts, e.g. first / last) |
| 69–100 | patient ID (ASCII) |
| 101–110 | admission date `YYYY/MM/DD` |
| 118–121 | two u16 (1000 and a per-patient number — meaning unknown) |
| 122–131 | date of birth `YYYY/MM/DD` (`2000/01/01` = not entered) |
| 132–134 | `DDT` |

### Class 0x46 — data (payload = body[6..])

`-100` (`9c ff`) means "not measured" for 16-bit values; temperature `≈6543.6` means no probe.
Alarm-limit blocks are `high i16, low i16, on u16 (1 = on)`.

| Type | Body | Payload layout | Confidence |
|---|---|---|---|
| `0x14` ECG | 987 | 3 × 256 ECG samples (u8, baseline 128) + 128 resp samples + tail: `HR i16 @0`, ?, ST floats, HR limits `@31`, RR limits `@37` | waves verified as format; **HR slot unverified** (leads were off) |
| `0x15` pleth | 284 | 256 pleth samples (u8), `SpO₂ i16 @256`, `PR i16 @258`, SpO₂ limits `@260`, PR limits `@266` | **verified** |
| `0x16` NIBP | 43 | 7 bytes (time of reading?), `sys @7`, `dia @9`, `mean @11`, limits `@13` (sys) `@19` (dia) `@25` (mean) | **unverified** (no reading taken); limit blocks (120/70, 70/40, 90/50) fit sys/dia/mean |
| `0x17` temp | 54 | `T1 f32 @0`, `T2 f32 @4`, `TD f32 @8`, T1 limits `f32 @12/@16, on @20`, T2 limits `@22/@26, on @30` | **verified** |
| `0x18` IBP | 331 | two 128-sample waves + values (all "not measured" in the capture) | not decoded |
| `0x1a` CO₂ | 293 | wave + EtCO₂ / FiCO₂ / awRR (all "not measured") | not decoded |

Sample rates (from `Wave.cfg`, consistent with one frame a second): ECG and pleth 256 Hz, resp 128 Hz.

## Central station → monitor

| Bytes | Meaning |
|---|---|
| `02 00 13 34` | Keep-alive, about once a second per monitor |
| `11 00 2d 4f <sum> <year u16 BE> <mon> <day> <h> <m> <s> 55 aa 55 aa <trailer>` | Clock sync on connect (same checksums as above) |

The gateway sends the keep-alive. Clock sync is optional (off by default).

## Verifying the unverified fields

Use **Live monitor → Receiver → Record raw data**. Then attach ECG leads (or a simulator), take one
NIBP reading, and write down the time and the values the monitor shows. The files land in
`<data folder>/monitor-recordings/bed-NN.bin`, and the frames can be decoded with `FrameReader`.
They contain patient names, so keep them on the PC.
