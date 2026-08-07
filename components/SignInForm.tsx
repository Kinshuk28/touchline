'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendMagicLink, type SignInState } from '@/lib/auth/actions';

const INITIAL: SignInState = { status: 'idle', message: '', email: '' };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-13 font-semibold hover:bg-surface disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Email me a link'}
    </button>
  );
}

/**
 * The whole account surface of this site: one email address, no password.
 *
 * A client component only because it reports back — the pending state on the
 * button and the result message underneath. The submission itself is a
 * server action, so this still works with JavaScript disabled, minus the
 * "Sending…" label.
 */
export function SignInForm() {
  const [state, formAction] = useActionState(sendMagicLink, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-11 font-semibold uppercase tracking-wider text-muted">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-describedby={state.message ? 'sign-in-message' : undefined}
          aria-invalid={state.status === 'error'}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-15 outline-none focus-visible:border-text"
          placeholder="you@example.com"
        />
      </div>

      <Submit />

      {state.message && (
        <p
          id="sign-in-message"
          role="status"
          /* The status is carried by the words, not by the frame — the
             border is identical either way, so nothing here depends on
             telling two shades apart. */
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-13"
        >
          {state.status === 'sent' ? '✓ ' : ''}
          {state.message}
        </p>
      )}
    </form>
  );
}
