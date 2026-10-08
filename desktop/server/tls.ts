// TLS material for the phone server: a self-signed certificate generated once on the PC
// (staff confirm its SHA-256 fingerprint on the browser's one-time warning page), or an
// IT-issued PFX loaded in Settings (preferred — no warnings).
import { generate } from 'selfsigned';
import { connect } from 'node:tls';

export async function generateCertificate(addresses: string[]): Promise<{ key: string; cert: string }> {
  const now = new Date();
  const until = new Date(now); until.setFullYear(until.getFullYear() + 3);
  const r = await generate([{ name: 'commonName', value: 'Antibiome PICU (local)' }, { name: 'organizationName', value: 'Antibiome PICU' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notBeforeDate: now, notAfterDate: until,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...addresses.map(ip => ({ type: 7 as const, ip }))] },
    ],
  });
  return { key: r.private, cert: r.cert };
}

/** SHA-256 fingerprint as the browser shows it, read from the running server itself. */
export function serverFingerprint(port: number): Promise<string | null> {
  return new Promise(resolve => {
    const s = connect({ host: '127.0.0.1', port, rejectUnauthorized: false, servername: 'localhost' }, () => {
      const fp = s.getPeerX509Certificate()?.fingerprint256 ?? null; s.end(); resolve(fp);
    });
    s.on('error', () => resolve(null));
    s.setTimeout(3000, () => { s.destroy(); resolve(null); });
  });
}
