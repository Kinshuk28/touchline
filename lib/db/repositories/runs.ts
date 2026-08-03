import { serviceClient } from '@/lib/db/client';

export async function startRun(job: string): Promise<number> {
  const { data, error } = await serviceClient()
    .from('ingest_run')
    .insert({ job, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return data!.id as number;
}

export async function finishRun(
  id: number,
  status: 'ok' | 'error',
  message: string | null,
  requestsUsed: number,
): Promise<void> {
  const { error } = await serviceClient()
    .from('ingest_run')
    .update({ status, message, requests_used: requestsUsed, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`finishRun: ${error.message}`);
}
