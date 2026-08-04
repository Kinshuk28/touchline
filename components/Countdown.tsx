export function Countdown({ targetIso, now }: { targetIso: string; now: Date }) {
  const ms = new Date(targetIso).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <span className="text-sm font-bold tabular-nums">
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`}
    </span>
  );
}
