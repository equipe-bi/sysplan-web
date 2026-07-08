import { formatDate, formatNumber, formatPercent } from '@/lib/utils';
import type { ConfigColuna } from '@/types';

/** Mapeia o nome de campo legado (PRM_Lista_Compras) para a coluna da view */
const MAPA_LEGADO: Record<string, string> = {
  NR_AnoMes: 'nr_anomes',
  NR_TotalFOB: 'nr_total_fob',
  Margem_Calc: 'margem_calc',
  Fob_Calc: 'fob_calc',
  Tamanho_Calc: 'tamanho_calc',
  Essential_Calc: 'essential_calc',
  DC_Comprador: 'dc_comprador',
  DC_CompradorGrupo: 'dc_comprador_grupo',
  CD_Embarque: 'cd_embarque',
  DT_EntregaOrigem_FUP: 'dt_entrega_origem_fup',
  DT_Embarque_FUP: 'dt_embarque_fup',
  DT_Atraque_FUP: 'dt_atraque_fup',
  DC_StatusComex: 'dc_status_comex',
  NR_LeadTime: 'nr_lead_time',
};

export function campoParaColuna(campo: string): string {
  if (MAPA_LEGADO[campo]) return MAPA_LEGADO[campo];
  return campo
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export function renderizador(config: ConfigColuna): ((row: any) => string) | undefined {
  const col = campoParaColuna(config.campo);
  if (config.tipo_dado === 'Data') return (row) => formatDate(row[col]);
  if (config.campo === 'Margem_Calc' || config.campo === 'NR_Margem')
    return (row) => formatPercent(row[col]);
  if (config.tipo_dado === 'Numero') return (row) => formatNumber(row[col], 2);
  return undefined;
}
