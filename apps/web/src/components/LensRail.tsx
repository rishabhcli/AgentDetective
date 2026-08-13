import type { LensId } from '@thread/domain';
import { Box, Clock3, FileStack, MapPinned, Network, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const lenses: Array<{ id: LensId; label: string; shortcut: string; icon: LucideIcon }> = [
  { id: 'people', label: 'People', shortcut: '01', icon: UsersRound },
  { id: 'time', label: 'Time', shortcut: '02', icon: Clock3 },
  { id: 'place', label: 'Place', shortcut: '03', icon: MapPinned },
  { id: 'objects', label: 'Objects', shortcut: '04', icon: Box },
  { id: 'evidence', label: 'Evidence', shortcut: '05', icon: FileStack },
  { id: 'theory', label: 'Theory', shortcut: '06', icon: Network },
];

interface LensRailProps {
  activeLens: LensId;
  onChange: (lens: LensId) => void;
}

export function LensRail({ activeLens, onChange }: LensRailProps) {
  return (
    <nav className="lens-rail" aria-label="Case lenses">
      {lenses.map(({ id, label, shortcut, icon: Icon }) => (
        <button
          key={id}
          className={activeLens === id ? 'is-active' : ''}
          aria-current={activeLens === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <span className="lens-number">{shortcut}</span>
          <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
