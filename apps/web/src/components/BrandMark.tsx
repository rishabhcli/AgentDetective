interface BrandMarkProps {
  className?: string;
  label?: string;
}

/**
 * The raster source is an ImageGen brand exploration, cleaned and exported at
 * several deterministic sizes under public/brand. Keeping this component
 * small makes the same identity appear on landing, onboarding, and workspace.
 */
export function BrandMark({ className = '', label }: BrandMarkProps) {
  return (
    <span className={`thread-brand-mark ${className}`.trim()} aria-hidden={!label}>
      <img src="/brand/thread-mark-192.png" alt={label ?? ''} draggable={false} />
    </span>
  );
}
