'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getFantasySeason } from '@/lib/site/queries/fantasy';
import { createLeague, joinLeague, leaveLeague } from '@/lib/fantasy/leagueStore';

/**
 * Creating, joining and leaving a league.
 *
 * Each returns a message rather than throwing: these are three small forms on
 * one page, and a thrown error would replace a page someone was using with an
 * error boundary over a mistyped code.
 */

export interface LeagueFormState {
  status: 'idle' | 'ok' | 'error';
  message: string;
  /** Which form the message belongs to, so one form's error is not shown under the other. */
  form: 'create' | 'join' | null;
}

// The idle state lives in components/LeagueForms.tsx, not here: a
// `'use server'` module may export only async functions, and a plain object
// export fails the build with "can only export async functions, found
// object" — at page-data collection, not at typecheck.

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give the league a name.')
  .max(40, 'League names are 40 characters or fewer.');

export async function createLeagueAction(
  _prev: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Your session expired. Sign in again.', form: 'create' };

  const parsed = nameSchema.safeParse(String(formData.get('name') ?? ''));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid name.', form: 'create' };
  }

  const season = await getFantasySeason();
  if (season === null) return { status: 'error', message: 'The season is not set up yet.', form: 'create' };

  let id: string;
  try {
    id = await createLeague(session.accessToken, session.userId, season, parsed.data);
  } catch (err) {
    return { status: 'error', message: messageFor(err), form: 'create' };
  }

  revalidatePath('/fantasy/leagues');
  redirect(`/fantasy/leagues/${id}`);
}

export async function joinLeagueAction(
  _prev: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Your session expired. Sign in again.', form: 'join' };

  // Deliberately permissive about shape — people paste codes with spaces and
  // dashes, and in lower case. The database function normalises the same way;
  // this only catches an empty box before making a round trip.
  const code = String(formData.get('code') ?? '').trim();
  if (code.length === 0) return { status: 'error', message: 'Enter a join code.', form: 'join' };

  let id: string;
  try {
    id = await joinLeague(session.accessToken, code);
  } catch (err) {
    return { status: 'error', message: messageFor(err), form: 'join' };
  }

  revalidatePath('/fantasy/leagues');
  redirect(`/fantasy/leagues/${id}`);
}

export async function leaveLeagueAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect('/fantasy/sign-in');

  const leagueId = String(formData.get('leagueId') ?? '');
  if (leagueId.length === 0) redirect('/fantasy/leagues');

  await leaveLeague(session.accessToken, leagueId, session.userId);
  revalidatePath('/fantasy/leagues');
  redirect('/fantasy/leagues');
}

/**
 * The database raises the two failures a person can actually cause — a code
 * that matches nothing, and a session that is not signed in — with messages
 * written for a person. Anything else is ours and gets a generic line,
 * because a raw Postgres error is not something to put in front of someone
 * trying to join their mate's league.
 */
function messageFor(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/No league has that code/i.test(raw)) return 'No league has that code. Check it and try again.';
  if (/Sign in to join/i.test(raw)) return 'Your session expired. Sign in again.';
  if (/does not exist|schema cache|PGRST20[25]/i.test(raw)) {
    return 'Leagues are not set up in the database yet.';
  }
  return 'Something went wrong. Try again in a moment.';
}
