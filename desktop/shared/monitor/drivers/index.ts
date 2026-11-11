import { ddtDriver } from './ddt';
import { hl7Driver } from './hl7';
import type { MonitorDriver } from './types';

export * from './types';
/** Every monitor protocol the app can receive. Add new drivers here. */
export const DRIVERS: MonitorDriver[] = [ddtDriver, hl7Driver];
export const driverById = (id: string) => DRIVERS.find(d => d.id === id) ?? null;
export const DRIVER_INFO = DRIVERS.map(d => ({ id: d.id, label: d.label, description: d.description, defaultPorts: d.defaultPorts, bedInData: d.bedInData }));
