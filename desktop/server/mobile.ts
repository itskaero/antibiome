// ═══════════════════════════════════════════════════════════
//  Phone access — device registry and one-time pairing codes.
//  A phone must be paired from the PC (admin, QR code valid 10 min, single use) before it can
//  reach anything but the pairing endpoint. Only hashes are stored; a revoked device is refused
//  on its next request. Users still sign in with their own account on top of this.
// ═══════════════════════════════════════════════════════════
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';
import { nowLocal } from '../shared/time';

export const PAIRING_TTL_MS = 10 * 60_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Unambiguous alphabet (no 0/O, 1/I/L) so the code can also be typed. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const normCode = (c: string) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface Device { id: string; name: string; pairedAt: string; lastSeen: string | null; lastUser: string | null; revokedAt: string | null; pairedBy: string | null }

export function createPairingCode(db: DB, userId: number, now: number): { code: string; expiresAt: number } {
  db.prepare('DELETE FROM pairing_codes WHERE expires_at < ?').run(now);
  const bytes = randomBytes(8);
  const raw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  const expiresAt = now + PAIRING_TTL_MS;
  db.prepare('INSERT INTO pairing_codes(code_hash, created_by, expires_at) VALUES (?,?,?)').run(sha(raw), userId, expiresAt);
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
}

/** Single use: the code is deleted whether or not it has expired. */
export function redeemPairingCode(db: DB, code: string, name: string, now: number): { deviceId: string; secret: string; name: string } {
  const h = sha(normCode(code));
  const row = db.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').get(h) as any;
  if (row) db.prepare('DELETE FROM pairing_codes WHERE code_hash = ?').run(h);
  if (!row || row.expires_at < now) throw new Error('This pairing code is invalid or has expired. Ask an administrator for a new one.');
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (clean.length < 2) throw new Error('Give this phone a name, e.g. "Dr Khan\'s phone"');
  const deviceId = randomUUID(), secret = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO devices(id, name, secret_hash, paired_by, paired_at) VALUES (?,?,?,?,?)').run(deviceId, clean, sha(secret), row.created_by, nowLocal());
  db.prepare("INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?, NULL, 'system', 'add', 'device', ?, ?)")
    .run(nowLocal(), deviceId, `Phone paired: "${clean}"`);
  return { deviceId, secret, name: clean };
}

/** Constant-time check of a device credential; returns the device if it is paired and not revoked. */
export function verifyDevice(db: DB, deviceId: string, secret: string): { id: string; name: string } | null {
  if (typeof deviceId !== 'string' || typeof secret !== 'string' || deviceId.length > 64 || secret.length > 128) return null;
  const row = db.prepare('SELECT id, name, secret_hash, revoked_at FROM devices WHERE id = ?').get(deviceId) as any;
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(sha(secret), 'hex'), b = Buffer.from(row.secret_hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: row.id, name: row.name };
}

export function touchDevice(db: DB, deviceId: string, user: string | null) {
  db.prepare('UPDATE devices SET last_seen = ?, last_user = COALESCE(?, last_user) WHERE id = ?').run(nowLocal(), user, deviceId);
}

export function listDevices(db: DB): Device[] {
  return (db.prepare('SELECT d.*, u.display_name AS by FROM devices d LEFT JOIN users u ON u.id = d.paired_by ORDER BY d.revoked_at IS NOT NULL, d.paired_at DESC').all() as any[])
    .map(r => ({ id: r.id, name: r.name, pairedAt: r.paired_at, lastSeen: r.last_seen, lastUser: r.last_user, revokedAt: r.revoked_at, pairedBy: r.by ?? null }));
}

export function revokeDevice(db: DB, deviceId: string): Device {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as any;
  if (!row) throw new Error('Device not found');
  if (!row.revoked_at) db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(nowLocal(), deviceId);
  return listDevices(db).find(d => d.id === deviceId)!;
}
