// Teste rápido das consultas do dashboard (usa service_role de .env.migration)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.migration', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = env.SUPABASE_URL || 'https://vavdakgdtmibajbgcthn.supabase.co';
const s = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);

const t0 = Date.now();
const r1 = await s.from('controle_compras').select('cd_compra', { count: 'exact', head: true }).neq('dc_status', 'EXCLUIDO');
console.log('count neq EXCLUIDO:', r1.count, 'error:', r1.error?.message ?? null, `${Date.now() - t0}ms`);

const t2 = Date.now();
const r2 = await s.from('controle_compras')
  .select('cd_compra', { count: 'exact', head: true })
  .neq('dc_status', 'EXCLUIDO')
  .not('dt_recebimento', 'is', null);
console.log('count recebimento:', r2.count, 'error:', r2.error?.message ?? null, `${Date.now() - t2}ms`);

const t3 = Date.now();
const r3 = await s.from('controle_compras')
  .select('dt_recebimento, nr_quantidade, dc_canal, dc_grupo, dc_griffe')
  .neq('dc_status', 'EXCLUIDO')
  .not('dt_recebimento', 'is', null)
  .order('dt_recebimento')
  .range(0, 999);
console.log('page0:', r3.data?.length, 'error:', r3.error?.message ?? null, `${Date.now() - t3}ms`);

// range além do fim (comportamento em fetch paralelo)
const r4 = await s.from('controle_compras').select('cd_compra').range(999000, 999999);
console.log('range alem do fim:', r4.data?.length, 'status:', r4.status, 'error:', r4.error?.message ?? null);
