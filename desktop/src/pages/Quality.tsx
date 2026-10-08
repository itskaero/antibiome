import { useMemo, useState } from 'react';
import { ClipboardCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Chip, Empty, PageHeader } from '@/components/ui';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';

interface Issue { id: string; severity: 'error' | 'warn'; rule: string; admissionId: string | null; message: string; label: string }

export function Quality() {
  const { data } = useApi<{ issues: Issue[]; rules: Record<string, string> }>('quality.list');
  const [sev, setSev] = useState('all');
  const groups = useMemo(() => {
    const g: Record<string, Issue[]> = {};
    (data?.issues ?? []).filter(i => sev === 'all' || i.severity === sev).forEach(i => (g[i.rule] ??= []).push(i));
    return Object.entries(g).sort((a, b) => (a[1][0].severity === 'error' ? -1 : 1) - (b[1][0].severity === 'error' ? -1 : 1) || b[1].length - a[1].length);
  }, [data, sev]);
  if (!data) return null;
  const errors = data.issues.filter(i => i.severity === 'error').length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<ClipboardCheck className="text-accent-ink" size={22} />} title="Data quality"
        subtitle="Analytics are only as good as the data. Nothing here is auto-corrected — open the record and fix it, or confirm it is right."
        chips={<><Chip tone="crit">{errors} impossible</Chip><Chip tone="warn">{data.issues.length - errors} to review</Chip></>}
        actions={<ContinuousTabs size="md" tabs={[{ id: 'all', label: 'All', count: data.issues.length }, { id: 'error', label: 'Impossible', count: errors }, { id: 'warn', label: 'Review', count: data.issues.length - errors }]} value={sev} onChange={setSev} />} />
      {!groups.length && <div className="card"><Empty icon={<ClipboardCheck size={18} />} title="No data-quality warnings">Every rule passed for the records in the database.</Empty></div>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {groups.map(([rule, items]) => (
          <div key={rule} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[14px] font-semibold">
                {items[0].severity === 'error' ? <ShieldAlert size={16} className="text-crit-ink" /> : <TriangleAlert size={16} className="text-warn-ink" />}
                {data.rules[rule] ?? rule}
              </h3>
              <Chip tone={items[0].severity === 'error' ? 'crit' : 'warn'}>{items.length}</Chip>
            </div>
            <div className="scroll-thin flex max-h-72 flex-col divide-y divide-line overflow-y-auto">
              {items.map(i => (
                <button key={i.id} disabled={!i.admissionId} onClick={() => i.admissionId && go(`patient/${i.admissionId}`)}
                  className={cx('flex flex-col py-2 text-left', i.admissionId && 'hover:text-accent-ink')}>
                  <span className="text-[13px]">{i.label}</span>
                  <span className="text-[12px] text-ink-3">{i.message}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
