import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The system's signature control: a chamfered (cut-corner) rectangle that
 * carries a real neon glow, not a skew — this brief drops Vaporwave's
 * skew/counter-skew theatrics in favour of `.cyber-cut-sm` (app/globals.css)
 * plus a stacked `box-shadow` glow, on by default at low intensity and
 * flaring up on hover/focus. One shared primitive rather than repeating
 * either treatment by hand at a dozen call sites.
 *
 * Polymorphic on `href`: with one, it's a `next/link`; without, a `<button>`
 * that forwards every native attribute (`type`, `disabled`, `onClick`, a
 * `useFormStatus` pending state), so it drops into a `<form action>` exactly
 * like a plain `<button>` would.
 */

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';
type Size = 'sm' | 'default' | 'lg';

// Each glow is a stacked box-shadow — a tight inner ring plus a wider, softer
// wash — because a single-layer shadow reads as a blur, not a light source.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'border-2 border-comp-pl bg-comp-pl text-bg ' +
    'shadow-[0_0_6px_var(--comp-pl),0_0_16px_color-mix(in_srgb,var(--comp-pl)_45%,transparent)] ' +
    'hover:shadow-[0_0_10px_var(--comp-pl),0_0_28px_color-mix(in_srgb,var(--comp-pl)_65%,transparent)]',
  secondary:
    'border-2 border-comp-sa bg-transparent text-comp-sa ' +
    'shadow-[0_0_5px_color-mix(in_srgb,var(--comp-sa)_50%,transparent)] ' +
    'hover:bg-comp-sa hover:text-bg hover:shadow-[0_0_10px_var(--comp-sa),0_0_28px_color-mix(in_srgb,var(--comp-sa)_65%,transparent)]',
  outline:
    'border-2 border-comp-pd bg-transparent text-comp-pd ' +
    'shadow-[0_0_5px_color-mix(in_srgb,var(--comp-pd)_50%,transparent)] ' +
    'hover:bg-comp-pd hover:text-bg hover:shadow-[0_0_10px_var(--comp-pd),0_0_28px_color-mix(in_srgb,var(--comp-pd)_65%,transparent)]',
  ghost:
    'border-2 border-transparent text-text ' +
    'hover:border-comp-pl/40 hover:bg-comp-pl/10 hover:text-comp-pl',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-9 px-3 text-11',
  default: 'h-11 px-4 text-13',
  lg: 'h-14 px-6 text-15',
};

const BASE =
  'cyber-cut-sm inline-flex shrink-0 items-center justify-center gap-1.5 ' +
  'font-mono font-semibold uppercase tracking-wider transition-all duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none';

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function Button({
  href,
  variant = 'primary',
  size = 'default',
  className = '',
  children,
  ...rest
}: CommonProps & { href?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  const cls = `${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
