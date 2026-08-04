/**
 * CI preflight: reports what the current environment actually holds for a
 * given credential set — without ever printing a secret value.
 *
 * Cause 2 in the CI investigation: `npm run build` fails in GitHub Actions
 * but succeeds locally with the exact same two env vars CI passes
 * (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). The code is right, so something
 * about the *values* CI holds must be wrong — a dashboard URL pasted in
 * place of the API URL, a key with a trailing newline from a copy-paste, an
 * empty secret, etc. The job logs need authentication this environment
 * doesn't have, so this script runs as its own preflight step, immediately
 * before the step it's guarding, and reports on the shape of each value
 * (set/unset, length, prefix, decoded JWT `role` claim, trailing
 * whitespace) rather than the value itself.
 *
 * Usage: `npx tsx scripts/preflight-env.ts <site|ingest>`
 *   site    — SUPABASE_URL, SUPABASE_ANON_KEY            (used by ci.yml)
 *   ingest  — FOOTBALL_DATA_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *             (used by ingest-core.yml)
 *
 * Exits non-zero (and CI's `continue-on-error: false` fails the job) the
 * moment any check fails, so a bad value surfaces here with a readable
 * message instead of as an opaque `next build` or ingestion crash several
 * steps later.
 *
 * Never printed, anywhere: the value of SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, FOOTBALL_DATA_KEY, or a JWT's signature.
 * SUPABASE_URL is printed in full — it is a public API endpoint, not a
 * secret, and seeing it is the fastest way to spot a pasted dashboard URL.
 */

const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9]+\.supabase\.co$/;

let ok = true;

function fail(message: string): void {
  console.error(`  FAIL  ${message}`);
  ok = false;
}

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

function trailingWhitespaceNote(name: string, raw: string): void {
  if (raw !== raw.trimEnd()) {
    fail(`${name} has trailing whitespace/newline — a classic silent copy-paste failure`);
  } else {
    pass(`${name} has no trailing whitespace/newline`);
  }
}

function checkUrl(name: string): void {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    fail(`${name} is not set`);
    return;
  }
  pass(`${name} is set`);
  console.log(`  value ${name} = ${raw}`);

  if (SUPABASE_URL_PATTERN.test(raw.trimEnd())) {
    pass(`${name} matches the project API URL pattern (https://<ref>.supabase.co)`);
  } else {
    fail(
      `${name} does not match ^https://[a-z0-9]+\\.supabase\\.co$ — ` +
        `a common mistake is pasting the dashboard URL ` +
        `(https://supabase.com/dashboard/project/<ref>) instead of the project API URL`,
    );
  }

  trailingWhitespaceNote(name, raw);
}

function decodeJwtRole(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const payload = parts[1];
  if (payload === undefined) return undefined;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const decoded: unknown = JSON.parse(json);
    if (typeof decoded === 'object' && decoded !== null && 'role' in decoded) {
      const role = (decoded as Record<string, unknown>).role;
      return typeof role === 'string' ? role : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function checkJwt(name: string, expectedRole: string): void {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    fail(`${name} is not set`);
    return;
  }
  pass(`${name} is set`);
  console.log(`  info  ${name} length = ${raw.length}`);

  const trimmed = raw.trimEnd();
  if (trimmed.startsWith('eyJ')) {
    pass(`${name} starts with "eyJ" (looks like a JWT)`);
  } else {
    fail(`${name} does not start with "eyJ" — does not look like a Supabase JWT`);
  }

  const role = decodeJwtRole(trimmed);
  if (role === undefined) {
    fail(`${name} payload could not be decoded to read its "role" claim`);
  } else if (role === expectedRole) {
    pass(`${name} decoded role claim = "${role}" (expected "${expectedRole}")`);
  } else {
    fail(`${name} decoded role claim = "${role}", expected "${expectedRole}"`);
  }

  trailingWhitespaceNote(name, raw);
}

function checkLength(name: string): void {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    fail(`${name} is not set`);
    return;
  }
  pass(`${name} is set`);
  console.log(`  info  ${name} length = ${raw.length}`);
  trailingWhitespaceNote(name, raw);
}

const mode = process.argv[2];

if (mode === 'site') {
  console.log('preflight: site env (SUPABASE_URL, SUPABASE_ANON_KEY)');
  checkUrl('SUPABASE_URL');
  checkJwt('SUPABASE_ANON_KEY', 'anon');
} else if (mode === 'ingest') {
  console.log('preflight: ingest env (FOOTBALL_DATA_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  checkLength('FOOTBALL_DATA_KEY');
  checkUrl('SUPABASE_URL');
  checkJwt('SUPABASE_SERVICE_ROLE_KEY', 'service_role');
} else {
  console.error('usage: npx tsx scripts/preflight-env.ts <site|ingest>');
  process.exit(2);
}

if (!ok) {
  console.error('\npreflight failed — see FAIL lines above. No secret values were printed.');
  process.exit(1);
}
console.log('\npreflight passed.');
