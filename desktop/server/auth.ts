import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { hash: scryptSync(password, salt, 64).toString('hex'), salt };
}
export function verifyPassword(password: string, hash: string, salt: string) {
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const PASSWORD_MIN = 8;
