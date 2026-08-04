/** Words that describe the club type rather than name it. */
const NOISE = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'ss', 'sv', 'vfl', 'vfb', 'bsc', 'club', 'de', 'the', 'us', 'ud', 'rc', 'cd']);

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOISE.has(w.toLowerCase()));
}

/** Two-character stand-in used wherever a crest is missing. Never throws. */
export function monogram(name: string): string {
  const parts = words(name);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase().padEnd(2, '?');
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const PALETTE = [
  '#B23A48', '#1D6A96', '#3E7C4A', '#8A5A2B', '#5B4B8A',
  '#2E7D7B', '#9C4F2A', '#4A5D23', '#7A3B6B', '#2F4858',
];

/** Deterministic so a club's placeholder colour never changes between renders. */
export function monogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
