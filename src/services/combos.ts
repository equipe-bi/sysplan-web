import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Combo, GrupoProduto } from '@/types';

/** Combos gerais usam CD_Grupo=2 (regra herdada do Access) */
export const GRUPO_GERAL = 2;

export function useGrupos() {
  return useQuery({
    queryKey: ['prm_grupo'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_grupo').select('*').order('dc_grupo');
      if (error) throw error;
      return data as GrupoProduto[];
    },
  });
}

export function useCombos() {
  const query = useQuery({
    queryKey: ['prm_combos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prm_combos')
        .select('*')
        .order('dc_combo');
      if (error) throw error;
      return data as Combo[];
    },
  });

  /** Opções de um tipo de combo para um grupo (cd_grupo=2 => combos gerais) */
  const opcoes = (tipo: string, cdGrupo: number = GRUPO_GERAL): string[] =>
    (query.data ?? [])
      .filter((c) => c.dc_tipo_combo === tipo && c.cd_grupo === cdGrupo)
      .map((c) => c.dc_combo);

  return { ...query, opcoes };
}

export function useEssentials() {
  return useQuery({
    queryKey: ['cadastro_essential'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cadastro_essential')
        .select('cd_essential, dc_grupo, dc_essential, dc_status')
        .order('cd_essential');
      if (error) throw error;
      return data;
    },
  });
}

export function useCompradores() {
  return useQuery({
    queryKey: ['prm_cluster_comprador'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_cluster_comprador').select('*');
      if (error) throw error;
      return data;
    },
  });
}
