'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createLeagueAction, joinLeagueAction, type LeagueFormState } from '@/lib/fantasy/leagueActions';

// Defined here rather than beside the actions: a `'use server'` module may
// export only async functions, so a shared constant cannot live there.
const IDLE_LEAGUE_STATE: LeagueFormState = { status: 'idle', message: '', form: null };

/**
 * Start a league, or join one with a code.
 *
 * Two forms with their own action state each, so a mistyped join code does
 * not put an error under the create box. Client components only for the
 * pending label and the message — both submit through server actions and
 * work without JavaScript.
 */

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-13 font-semibold hover:bg-surface disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Message({ state, form }: { state: LeagueFormState; form: 'create' | 'join' }) {
  if (state.form !== form || state.message.length === 0) return null;
  return (
    <p role="status" className="mt-2 text-13 text-muted">
      {state.message}
    </p>
  );
}

export function CreateLeagueForm() {
  const [state, action] = useActionState(createLeagueAction, IDLE_LEAGUE_STATE);
  return (
    <form action={action}>
      <label htmlFor="league-name" className="block text-11 font-semibold uppercase tracking-wider text-muted">
        Start a league
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="league-name"
          name="name"
          required
          maxLength={40}
          placeholder="Sunday five-a-side"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-15 outline-none focus-visible:border-text"
        />
        <Submit label="Create" pendingLabel="Creating…" />
      </div>
      <Message state={state} form="create" />
    </form>
  );
}

export function JoinLeagueForm() {
  const [state, action] = useActionState(joinLeagueAction, IDLE_LEAGUE_STATE);
  return (
    <form action={action}>
      <label htmlFor="join-code" className="block text-11 font-semibold uppercase tracking-wider text-muted">
        Join with a code
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="join-code"
          name="code"
          required
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD2345"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-15 uppercase outline-none focus-visible:border-text"
        />
        <Submit label="Join" pendingLabel="Joining…" />
      </div>
      <Message state={state} form="join" />
    </form>
  );
}
