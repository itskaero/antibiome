// Therapy chart: the whole stay on one day scale. Respiratory support, each vasoactive and each
// antimicrobial as bars; cultures and events as markers; key vitals as aligned trend lanes.
// Hover any mark for the exact times.
import { useMemo } from 'react';
import { cx } from '@/lib/format';
import { RESP_LABEL, awareGroup, type RespLevel } from '@shared/reference';
import { DAY_MS, ms } from '@shared/time';
import { VITALS, type VitalCode, type VitalSet } from '@shared/vitals';
import type { Admission, ClinicalEvent, Episode } from '@shared/types';

interface Culture { id: string; collectedAt: string; specimen: string; organism: string | null; mdr?: boolean }

// Respiratory support darkens as it escalates; antimicrobials use the AWaRe colours from the stewardship page.
const RESP_COLOR: Record<string, string> = { O2: 'var(--seq-1)', HFNC: 'var(--seq-2)', NIV: 'var(--seq-3)', MV: 'var(--seq-4)' };
const AWARE_COLOR: Record<string, string> = { Access: 'var(--good)', Watch: 'var(--warn)', Reserve: 'var(--crit)', Unclassified: 'var(--text-3)' };
const VITAL_LANES: VitalCode[] = ['hr', 'sbp', 'spo2', 'temp'];

const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hhmm = (s: string) => s.replace('T', ' ').slice(0, 16);
const dur = (msv: number) => { const h = msv / 3_600_000; return h < 48 ? `${Math.max(1, Math.round(h))} h` : `${(h / 24).toFixed(1)} d`; };

export function TherapyChart({ admission, episodes, events, cultures, vitals, now = Date.now() }: {
  admission: Admission; episodes: Episode[]; events: ClinicalEvent[]; cultures: Culture[]; vitals: VitalSet[]; now?: number;
}) {
  const end = admission.dischargeAt ? ms(admission.dischargeAt) : now;
  const t0 = midnight(ms(admission.admitAt));
  const days = Math.max(1, Math.ceil((midnight(end) + DAY_MS - t0) / DAY_MS));
  const t1 = t0 + days * DAY_MS;
  const x = (t: number) => `${Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100))}%`;
  const w = (a: number, b: number) => `${Math.max(0.35, ((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * 100)}%`;
  const epEnd = (e: Episode) => (e.endAt ? ms(e.endAt) : end);

  const lanes = useMemo(() => {
    const resp = episodes.filter(e => e.kind === 'resp');
    const group = (kind: 'vaso' | 'abx') => {
      const by = new Map<string, Episode[]>();
      episodes.filter(e => e.kind === kind).sort((a, b) => a.startAt.localeCompare(b.startAt)).forEach(e => { (by.get(e.detail) ?? by.set(e.detail, []).get(e.detail)!).push(e); });
      return [...by.entries()];
    };
    return { resp, vaso: group('vaso'), abx: group('abx') };
  }, [episodes]);

  const sorted = useMemo(() => [...vitals].sort((a, b) => a.at.localeCompare(b.at)), [vitals]);
  const step = days <= 10 ? 1 : days <= 21 ? 2 : days <= 45 ? 5 : 7;
  const label = (i: number) => new Date(t0 + i * DAY_MS).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const Track = ({ children, h = 'h-7' }: { children: React.ReactNode; h?: string }) => (
    <div className={cx('relative', h)}>
      {Array.from({ length: days }, (_, i) => i % 2 === 1 && <div key={i} className="absolute inset-y-0 bg-panel-2/50" style={{ left: x(t0 + i * DAY_MS), width: w(t0 + i * DAY_MS, t0 + (i + 1) * DAY_MS) }} />)}
      {!admission.dischargeAt && <div className="absolute inset-y-0 border-l border-dashed border-accent/60" style={{ left: x(now) }} />}
      {children}
    </div>
  );
  const Row = ({ name, sub, children, h }: { name: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; h?: string }) => (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 border-t border-line/60 py-1">
      <div className="min-w-0 truncate text-[12px]">{name}{sub && <span className="block truncate text-[10.5px] text-ink-3">{sub}</span>}</div>
      <Track h={h}>{children}</Track>
    </div>
  );
  const Bar = ({ e, color, text, dark }: { e: Episode; color: string; text?: string; dark?: boolean }) => {
    const a = ms(e.startAt), b = epEnd(e);
    return (
      <div className={cx('absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-md px-1.5 text-[10.5px] font-medium whitespace-nowrap', dark ? 'text-[#0b1a33]' : 'text-white')}
        style={{ left: x(a), width: w(a, b), background: color, opacity: e.endAt ? 0.9 : 1 }}
        title={`${text ?? e.detail}: ${hhmm(e.startAt)} → ${e.endAt ? hhmm(e.endAt) : 'ongoing'} (${dur(b - a)})${e.intent ? ` · ${e.intent}` : ''}${e.endReason ? ` · ${e.endReason}` : ''}`}>
        {text}
      </div>
    );
  };

  return (
    <div className="scroll-thin overflow-x-auto">
      <div className="min-w-[680px]">
        {/* Day axis */}
        <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 pb-1">
          <span className="text-[11px] text-ink-3">{days} day{days > 1 ? 's' : ''}{admission.dischargeAt ? '' : ' · so far'}</span>
          <div className="relative h-8">
            {Array.from({ length: days }, (_, i) => i % step === 0 && (
              <div key={i} className="absolute top-0 text-[10.5px] leading-tight text-ink-3" style={{ left: x(t0 + i * DAY_MS) }}>
                <b className="font-semibold text-ink-2">D{i + 1}</b><br />{label(i)}
              </div>
            ))}
          </div>
        </div>

        <Row name="Respiratory support" sub={lanes.resp.length ? undefined : 'room air throughout'}>
          {lanes.resp.map(e => <Bar key={e.id} e={e} color={RESP_COLOR[e.detail] ?? 'var(--text-3)'} dark={e.detail === 'O2' || e.detail === 'HFNC'} text={e.detail === 'MV' ? 'Ventilated' : RESP_LABEL[e.detail as RespLevel]} />)}
        </Row>
        {lanes.vaso.map(([drug, eps]) => (
          <Row key={drug} name={drug} sub="vasoactive">{eps.map(e => <Bar key={e.id} e={e} color="var(--accent)" text={dur(epEnd(e) - ms(e.startAt))} />)}</Row>
        ))}
        {lanes.abx.map(([drug, eps]) => {
          const g = awareGroup(drug);
          const dot = eps.reduce((s, e) => s + Math.max(1, Math.round((midnight(epEnd(e)) - midnight(ms(e.startAt))) / DAY_MS) + 1), 0);
          return (
            <Row key={drug} name={drug} sub={`${g} · ${dot} day${dot > 1 ? 's' : ''} of therapy`}>
              {eps.map(e => <Bar key={e.id} e={e} color={AWARE_COLOR[g]} dark={g === 'Watch'} text={`${dur(epEnd(e) - ms(e.startAt))} · ${e.intent ?? 'empiric'}`} />)}
            </Row>
          );
        })}
        {!lanes.abx.length && <Row name="Antimicrobials" sub="none given"><span /></Row>}

        <Row name="Cultures & events">
          {events.filter(e => e.type === 'culture_sent').map(e => (
            <span key={e.id} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-info-ink bg-panel" style={{ left: x(ms(e.at)) }} title={`${e.label} · ${hhmm(e.at)}`} />
          ))}
          {cultures.map(c => {
            const t = ms(c.collectedAt.length === 10 ? `${c.collectedAt}T12:00` : c.collectedAt);
            return <span key={c.id} className={cx('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full', c.mdr ? 'bg-crit' : c.organism ? 'bg-warn' : 'bg-good')} style={{ left: x(t) }}
              title={`${c.specimen} culture ${c.collectedAt.slice(0, 10)}: ${c.organism ?? 'no growth'}${c.mdr ? ' (MDR)' : ''}`} />;
          })}
          {events.filter(e => e.type !== 'culture_sent').map(e => (
            <span key={e.id} className={cx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] leading-none', e.type === 'complication' || e.type === 'deterioration' ? 'text-warn-ink' : 'text-ink-2')}
              style={{ left: x(ms(e.at)) }} title={`${e.label} · ${hhmm(e.at)}${e.note ? ` · ${e.note}` : ''}`}>{e.type === 'complication' || e.type === 'deterioration' ? '▲' : '◆'}</span>
          ))}
        </Row>

        {VITAL_LANES.filter(c => sorted.some(s => s.values[c] != null)).map(c => {
          const pts = sorted.filter(s => s.values[c] != null).map(s => ({ t: ms(s.at), v: s.values[c]!, at: s.at }));
          const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), span = hi - lo || 1;
          const y = (v: number) => 85 - ((v - lo) / span) * 70;
          const fx = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));
          const f = (v: number) => v.toFixed(VITALS[c].decimals);
          return (
            <Row key={c} h="h-9" name={`${VITALS[c].short}${VITALS[c].unit ? ` · ${VITALS[c].unit}` : ''}`} sub={`${f(lo)}–${f(hi)} · ${pts.length} reading${pts.length > 1 ? 's' : ''}`}>
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                <polyline points={pts.map(p => `${fx(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </svg>
              {pts.map((p, i) => (
                <span key={i} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${fx(p.t)}%`, top: `${y(p.v)}%`, background: 'var(--series-1)' }}
                  title={`${VITALS[c].label} ${f(p.v)} ${VITALS[c].unit} · ${hhmm(p.at)}`} />
              ))}
            </Row>
          );
        })}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line/60 pt-3 text-[11px] text-ink-3">
          {(['O2', 'HFNC', 'NIV', 'MV'] as const).map(l => <span key={l} className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm" style={{ background: RESP_COLOR[l] }} />{l === 'MV' ? 'Ventilated' : RESP_LABEL[l]}</span>)}
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />Vasoactive</span>
          {(['Access', 'Watch', 'Reserve'] as const).map(g => <span key={g} className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm" style={{ background: AWARE_COLOR[g] }} />{g}</span>)}
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-info-ink" />culture sent</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-good" />no growth</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-warn" />growth</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-crit" />MDR</span>
          <span>▲ complication · ◆ procedure</span>
          {!admission.dischargeAt && <span className="flex items-center gap-1.5"><i className="h-3 border-l border-dashed border-accent" />now</span>}
        </div>
      </div>
    </div>
  );
}
