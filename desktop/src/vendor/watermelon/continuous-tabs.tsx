// Vendored from WatermelonUI https://ui.watermelon.sh (continuous-tabs) via its shadcn registry.
// Local changes: controlled `value`, compact size, app colour tokens, unique layoutId per instance,
// optional counts. The sliding spring pill is unchanged.
import { useId, type FC, type ReactNode } from 'react';
import { motion, LayoutGroup } from 'motion/react';

export interface TabItem { id: string; label: ReactNode; count?: number }

interface ContinuousTabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
}

export const ContinuousTabs: FC<ContinuousTabsProps> = ({ tabs, value, onChange, size = 'sm' }) => {
  const layoutId = useId();
  return (
    <LayoutGroup id={layoutId}>
      <nav className="relative inline-flex items-center gap-0.5 rounded-full border border-line bg-panel-2 p-1">
        {tabs.map(tab => {
          const isActive = value === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`relative rounded-full outline-none ${size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-4 py-1.5 text-[13px]'}`}
            >
              {isActive && (
                <motion.div
                  layoutId="active-pill"
                  transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.9 }}
                  className="absolute inset-0 rounded-full bg-panel-3 shadow-xs ring-1 ring-line-2"
                />
              )}
              <motion.span
                layout="position"
                className={`relative z-10 inline-flex items-center gap-1.5 font-medium transition-colors duration-200 ${isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
              >
                {tab.label}
                {tab.count != null && <span className="tnum text-[10.5px] text-ink-3">{tab.count}</span>}
              </motion.span>
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
};
