'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveSquadAction, type SaveState } from '@/lib/fantasy/pickerActions';
import {
  BUDGET_TENTHS,
  MAX_PER_CLUB,
  POSITIONS,
  POSITION_LABELS,
  SQUAD_SHAPE,
  SQUAD_SIZE,
  STARTING_SLOTS,
  canStillCompleteFormation,
  countByPosition,
  formationName,
  formatPrice,
  lineupErrors,
  selectionErrors,
  totalCost,
  type FantasyPosition,
  type PickablePlayer,
} from '@/lib/fantasy/squadRules';
import type { PoolPlayer } from '@/lib/site/queries/fantasy';

/*
 * The picker.
 *
 * This is the one genuinely interactive surface on the site, and the only
 * client component that holds real state — every other page is server-
 * rendered from stored data. The justification is narrow and specific:
 * picking a squad means seeing the budget move as you click, and a
 * round trip per selection would make a fifteen-player build unusable.
 *
 * The rules come from lib/fantasy/squadRules.ts, the same module the server
 * action re-checks with. Nothing here is a security control — see
 * lib/fantasy/pickerActions.ts. What it *is* is a teacher: every button that
 * cannot be pressed says why, so the rules are learned by using the thing
 * rather than by reading a page of them first.
 */

export interface PickerInitial {
  name: string;
  starters: number[];
  bench: number[];
  captainId: number | null;
  viceCaptainId: number | null;
}

const INITIAL_SAVE: SaveState = { status: 'idle', errors: [], message: '' };
const LIST_LIMIT = 50;

/**
 * `price-asc` is not a nicety. The list shows the first 50 matches, so
 * without a cheapest-first order the bottom of the market is unreachable
 * except by guessing names — and building a legal squad inside the budget
 * means finding cheap players on purpose, not by accident.
 */
type SortKey = 'price-desc' | 'price-asc' | 'points' | 'name';

export function SquadPicker({
  pool,
  initial,
  gameweekLabel,
}: {
  pool: PoolPlayer[];
  initial: PickerInitial | null;
  /** e.g. "Gameweek 5 — deadline in 3 days". Rendered as given. */
  gameweekLabel: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? 'My squad');
  const [starters, setStarters] = useState<number[]>(initial?.starters ?? []);
  const [bench, setBench] = useState<number[]>(initial?.bench ?? []);
  const [captainId, setCaptainId] = useState<number | null>(initial?.captainId ?? null);
  const [viceCaptainId, setViceCaptainId] = useState<number | null>(initial?.viceCaptainId ?? null);

  const [tab, setTab] = useState<FantasyPosition | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('price-desc');

  const [saveState, saveAction] = useActionState(saveSquadAction, INITIAL_SAVE);

  const byId = useMemo(() => new Map(pool.map((p) => [p.playerId, p])), [pool]);
  const selectedIds = useMemo(() => [...starters, ...bench], [starters, bench]);
  const selected = useMemo(
    () => selectedIds.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; }),
    [selectedIds, byId],
  );

  const spent = totalCost(selected);
  const remaining = BUDGET_TENTHS - spent;
  const squadCounts = countByPosition(selected);
  const startingPlayers = starters.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; });
  const clubTally = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of selected) {
      if (p.teamId === null) continue;
      counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
    }
    return counts;
  }, [selected]);

  const problems = useMemo(() => {
    const nameOf = (id: number) => pool.find((p) => p.teamId === id)?.teamName ?? `club ${id}`;
    const squadProblems = selectionErrors(selected).map((e) =>
      e.replace(/club (\d+)/, (_, id: string) => nameOf(Number(id))),
    );
    // Lineup problems only once there is a full squad to arrange — telling
    // someone their formation is wrong while they are four players short is
    // noise, not help.
    const lineupProblems = selected.length === SQUAD_SIZE
      ? lineupErrors(startingPlayers, { captainId, viceCaptainId })
      : [];
    return [...squadProblems, ...lineupProblems];
  }, [selected, startingPlayers, captainId, viceCaptainId, pool]);

  const isLegal = problems.length === 0 && name.trim().length > 0;

  /** Why this player cannot be added, or null when they can. */
  function blockedReason(player: PoolPlayer): string | null {
    if (selectedIds.includes(player.playerId)) return 'Already picked';
    if (selected.length >= SQUAD_SIZE) return 'Squad full';
    if (squadCounts[player.position] >= SQUAD_SHAPE[player.position]) {
      return `You already have ${SQUAD_SHAPE[player.position]} ${POSITION_LABELS[player.position].toLowerCase()}`;
    }
    if (player.priceTenths > remaining) {
      return `${formatPrice(player.priceTenths - remaining)} short`;
    }
    if (player.teamId !== null && (clubTally.get(player.teamId) ?? 0) >= MAX_PER_CLUB) {
      return `Already ${MAX_PER_CLUB} from ${player.teamName ?? 'that club'}`;
    }
    return null;
  }

  function add(player: PoolPlayer) {
    if (blockedReason(player) !== null) return;
    // Into the eleven when the eleven can still *finish* legal with them in
    // it, onto the bench otherwise. Checking only this position's maximum
    // is not enough: eleven keepers, defenders and midfielders all sit
    // inside their own limits and leave no room for the forward every legal
    // formation requires. Either way the manager can move anyone afterwards;
    // this is just the arrangement that needs the fewest corrections.
    const withPlayer = countByPosition(startingPlayers);
    withPlayer[player.position] += 1;
    const canStart = starters.length < STARTING_SLOTS && canStillCompleteFormation(withPlayer);
    if (canStart) setStarters((s) => [...s, player.playerId]);
    else if (bench.length < SQUAD_SIZE - STARTING_SLOTS) setBench((b) => [...b, player.playerId]);
    else setStarters((s) => [...s, player.playerId]);
  }

  function remove(id: number) {
    setStarters((s) => s.filter((x) => x !== id));
    setBench((b) => b.filter((x) => x !== id));
    if (captainId === id) setCaptainId(null);
    if (viceCaptainId === id) setViceCaptainId(null);
  }

  function toggleStarting(id: number) {
    if (starters.includes(id)) {
      setStarters((s) => s.filter((x) => x !== id));
      setBench((b) => [...b, id]);
      // An armband on the bench doubles nothing, so it is dropped rather
      // than left somewhere it cannot pay.
      if (captainId === id) setCaptainId(null);
      if (viceCaptainId === id) setViceCaptainId(null);
    } else {
      setBench((b) => b.filter((x) => x !== id));
      setStarters((s) => [...s, id]);
    }
  }

  function moveBench(id: number, delta: -1 | 1) {
    setBench((b) => {
      const i = b.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= b.length) return b;
      const next = [...b];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function setArmband(id: number, role: 'C' | 'V') {
    if (role === 'C') {
      setCaptainId((current) => (current === id ? null : id));
      if (viceCaptainId === id) setViceCaptainId(null);
    } else {
      setViceCaptainId((current) => (current === id ? null : id));
      if (captainId === id) setCaptainId(null);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = pool.filter((p) => {
      if (tab !== 'ALL' && p.position !== tab) return false;
      if (needle.length === 0) return true;
      return p.name.toLowerCase().includes(needle) || (p.teamName ?? '').toLowerCase().includes(needle);
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'points') return (b.seasonPoints ?? -1) - (a.seasonPoints ?? -1);
      if (sort === 'price-asc') return a.priceTenths - b.priceTenths;
      return b.priceTenths - a.priceTenths;
    });
    return { rows: sorted.slice(0, LIST_LIMIT), total: sorted.length };
  }, [pool, tab, query, sort]);

  const payload = JSON.stringify({ name: name.trim(), starters, bench, captainId, viceCaptainId });

  return (
    <div className="space-y-3">
      <SummaryBar
        name={name}
        onName={setName}
        spent={spent}
        remaining={remaining}
        picked={selected.length}
        formation={starters.length === STARTING_SLOTS ? formationName(countByPosition(startingPlayers)) : null}
        gameweekLabel={gameweekLabel}
      />

      {/* Silent until there is something to be wrong about. A manager who
          has just arrived does not need to be told their empty squad is
          empty — the panel below says what to do in prose. */}
      {((problems.length > 0 && selected.length > 0) || saveState.message) && (
        <div role="status" className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-13">
          {saveState.message && <p className="font-medium">{saveState.message}</p>}
          {problems.length > 0 && selected.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted">
              {problems.map((p) => <li key={p}>· {p}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
            <h2 className="font-display text-11 font-bold uppercase tracking-[0.14em]">Your squad</h2>
            <span className="font-mono text-11 uppercase tracking-wider text-muted">
              {selected.length} of {SQUAD_SIZE}
            </span>
          </header>

          {selected.length === 0 ? (
            <p className="px-3 py-6 text-13 text-muted">
              Pick {SQUAD_SIZE} players — {SQUAD_SHAPE.GK} keepers, {SQUAD_SHAPE.DEF} defenders,{' '}
              {SQUAD_SHAPE.MID} midfielders and {SQUAD_SHAPE.FWD} forwards — for {formatPrice(BUDGET_TENTHS)} or less,
              with no more than {MAX_PER_CLUB} from any one club.
            </p>
          ) : (
            <>
              {POSITIONS.map((pos) => {
                const rows = starters.flatMap((id) => {
                  const p = byId.get(id);
                  return p && p.position === pos ? [p] : [];
                });
                if (rows.length === 0) return null;
                return (
                  <PositionGroup key={pos} label={POSITION_LABELS[pos]}>
                    {rows.map((p) => (
                      <PickedRow
                        key={p.playerId}
                        player={p}
                        starting
                        captain={captainId === p.playerId}
                        vice={viceCaptainId === p.playerId}
                        onArmband={(role) => setArmband(p.playerId, role)}
                        onToggleStarting={() => toggleStarting(p.playerId)}
                        onRemove={() => remove(p.playerId)}
                      />
                    ))}
                  </PositionGroup>
                );
              })}

              <PositionGroup label={`Bench — substituted in this order`}>
                {bench.length === 0 && (
                  <li className="px-3 py-2 text-13 text-muted">Nobody on the bench yet.</li>
                )}
                {bench.flatMap((id, index) => {
                  const p = byId.get(id);
                  if (!p) return [];
                  return [(
                    <PickedRow
                      key={p.playerId}
                      player={p}
                      starting={false}
                      order={index + 1}
                      captain={false}
                      vice={false}
                      onToggleStarting={() => toggleStarting(p.playerId)}
                      onRemove={() => remove(p.playerId)}
                      onMoveUp={index > 0 ? () => moveBench(p.playerId, -1) : undefined}
                      onMoveDown={index < bench.length - 1 ? () => moveBench(p.playerId, 1) : undefined}
                    />
                  )];
                })}
              </PositionGroup>
            </>
          )}

          <form action={saveAction} className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
            <input type="hidden" name="squad" value={payload} />
            <SaveButton disabled={!isLegal} />
            <span className="text-11 text-muted">
              {isLegal
                ? 'Ready to save.'
                : selected.length === 0
                  ? `Pick ${SQUAD_SIZE} players to save.`
                  : `${problems.length} thing${problems.length === 1 ? '' : 's'} to fix first.`}
            </span>
          </form>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
            <h2 className="font-display text-11 font-bold uppercase tracking-[0.14em]">Players</h2>
            <span className="font-mono text-11 uppercase tracking-wider text-muted">
              {visible.total} available
            </span>
          </header>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div role="tablist" aria-label="Position" className="flex flex-wrap gap-1">
              {(['ALL', ...POSITIONS] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`rounded-md border px-2 py-1 text-11 font-semibold uppercase tracking-wider ${
                    tab === key ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
                  }`}
                >
                  {key === 'ALL' ? 'All' : key}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-11 text-muted">
              <span className="sr-only">Search players</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or club"
                className="w-40 rounded-md border border-border bg-bg px-2 py-1 text-13 outline-none focus-visible:border-text"
              />
            </label>
            <label className="flex items-center gap-1.5 text-11 text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-border bg-bg px-2 py-1 text-13 outline-none focus-visible:border-text"
              >
                <option value="price-desc">Price, high to low</option>
                <option value="price-asc">Price, low to high</option>
                <option value="points">Points</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          {/* Scroll-contained from `lg` up, where the squad sits beside it:
              an unbounded list left the squad column stranded at the top of
              a page several screens long. Below `lg` the two panels are
              stacked and the page's own scroll is the right one. */}
          <ul className="lg:max-h-[70dvh] lg:overflow-y-auto">
            {visible.rows.map((player) => {
              const reason = blockedReason(player);
              return (
                <li key={player.playerId} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                  <span className="w-8 shrink-0 font-mono text-11 uppercase tracking-wider text-muted">
                    {player.position}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-13 font-medium">{player.name}</span>
                  <span className="shrink-0 font-mono text-11 text-muted">{player.teamTla ?? '—'}</span>
                  {player.seasonPoints !== null && (
                    <span className="w-10 shrink-0 text-right font-mono text-11 tabular-nums text-muted">
                      {player.seasonPoints} pt
                    </span>
                  )}
                  <span className="w-14 shrink-0 text-right font-mono text-13 tabular-nums">
                    {formatPrice(player.priceTenths)}
                  </span>
                  <button
                    type="button"
                    onClick={() => add(player)}
                    disabled={reason !== null}
                    title={reason ?? `Add ${player.name}`}
                    aria-label={reason === null ? `Add ${player.name}` : `Cannot add ${player.name}: ${reason}`}
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-11 font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {reason === null ? 'Add' : '—'}
                  </button>
                </li>
              );
            })}
            {visible.total === 0 && (
              <li className="px-3 py-6 text-13 text-muted">No player matches that search.</li>
            )}
          </ul>

          {visible.total > LIST_LIMIT && (
            <p className="border-t border-border px-3 py-2 text-11 text-muted">
              Showing the first {LIST_LIMIT} of {visible.total}. Narrow the search to see the rest.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryBar({
  name, onName, spent, remaining, picked, formation, gameweekLabel,
}: {
  name: string;
  onName: (value: string) => void;
  spent: number;
  remaining: number;
  picked: number;
  formation: string | null;
  gameweekLabel: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2">
      {/* Full width of its own row on a narrow screen: sharing a line with
          the four figures below squeezed the field to about six characters. */}
      <label className="w-full min-w-0 sm:w-auto sm:flex-1">
        <span className="block text-11 uppercase tracking-wider text-muted">Squad name</span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={40}
          className="w-full min-w-0 bg-transparent font-display text-18 font-extrabold tracking-[-0.01em] outline-none focus-visible:underline"
        />
      </label>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-13">
        <div>
          <dt className="text-11 uppercase tracking-wider text-muted">Picked</dt>
          <dd className="text-18 font-bold tabular-nums">{picked}/{SQUAD_SIZE}</dd>
        </div>
        <div>
          <dt className="text-11 uppercase tracking-wider text-muted">Spent</dt>
          <dd className="text-18 font-bold tabular-nums">{formatPrice(spent)}</dd>
        </div>
        <div>
          <dt className="text-11 uppercase tracking-wider text-muted">Left</dt>
          {/* The sign is carried by the words "over" / "left", never by
              colour alone. */}
          <dd className="text-18 font-bold tabular-nums">
            {remaining < 0 ? `${formatPrice(-remaining)} over` : formatPrice(remaining)}
          </dd>
        </div>
        {formation && (
          <div>
            <dt className="text-11 uppercase tracking-wider text-muted">Formation</dt>
            <dd className="text-18 font-bold tabular-nums">{formation}</dd>
          </div>
        )}
      </dl>
      {gameweekLabel && (
        <p className="w-full text-11 text-muted sm:w-auto">{gameweekLabel}</p>
      )}
    </div>
  );
}

function PositionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="border-b border-border bg-surface-2 px-3 py-1 text-11 font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function PickedRow({
  player, starting, order, captain, vice, onArmband, onToggleStarting, onRemove, onMoveUp, onMoveDown,
}: {
  player: PoolPlayer;
  starting: boolean;
  order?: number;
  captain: boolean;
  vice: boolean;
  onArmband?: (role: 'C' | 'V') => void;
  onToggleStarting: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 last:border-b-0">
      {order !== undefined && (
        <span className="w-4 shrink-0 font-mono text-11 tabular-nums text-muted">{order}</span>
      )}
      <span className="w-8 shrink-0 font-mono text-11 uppercase tracking-wider text-muted">{player.position}</span>
      <span className="min-w-0 flex-1 truncate text-13 font-medium">
        {player.name}
        {/* The armband is spelled out, not just implied by a highlighted
            button — a squad printed in black and white still reads. */}
        {captain && <span className="ml-1.5 font-mono text-11 text-muted">(C)</span>}
        {vice && <span className="ml-1.5 font-mono text-11 text-muted">(V)</span>}
      </span>
      <span className="shrink-0 font-mono text-11 text-muted">{player.teamTla ?? '—'}</span>
      <span className="w-14 shrink-0 text-right font-mono text-13 tabular-nums">{formatPrice(player.priceTenths)}</span>

      {starting && onArmband && (
        <>
          <IconButton pressed={captain} onClick={() => onArmband('C')} label={`Captain: ${player.name}`}>C</IconButton>
          <IconButton pressed={vice} onClick={() => onArmband('V')} label={`Vice-captain: ${player.name}`}>V</IconButton>
        </>
      )}
      {onMoveUp && <IconButton onClick={onMoveUp} label={`Move ${player.name} up the bench`}>↑</IconButton>}
      {onMoveDown && <IconButton onClick={onMoveDown} label={`Move ${player.name} down the bench`}>↓</IconButton>}
      <button
        type="button"
        onClick={onToggleStarting}
        className="shrink-0 rounded-md border border-border px-2 py-0.5 text-11 font-semibold hover:bg-surface-2"
      >
        {starting ? 'Bench' : 'Start'}
      </button>
      <IconButton onClick={onRemove} label={`Remove ${player.name}`}>×</IconButton>
    </li>
  );
}

function IconButton({
  children, onClick, label, pressed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-11 font-semibold ${
        pressed ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-lg border border-border bg-surface-2 px-4 py-1.5 text-13 font-semibold hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save squad'}
    </button>
  );
}
