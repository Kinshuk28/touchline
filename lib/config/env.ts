import { z } from 'zod';

const schema = z.object({
  FOOTBALL_DATA_KEY: z.string().min(10, 'FOOTBALL_DATA_KEY looks too short'),
  SUPABASE_URL: z
    .string()
    .url()
    .refine((u) => !u.endsWith('/'), 'SUPABASE_URL must not have a trailing slash')
    .refine(
      (u) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u),
      'SUPABASE_URL must be the project API URL (https://<ref>.supabase.co), not the dashboard URL',
    ),
  // Optional: no code path reads this today (`serviceClient()` only ever
  // uses the service-role key below). Kept in the schema — rather than
  // deleted outright — so it's still validated/typed if a future Phase B
  // client-side path starts consuming it, but `loadEnv` must not fail in a
  // context (e.g. a workflow) that never had a reason to hold it.
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
