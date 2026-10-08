// Vendored from WatermelonUI https://ui.watermelon.sh (command-search) via its shadcn registry.
// Local changes: becomes the app-wide command palette — controlled open state, Ctrl/⌘+K and "/"
// shortcuts, free-form sections, async items (patients), app colour tokens. The morphing
// trigger → panel animation (shared layoutId) and keyboard navigation are the original's.
import { useState, useMemo, useEffect, useRef, type KeyboardEvent, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search } from 'lucide-react';

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  section: string;
  icon: ReactNode;
  shortcut?: string;
  keywords?: string;
  action: () => void;
}

interface Props {
  items: CommandItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
}

export const CommandSearch: FC<Props> = ({ items, open: isOpen, onOpenChange: setIsOpen, placeholder = 'Search patients, pages, actions…' }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) { const t = setTimeout(() => inputRef.current?.focus(), 80); return () => clearTimeout(t); }
    setQuery('');
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !isOpen)) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
      if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); setIsOpen(false); }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, setIsOpen]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.filter(i => i.section !== 'Patients').concat(items.filter(i => i.section === 'Patients').slice(0, 6));
    return items.filter(item => `${item.title} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q)).slice(0, 40);
  }, [query, items]);

  useEffect(() => { requestAnimationFrame(() => setActiveIndex(0)); }, [query]);

  const sections = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredItems.forEach(item => { (groups[item.section] ??= []).push(item); });
    return Object.entries(groups).map(([name, items]) => ({ name, items }));
  }, [filteredItems]);

  const run = (item: CommandItem) => { setIsOpen(false); setTimeout(item.action, 0); };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!filteredItems.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(p => (p + 1) % filteredItems.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(p => (p - 1 + filteredItems.length) % filteredItems.length); }
    else if (e.key === 'Enter') { const s = filteredItems[activeIndex]; if (s) run(s); }
  };

  const sharedTransition = { type: 'tween' as const, ease: 'easeOut' as const, duration: 0.15 };

  return (
    <>
      <AnimatePresence mode="popLayout">
        {isOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={() => setIsOpen(false)} />
        )}
      </AnimatePresence>

      <div className="relative z-50 h-10 w-full max-w-[420px]">
        <AnimatePresence mode="popLayout">
          {!isOpen ? (
            <motion.button key="trigger" layoutId="command-pallete" onClick={() => setIsOpen(true)} transition={sharedTransition}
              className="group absolute top-0 left-0 flex h-10 w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel px-3.5 text-ink-3 hover:text-ink-2">
              <motion.div layoutId="search-icon" transition={sharedTransition}><Search size={15} /></motion.div>
              <motion.span layoutId="search-text" transition={sharedTransition} className="pr-8 text-[13px]">{placeholder}</motion.span>
              <motion.kbd layoutId="search-shortcut" transition={sharedTransition} className="kbd absolute right-2.5">Ctrl K</motion.kbd>
            </motion.button>
          ) : (
            <motion.div layoutId="command-pallete" transition={sharedTransition} onClick={e => e.stopPropagation()}
              className="absolute -top-2 -left-2 z-50 flex max-h-[460px] w-[520px] flex-col overflow-hidden rounded-2xl border border-line-2 bg-panel shadow-[0_32px_64px_-15px_rgba(0,0,0,0.5)]">
              <div className="flex items-center border-b border-line px-4 py-3.5">
                <motion.div layoutId="search-icon" transition={sharedTransition}>
                  <Search size={17} className="mr-3 text-ink-3" strokeWidth={2.4} />
                </motion.div>
                <div className="relative flex flex-1 items-center">
                  <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
                    className="w-full bg-transparent text-[14px] font-medium text-ink outline-none" />
                  {!query && (
                    <motion.span layoutId="search-text" transition={sharedTransition} className="pointer-events-none absolute left-0 text-[14px] text-ink-3">
                      {placeholder}
                    </motion.span>
                  )}
                </div>
                <motion.span layoutId="search-shortcut" transition={sharedTransition} className="kbd ml-2">Esc</motion.span>
              </div>
              <div className="scroll-thin flex-1 overflow-y-auto p-1.5">
                {filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-sm text-ink-3">No results for “{query}”</div>
                ) : (
                  <div className="space-y-3 py-1">
                    {sections.map(section => (
                      <div key={section.name} className="space-y-0.5">
                        <h3 className="px-3 py-1 text-[10.5px] font-semibold tracking-wider text-ink-3 uppercase">{section.name}</h3>
                        {section.items.map(item => {
                          const globalIndex = filteredItems.findIndex(fi => fi.id === item.id);
                          const isActive = globalIndex === activeIndex;
                          return (
                            <button key={item.id} onMouseEnter={() => setActiveIndex(globalIndex)} onClick={() => run(item)}
                              className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ${isActive ? 'bg-panel-3 text-ink' : 'text-ink-2'}`}>
                              <div className="flex min-w-0 items-center gap-3">
                                <span className={isActive ? 'text-accent-ink' : 'text-ink-3'}>{item.icon}</span>
                                <span className="truncate text-[13.5px] font-medium">{item.title}</span>
                                {item.hint && <span className="truncate text-[12px] text-ink-3">{item.hint}</span>}
                              </div>
                              {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
