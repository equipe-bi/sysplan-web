import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY devem estar definidos no .env');
}

export const supabase = createClient(url, anonKey);

/**
 * Cliente auxiliar com storage isolado: permite ao administrador criar
 * usuários (signUp) sem derrubar a própria sessão.
 */
export const supabaseAdminAux = createClient(url, anonKey, {
  auth: { storageKey: 'sysplan-aux', persistSession: false, autoRefreshToken: false },
});
