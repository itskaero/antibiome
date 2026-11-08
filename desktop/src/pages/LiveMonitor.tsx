import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, ClipboardPlus, FolderOpen, HeartPulse, PlayCircle, Radio, Settings2, ShieldAlert, StopCircle, Thermometer, Wifi, WifiOff } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { ageFrom, useMonitorBeds, type BedSnapshot, type MonitorStatus, type Param, type TrendPoint } from '@/lib/monitor';
import { BodyMap, RangeBars, SENSOR_SPOTS, TickGauge, VitalTile, Waveform, WAVE_COLOR } from '@/components/monitor';
import { Button, Chip, Empty, Field, Modal, PageHeader, Toggle, useToast } from '@/components/ui';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { fmtAge, nowLocal } from '@shared/time';
import { dxLabel } from '@shared/reference';
import type { CensusRow } from './types';

type Status = MonitorStatus & { enabled: boolean; recordDir: string };
type NV = NonNullable<BedSnapshot['values'][Param]>;

const val = (v?: NV | null) => (v?.value ?? null);
const outside = (v?: NV | null) => v?.value != null && v.alarmOn && ((v.high != null && v.value > v.high) || (v.low != null && v.value < v.low));
const show = (v: number | null, digits = 0) => (v == null ? '--' : digits ? v.toFixed(digits) : String(Math.round(v)));
const bedTitle = (b: BedSnapshot) => (b.source === 'demo' ? `Demo ${b.bed - 100}` : `Bed ${b.bed}`);
const sinceLabel = (t: number | null) => {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

export function LiveMonitor({ args, isAdmin, canChart }: { args: string[]; isAdmin: boolean; canChart: boolean }) {
  const { beds } = useMonitorBeds();
  const status = useApi<Status>('desktop.monitorStatus');
  const census = useApi<{ rows: CensusRow[] }>('census.list');
  useEffect(() => { const t = setInterval(status.reload, 5000); return () => clearInterval(t); }, [status.reload]);
  const byBed = useMemo(() => new Map((census.data?.rows ?? []).filter(r => r.admission.bed).map(r => [String(r.admission.bed), r])), [census.data]);
  const focus = args[0] ? beds.find(b => String(b.bed) === args[0]) : null;

  if (args[0]) {
    if (!focus) return <Empty icon={<WifiOff size={18} />} title={`No data from bed ${args[0]}`}><Button size="sm" onClick={() => go('monitor')}><ArrowLeft size={14} />All beds</Button></Empty>;
    return <BedFocus b={focus} adm={focus.source === 'network' ? byBed.get(String(focus.bed)) ?? null : null} canChart={canChart} />;
  }

  const live = beds.filter(b => !b.stale).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<HeartPulse className="text-accent-ink" size={22} />} title="Live monitor"
        subtitle="Vital signs streamed from the bedside monitors on the unit network. A secondary display — alarms stay on the monitors."
        chips={<>
          <Chip tone={status.data?.running ? 'good' : 'neutral'} dot>{status.data?.running ? `Receiver on · ${status.data.listening} ports` : 'Receiver off'}</Chip>
          {status.data?.demo && <Chip tone="info" dot>Demo beds</Chip>}
          <Chip tone="accent">{live} live / {beds.length} monitors</Chip>
          {status.data?.recording && <Chip tone="crit" dot>Recording raw data</Chip>}
        </>}
        actions={status.data && <ReceiverControls s={status.data} isAdmin={isAdmin} reload={status.reload} />} />

      <SafetyNote />
      {status.data && !beds.length && <Setup s={status.data} />}
      {status.data && status.data.failed.length > 0 && status.data.running && (
        <p className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">
          <CircleAlert size={14} />{status.data.failed.length} port{status.data.failed.length > 1 ? 's' : ''} could not be opened ({status.data.failed.slice(0, 3).map(f => f.port).join(', ')}{status.data.failed.length > 3 ? '…' : ''}): {status.data.failed[0].error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {beds.map((b, i) => <BedCard key={b.bed} b={b} i={i} adm={b.source === 'network' ? byBed.get(String(b.bed)) ?? null : null} />)}
      </div>
    </div>
  );
}

function SafetyNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn-ink" />
      <span>For viewing trends away from the bedside — not an alarm system. SpO₂, pulse rate and temperature are decoded and checked against a real capture.
        Heart rate (ECG) and NIBP are marked <b>unverified</b> until a capture with ECG leads attached and an NIBP reading confirms their position.</span>
    </p>
  );
}

// ── Receiver controls & first-run checklist ──────────────────

function ReceiverControls({ s, isAdmin, reload }: { s: Status; isAdmin: boolean; reload: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const run = async (method: string, params: unknown, msg?: string) => {
    try { await call(method, params); if (msg) toast(msg); } catch (e: any) { toast(e.message, 'crit'); }
    reload();
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => run('desktop.monitorDemo', { on: !s.demo })}><PlayCircle size={15} />{s.demo ? 'Hide demo' : 'Demo'}</Button>
      {isAdmin && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Settings2 size={15} />Receiver</Button>}
      {isAdmin && (s.running
        ? <Button size="sm" variant="danger" onClick={() => run('desktop.monitorConfigure', { enabled: false }, 'Receiver stopped')}><StopCircle size={15} />Stop</Button>
        : <Button size="sm" variant="primary" onClick={() => run('desktop.monitorConfigure', { enabled: true }, 'Receiver started')}><Radio size={15} />Start receiver</Button>)}
      {open && <ReceiverSettings s={s} onClose={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function ReceiverSettings({ s, onClose }: { s: Status; onClose: () => void }) {
  const toast = useToast();
  const [base, setBase] = useState(String(s.config.basePort));
  const [max, setMax] = useState(String(s.config.maxBed));
  const [timeSync, setTimeSync] = useState(s.config.timeSync);
  const save = async () => {
    try { await call('desktop.monitorConfigure', { enabled: true, basePort: Number(base), maxBed: Number(max), timeSync }); toast('Receiver settings saved'); onClose(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <Modal open onClose={onClose} title="Monitor receiver" subtitle="How the bedside monitors reach this PC." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save & start</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base port" hint="Bed n connects to base + n (514 = bed 4)."><input className="field tnum" value={base} onChange={e => setBase(e.target.value)} /></Field>
          <Field label="Highest bed number"><input className="field tnum" value={max} onChange={e => setMax(e.target.value)} /></Field>
        </div>
        <Toggle checked={timeSync} onChange={setTimeSync} label="Set the monitors' clocks when they connect (as the central station does)" />
        <div className="inset flex flex-col gap-2 p-3.5 text-[12.5px]">
          <span className="font-medium">Protocol verification</span>
          <span className="text-ink-3">Saves the raw stream from each monitor to the data folder so HR and NIBP decoding can be confirmed. The files contain patient names — keep them on this PC.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => { await call('desktop.monitorRecord', { on: !s.recording }); onClose(); }}>{s.recording ? 'Stop recording' : 'Record raw data'}</Button>
            <Button size="sm" variant="ghost" onClick={() => call('desktop.monitorOpenRecordings')}><FolderOpen size={14} />Open folder</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Setup({ s }: { s: Status }) {
  const steps: { ok: boolean; title: string; detail: string }[] = [
    { ok: s.hasMonitorAddress, title: 'This PC has the central-station address 192.168.10.251', detail: s.hasMonitorAddress ? 'Found on a network adapter.' : `This PC has ${s.addresses.join(', ') || 'no network address'}. Add 192.168.10.251 / 255.255.255.0 (Network adapter → IPv4 → Advanced → Add).` },
    { ok: s.running && s.listening > 0, title: 'The receiver is listening', detail: s.running ? `${s.listening} ports open (${s.config.basePort + 1}–${s.config.basePort + s.config.maxBed}).` : 'An administrator starts it with "Start receiver". Close the old central station (CMS.exe) first — both cannot use the same ports.' },
    { ok: false, title: 'Monitors connect', detail: 'Each monitor reconnects within a few seconds of the receiver starting. Allow the app through Windows Firewall if asked.' },
  ];
  return (
    <div className="card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-[14.5px] font-semibold"><Wifi size={16} className="text-ink-3" />No monitors yet</h3>
      <ol className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3">
            {st.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good-ink" /> : <span className="tnum mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-line-2 text-[10.5px] text-ink-3">{i + 1}</span>}
            <span><span className="block text-[13px] font-medium">{st.title}</span><span className="block text-[12.5px] text-ink-3">{st.detail}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12.5px] text-ink-3">Press <b>Demo</b> to see the screen with synthetic beds.</p>
    </div>
  );
}

// ── Overview card ────────────────────────────────────────────

function BedCard({ b, i, adm }: { b: BedSnapshot; i: number; adm: CensusRow | null }) {
  const v = b.values;
  const alarm = (['spo2', 'pr', 'hr', 't1'] as Param[]).some(p => outside(v[p]));
  return (
    <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} onClick={() => go(`monitor/${b.bed}`)}
      className={cx('card group flex flex-col gap-3 p-4 text-left transition hover:border-line-2', alarm && 'border-crit/50', b.stale && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="tnum rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{bedTitle(b)}</span>
            <span className="truncate text-[14px] font-semibold">{b.patient?.name ?? 'Unnamed patient'}</span>
          </div>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{adm ? `${adm.name ?? adm.label} · ${dxLabel(adm.admission.primaryDx)}` : b.source === 'demo' ? 'Synthetic data' : 'Not matched to a census bed'}</span>
        </div>
        <ConnDot b={b} />
      </div>
      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
        <MiniStat label="SpO₂" unit="%" v={v.spo2} big tone="teal" />
        <MiniStat label="PR" unit="bpm" v={v.pr} />
        <MiniStat label="Temp" unit="°C" v={v.t1} digits={1} />
      </div>
      <div className="overflow-hidden rounded-xl bg-[#0b1214]">
        {b.probeOff ? <div className="grid h-[52px] place-items-center text-[11.5px] text-white/50">SpO₂ probe off</div> : <Waveform bed={b.bed} kind="pleth" height={52} speed={90} />}
      </div>
    </motion.button>
  );
}

function MiniStat({ label, unit, v, digits = 0, big, tone }: { label: string; unit: string; v?: NV; digits?: number; big?: boolean; tone?: 'teal' }) {
  const value = val(v), bad = outside(v);
  return (
    <div className={cx('rounded-2xl px-3 py-2', bad ? 'bg-crit-soft text-crit-ink' : tone === 'teal' && value != null ? 'text-white' : 'bg-panel-2')}
      style={!bad && tone === 'teal' && value != null ? { background: 'linear-gradient(140deg,#2dd4bf,#0891b2)' } : undefined}>
      <div className={cx('text-[11px] font-medium', !bad && tone === 'teal' && value != null ? 'text-white/85' : 'text-ink-3')}>{label}</div>
      <div className="flex items-baseline gap-1"><span className={cx('tnum font-semibold leading-tight', big ? 'text-[28px]' : 'text-[22px]')}>{show(value, digits)}</span><span className="text-[11px] opacity-70">{unit}</span></div>
    </div>
  );
}

function ConnDot({ b }: { b: BedSnapshot }) {
  return b.stale
    ? <Chip tone="warn" dot>{b.connected ? 'No data' : 'Offline'}</Chip>
    : <span className="flex items-center gap-1.5 text-[11.5px] text-good-ink"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-good" /></span>Live</span>;
}

// ── Focus view (one bed) ─────────────────────────────────────

function BedFocus({ b, adm, canChart }: { b: BedSnapshot; adm: CensusRow | null; canChart: boolean }) {
  const v = b.values;
  const trend = useApi<Partial<Record<Param, TrendPoint[]>>>('desktop.monitorTrend', { bed: b.bed });
  useEffect(() => { const t = setInterval(trend.reload, 30_000); return () => clearInterval(t); }, [trend.reload]);
  const [trendParam, setTrendParam] = useState<'pr' | 'spo2' | 'hr' | 't1'>('pr');
  const [chartOpen, setChartOpen] = useState(false);
  const ageMonths = ageFrom(b.patient?.birthDate);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nibp = [val(v.sys), val(v.dia)];
  const tempTone = outside(v.t1) ? 'alert' : 'teal';
  const sensors = [
    { id: 'ecg', label: 'ECG', ...SENSOR_SPOTS.ecg, on: !b.leadsOff && !b.stale },
    { id: 'spo2', label: 'SpO₂', ...SENSOR_SPOTS.spo2, on: !b.probeOff && !b.stale },
    { id: 'nibp', label: 'NIBP', ...SENSOR_SPOTS.nibp, on: val(v.sys) != null },
    { id: 'temp', label: 'Temp', ...SENSOR_SPOTS.temp, on: val(v.t1) != null },
  ];
  const trendDefs = { pr: { label: 'Pulse rate', unit: 'bpm', color: 'var(--series-3)' }, spo2: { label: 'SpO₂', unit: '%', color: '#06b6d4' }, hr: { label: 'Heart rate', unit: 'bpm', color: '#34d399' }, t1: { label: 'Temperature', unit: '°C', color: '#f59e0b' } } as const;
  const tp = trend.data?.[trendParam] ?? [];
  const avg = tp.length ? Math.round(tp.reduce((s, p) => s + p.mean, 0) / tp.length * 10) / 10 : null;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={() => go('monitor')} className="mb-2 flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={14} />All monitors</button>
            <p className="text-[13px] text-ink-3">{greeting},</p>
            <h1 className="truncate text-[30px] leading-tight font-semibold tracking-tight">{b.patient?.name ?? 'Unnamed patient'}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip tone="accent">{bedTitle(b)}</Chip>
              <ConnDot b={b} />
              {adm && <Chip>{adm.name ?? adm.label} · {dxLabel(adm.admission.primaryDx)}</Chip>}
              {b.remote && b.source === 'network' && <Chip>{b.remote}</Chip>}
            </div>
          </div>
          {canChart && adm && <Button variant="primary" onClick={() => setChartOpen(true)}><ClipboardPlus size={16} />Record in chart</Button>}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact value={ageMonths != null ? fmtAge(ageMonths) : '—'} label="Age" />
          <Fact value={b.patient?.admitDate ? new Date(`${b.patient.admitDate}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'} label="Admitted (monitor)" />
          <Fact value={sinceLabel(b.connectedAt)} label="Connected" />
          <Fact value={b.lastFrameAt ? sinceLabel(b.lastFrameAt) : '—'} label="Last data" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <VitalTile tone={tempTone} title="Temperature" sub={v.t1?.high != null ? `Limits ${v.t1.low}–${v.t1.high} °C` : undefined} value={show(val(v.t1), 1)} unit="°C">
            <TickGauge value={val(v.t1)} min={34} max={41} />
          </VitalTile>
          <VitalTile tone={outside(v.spo2) ? 'alert' : 'sky'} title="Oxygen saturation" sub={v.spo2?.low != null ? `Alarm below ${v.spo2.low}%` : undefined} value={show(val(v.spo2))} unit="%" />
          <VitalTile title="Pulse rate" sub={b.probeOff ? 'Probe off' : v.pr?.high != null ? `Limits ${v.pr.low}–${v.pr.high}` : undefined} value={show(val(v.pr))} unit="bpm"
            badge={outside(v.pr) ? <Chip tone="crit">Outside limits</Chip> : undefined} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <VitalTile title={<span className="flex items-center gap-1.5"><HeartPulse size={14} />Heart rate (ECG)</span>} sub={b.leadsOff ? 'Leads off' : undefined} value={show(val(v.hr))} unit="bpm" badge={<Chip tone="warn">Unverified</Chip>} />
          <VitalTile title="Blood pressure (NIBP)" sub={val(v.mean) != null ? `Mean ${val(v.mean)} mmHg` : 'No reading yet'} value={nibp[0] == null ? '--/--' : `${nibp[0]}/${show(nibp[1])}`} unit="mmHg" badge={<Chip tone="warn">Unverified</Chip>} />
        </div>

        <div className="overflow-hidden rounded-[20px] border border-line bg-[#0b1214] p-3">
          <div className="mb-1 flex items-center justify-between px-1 text-[11.5px] text-white/60"><span className="flex items-center gap-1.5"><Activity size={13} />Live waveforms</span><span>{b.stale ? 'Paused — no data' : '≈ 0.5 s behind the monitor'}</span></div>
          {b.leadsOff ? <Flat label="ECG II · leads off" color={WAVE_COLOR.ecg} /> : <Waveform bed={b.bed} kind="ecg" height={96} speed={140} label="ECG II" />}
          {b.probeOff ? <Flat label="Pleth · probe off" color={WAVE_COLOR.pleth} /> : <Waveform bed={b.bed} kind="pleth" height={80} speed={110} label="Pleth" />}
          <Waveform bed={b.bed} kind="resp" height={56} speed={45} label="Resp" />
        </div>

        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14.5px] font-semibold">{trendDefs[trendParam].label}</h3>
              <p className="tnum text-[12px] text-ink-3">{avg != null ? `${avg} ${trendDefs[trendParam].unit} average · min–max per 5 minutes` : 'Min–max per 5 minutes'}</p>
            </div>
            <ContinuousTabs tabs={[{ id: 'pr', label: 'Pulse' }, { id: 'spo2', label: 'SpO₂' }, { id: 't1', label: 'Temp' }, { id: 'hr', label: 'HR' }]} value={trendParam} onChange={x => setTrendParam(x as typeof trendParam)} />
          </div>
          <RangeBars points={tp} color={trendDefs[trendParam].color} unit={trendDefs[trendParam].unit} />
        </div>
      </div>

      <div className="xl:sticky xl:top-0 xl:h-[660px]"><BodyMap sensors={sensors}>
        <div className="absolute top-4 right-4 left-4 flex items-center justify-between text-[12px] text-ink-3"><span>Sensors</span><span>{sensors.filter(s => s.on).length} of {sensors.length} live</span></div>
        <div className="card absolute right-4 bottom-14 w-[140px] p-3">
          <div className="text-[12.5px] font-semibold">Oxygen level</div>
          <div className="mt-2 text-[11px] text-ink-3">SpO₂</div>
          <div className="flex items-baseline gap-1"><span className="tnum text-[30px] leading-none font-semibold">{show(val(v.spo2))}</span><span className="text-[12px] text-ink-3">%</span></div>
        </div>
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5">
          {sensors.map(s => <Chip key={s.id} tone={s.on ? 'good' : 'neutral'} dot>{s.label}</Chip>)}
        </div>
      </BodyMap></div>

      {chartOpen && adm && <RecordModal b={b} adm={adm} onClose={() => setChartOpen(false)} />}
    </div>
  );
}

const Fact = ({ value, label }: { value: string; label: string }) => (
  <div><div className="tnum text-[22px] font-semibold tracking-tight">{value}</div><div className="text-[12px] text-ink-3">{label}</div></div>
);
const Flat = ({ label, color }: { label: string; color: string }) => (
  <div className="relative h-[56px]"><span className="absolute top-1 left-2 text-[10.5px] font-semibold" style={{ color }}>{label}</span><div className="absolute top-1/2 right-2 left-2 border-t border-dashed" style={{ borderColor: color, opacity: 0.35 }} /></div>
);

// ── Copy current readings into the patient's vitals ──────────

function RecordModal({ b, adm, onClose }: { b: BedSnapshot; adm: CensusRow; onClose: () => void }) {
  const toast = useToast();
  const v = b.values;
  const rows = [
    { code: 'spo2', label: 'SpO₂', value: val(v.spo2), unit: '%', verified: true },
    { code: 'hr', label: 'Heart rate (from pulse rate)', value: val(v.pr), unit: '/min', verified: true },
    { code: 'temp', label: 'Temperature', value: val(v.t1), unit: '°C', verified: true },
    { code: 'sbp', label: 'Systolic BP', value: val(v.sys), unit: 'mmHg', verified: false },
    { code: 'dbp', label: 'Diastolic BP', value: val(v.dia), unit: 'mmHg', verified: false },
  ].filter(r => r.value != null);
  const [pick, setPick] = useState(() => new Set(rows.filter(r => r.verified).map(r => r.code)));
  const save = async () => {
    const values = Object.fromEntries(rows.filter(r => pick.has(r.code)).map(r => [r.code, r.value]));
    try { await call('vitals.add', { admissionId: adm.admission.id, at: nowLocal(), context: 'routine', values }); toast(`Vitals recorded for ${adm.name ?? adm.label}`); onClose(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <Modal open onClose={onClose} title="Record in chart" subtitle={`${bedTitle(b)} → ${adm.name ?? adm.label}. Check the monitor shows the same values before saving.`} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick.size} onClick={save}>Save {pick.size} value{pick.size === 1 ? '' : 's'}</Button></>}>
      {!rows.length ? <p className="text-[13px] text-ink-3">No readings to record right now.</p> : (
        <div className="flex flex-col gap-1.5">
          {rows.map(r => (
            <label key={r.code} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-panel-2">
              <input type="checkbox" checked={pick.has(r.code)} onChange={e => { const n = new Set(pick); if (e.target.checked) n.add(r.code); else n.delete(r.code); setPick(n); }} />
              <span className="flex-1 text-[13px]">{r.label}{!r.verified && <span className="ml-2 text-[11.5px] text-warn-ink">unverified decoding</span>}</span>
              <span className="tnum text-[14px] font-semibold">{r.value}<span className="ml-1 text-[11.5px] font-normal text-ink-3">{r.unit}</span></span>
            </label>
          ))}
        </div>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-3"><Thermometer size={12} />Saved as a routine set at the current time; the usual range checks apply.</p>
    </Modal>
  );
}
