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

/**
 * Igual ao fetchAll, mas dispara as páginas em paralelo (em lotes) a partir de um
 * total já conhecido — muito mais rápido para tabelas grandes. Obtenha o total
 * com uma consulta `count: 'exact', head: true` antes de chamar.
 */
export async function fetchPaginasParalelo<T>(
  montarQuery: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: any }>,
  total: number,
  concorrencia = 6,
): Promise<T[]> {
  const paginas: [number, number][] = [];
  for (let i = 0; i < total; i += 1000) paginas.push([i, i + 999]);
  const todas: T[] = [];
  for (let i = 0; i < paginas.length; i += concorrencia) {
    const lote = paginas.slice(i, i + concorrencia);
    const resultados = await Promise.all(lote.map(([a, b]) => montarQuery(a, b)));
    for (const { data, error } of resultados) {
      if (error) throw error;
      todas.push(...(data ?? []));
    }
  }
  return todas;
}
