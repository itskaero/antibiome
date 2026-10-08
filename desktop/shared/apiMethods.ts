// Methods that only read. Everything else is a mutation: the UI reloads open views after it,
// and the PC broadcasts "data changed" to every connected phone (and vice versa).
export const READ_METHODS = new Set(['auth.status', 'census.list', 'patient.lookup', 'admission.get', 'culture.list', 'micro.summary', 'dashboard.get',
  'stewardship.get', 'quality.list', 'activity.list', 'recent.list', 'users.list', 'settings.get', 'desktop.info', 'export.deidentified',
  'modules.list', 'values.forAdmission', 'research.module', 'explorer.fields', 'explorer.run', 'cohorts.list', 'protocols.list', 'protocols.results',
  'ai.status', 'ai.ask', 'vitals.forAdmission', 'mobile.devices', 'desktop.mobileStatus']);
/** Mutations that change no clinical data (no need to refresh other devices). */
export const QUIET_METHODS = new Set(['auth.login', 'auth.logout', 'auth.unpairDevice', 'auth.changePassword', 'mobile.pairingCode', 'desktop.saveCsv', 'desktop.print', 'desktop.openDataFolder', 'desktop.backupNow']);
export const isRead = (m: string) => READ_METHODS.has(m);
