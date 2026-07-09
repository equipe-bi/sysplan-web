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

/**
 * Busca todas as linhas paginando de 1000 em 1000 (limite do PostgREST por requisição).
 * `montarQuery` recebe (inicio, fim) e devolve a query com .range(inicio, fim).
 */
export async function fetchAll<T>(
  montarQuery: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: any }>,
  maximo = 100_000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; inicio < maximo; inicio += 1000) {
    const { data, error } = await montarQuery(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}
