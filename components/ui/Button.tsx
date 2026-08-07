import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The system's signature interaction: a skewed rectangle that snaps upright
 * on hover while filling with neon. One shared primitive rather than the
 * skew/counter-skew markup repeated at every call site — the previous
 * (turf-and-chalk) system had no such component because it never needed
 * one; this system's buttons are theatrical enough that copying the
 * transform by hand at a dozen call sites would drift the first time one of
 * them got tweaked.
 *
 * Polymorphic on `href`: with one, it's a `next/link`; without, a `<button>`
 * that forwards every native attribute (`type`, `disabled`, `onClick`, a
 * `useFormStatus` pending state), so it drops into a `<form action>` exactly
 * like a plain `<button>` would.
 */

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';
type Size = 'sm' | 'default' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'border-2 border-comp-pd bg-transparent text-comp-pd ' +
    'hover:bg-comp-pd hover:text-bg hover:shadow-[0_0_20px_var(--comp-pd)]',
  secondary:
    'border-2 border-comp-pl bg-comp-pl text-bg ' +
    'hover:scale-105 hover:opacity-90 hover:shadow-[0_0_20px_var(--comp-pl)]',
  outline:
    'border-2 border-comp-pl bg-transparent text-comp-pl ' +
    'hover:bg-comp-pl hover:text-bg hover:shadow-[0_0_20px_var(--comp-pl)]',
  ghost:
    'border-2 border-transparent text-text ' +
    'hover:border-comp-pd/40 hover:bg-comp-pd/10 hover:text-comp-pd',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-9 px-3 text-11',
  default: 'h-11 px-4 text-13',
  lg: 'h-14 px-6 text-15',
};

const BASE =
  '-skew-x-12 transform inline-flex shrink-0 items-center justify-center gap-1.5 ' +
  'font-mono font-semibold uppercase tracking-wider transition-all duration-200 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100';

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
  // The un-skew is on the inner span, never the outer element: skewing the
  // element that also carries the border would skew the border with it, and
  // a rectangle whose top and bottom edges tilt in opposite directions from
  // its own text reads as broken, not stylised.
  const inner = <span className="inline-block skew-x-12 transform">{children}</span>;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {inner}
    </button>
  );
}
