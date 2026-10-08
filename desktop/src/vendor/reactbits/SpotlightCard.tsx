// Vendored from ReactBits https://reactbits.dev (SpotlightCard-TS-TW) via its shadcn registry.
// Local changes: themed surface via app tokens instead of fixed neutral-900; padding left to the caller;
// accepts onClick / extra props so it can act as a KPI tile.
import React, { useRef, useState } from 'react';

interface Position { x: number; y: number }

interface SpotlightCardProps extends React.PropsWithChildren, Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  className?: string;
  spotlightColor?: string;
}

const SpotlightCard: React.FC<SpotlightCardProps> = ({ children, className = '', spotlightColor = 'rgba(242, 107, 58, 0.10)', ...rest }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState<number>(0);

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = e => {
    if (!divRef.current || isFocused) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onFocus={() => { setIsFocused(true); setOpacity(0.6); }}
      onBlur={() => { setIsFocused(false); setOpacity(0); }}
      onMouseEnter={() => setOpacity(0.6)}
      onMouseLeave={() => setOpacity(0)}
      className={`card relative overflow-hidden ${className}`}
      {...rest}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-in-out"
        style={{ opacity, background: `radial-gradient(circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 80%)` }}
      />
      {children}
    </div>
  );
};

export default SpotlightCard;
