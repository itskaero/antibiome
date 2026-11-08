// ═══════════════════════════════════════════════════════════
//  Phone access — device registry and one-time pairing codes.
//  A phone must be paired from the PC (admin, QR code valid 10 min, single use) before it can
//  reach anything but the pairing endpoint. Only hashes are stored; a revoked device is refused
//  on its next request. Users still sign in with their own account on top of this.
// ═══════════════════════════════════════════════════════════
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';
import { nowLocal } from '../shared/time';
import { hashPassword, PASSWORD_MIN } from './auth';

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

// ── Staff invites: one QR / link an admin shares; each person requests an account from their phone ──

export const INVITE_ROLES = ['clinician', 'viewer', 'researcher'] as const;
export interface Invite { id: string; role: string; createdAt: string; expiresAt: number; maxUses: number; uses: number; revokedAt: string | null; by: string | null }

export function createInvite(db: DB, userId: number, opts: { role: string; days: number; maxUses: number }, now: number): { id: string; code: string; expiresAt: number } {
  if (!(INVITE_ROLES as readonly string[]).includes(opts.role)) throw new Error('Invites can be for clinicians, viewers or researchers. Make administrators from Settings.');
  const days = Number(opts.days), maxUses = Number(opts.maxUses);
  if (!(days >= 1 && days <= 30)) throw new Error('An invite lasts 1–30 days');
  if (!(maxUses >= 1 && maxUses <= 100)) throw new Error('An invite can be used 1–100 times');
  const raw = Array.from(randomBytes(10), b => ALPHABET[b % ALPHABET.length]).join('');
  const id = randomUUID(), expiresAt = now + days * 86_400_000;
  db.prepare('INSERT INTO invites(id, code_hash, role, created_by, created_at, expires_at, max_uses) VALUES (?,?,?,?,?,?,?)').run(id, sha(raw), opts.role, userId, nowLocal(), expiresAt, maxUses);
  return { id, code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
}

export function listInvites(db: DB, now: number): (Invite & { active: boolean })[] {
  return (db.prepare('SELECT i.*, u.display_name AS by FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 50').all() as any[])
    .map(r => ({ id: r.id, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, revokedAt: r.revoked_at, by: r.by ?? null,
      active: !r.revoked_at && r.expires_at > now && r.uses < r.max_uses }));
}

export function revokeInvite(db: DB, id: string) {
  db.prepare('UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(nowLocal(), id);
}

const USERNAME = /^[a-z0-9._-]{3,32}$/i;

/** Redeem an invite: pairs this phone and files an account request for an admin to approve. */
export function joinWithInvite(db: DB, p: { code: string; deviceName: string; displayName: string; username: string; password: string }, now: number) {
  const inv = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(sha(normCode(p.code))) as any;
  if (!inv || inv.revoked_at || inv.expires_at < now || inv.uses >= inv.max_uses) throw new Error('This invite is invalid, used up or has expired. Ask an administrator for a new one.');
  const displayName = String(p.displayName ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const username = String(p.username ?? '').trim();
  const deviceName = String(p.deviceName ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || `${displayName}'s phone`;
  if (displayName.length < 2) throw new Error('Enter your name as colleagues know it, e.g. "Dr A. Khan"');
  if (!USERNAME.test(username)) throw new Error('Username: 3–32 letters, digits, dots, dashes or underscores');
  if (String(p.password ?? '').length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters`);
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username) || db.prepare("SELECT 1 FROM account_requests WHERE username = ? AND status = 'pending'").get(username))
    throw new Error('That username is taken — choose another');
  const deviceId = randomUUID(), secret = randomBytes(32).toString('base64url');
  const { hash, salt } = hashPassword(String(p.password));
  const id = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO devices(id, name, secret_hash, paired_by, paired_at) VALUES (?,?,?,?,?)').run(deviceId, deviceName, sha(secret), inv.created_by, nowLocal());
    db.prepare('INSERT INTO account_requests(id, username, display_name, role, pw_hash, pw_salt, device_id, invite_id, requested_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, username, displayName, inv.role, hash, salt, deviceId, inv.id, nowLocal());
    db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(inv.id);
    db.prepare("INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?, NULL, 'system', 'add', 'account-request', ?, ?)")
      .run(nowLocal(), id, `Account requested from a phone: ${displayName} (${username}, ${inv.role}) — "${deviceName}" paired`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { device: { deviceId, secret, name: deviceName }, request: { id, status: 'pending' as const, role: inv.role } };
}
