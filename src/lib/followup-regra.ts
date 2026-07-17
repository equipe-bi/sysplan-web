import { supabase, fetchAll } from '@/lib/supabase';
import type { LinhaFollowExport } from '@/lib/followup-excel';

/**
 * Regra de geração/exportação do Follow-up de Fornecedor.
 *
 * Chave de cruzamento = Pedido SAP + Material Pai (mesma usada no FUP Comex e no
 * Followup Agente de Carga).
 *
 * 1) Baixa sistema: follows SEM resposta cuja chave já tem informação no FUP Comex
 *    ou no Agente de Carga são encerrados automaticamente ("Embarcado processo: X").
 * 2) Geração: compras com recebimento em mês futuro, sem info no FUP/Agente e sem
 *    follow em aberto, geram uma nova linha de follow. Se a última linha daquela
 *    compra teve resposta, a resposta é copiada para a nova linha aberta.
 * 3) Exporta: 1 arquivo por fornecedor, só com as linhas de follow SEM resposta.
 */

export interface FiltroExport {
  fornecedor?: string;
  canal?: string;
  grupo?: string;
  pi?: string;
  materialPai?: string;
}

const chaveDe = (pedidoSap: string | null, materialPai: string | null) =>
  `${pedidoSap ?? ''}${materialPai ?? ''}`;

const hoje = () => new Date().toISOString().slice(0, 10);
const anoMesAtual = () => {
  const d = new Date();
  return d.getFullYear() * 100 + (d.getMonth() + 1);
};
const anoMesDe = (iso: string | null) => {
  if (!iso) return 0;
  return Number(iso.slice(0, 4)) * 100 + Number(iso.slice(5, 7));
};

/** Campos de resposta copiados de um follow encerrado para a nova linha aberta */
const CAMPOS_RESPOSTA = [
  'dc_status_fornecedor', 'dc_observacao_fornecedor', 'dt_revised_delivery_proposta',
  'dc_numero_bl', 'dc_avaliacao_fornecedor', 'dc_avaliacao_comprador',
  'dc_observacao_avaliacao', 'dt_novo_recebimento_comprador', 'dt_novo_delivery_comprador',
  'dc_novo_modal_comprador', 'dc_avaliacao_final',
] as const;

export interface ResultadoPreparacao {
  baixados: number;
  gerados: number;
  linhasPorFornecedor: Map<string, LinhaFollowExport[]>;
}

export async function prepararExportacaoFollow(filtro: FiltroExport): Promise<ResultadoPreparacao> {
  // ---------- A. Compras em escopo ----------
  const compras = await fetchAll<any>((i, f) => {
    let q = supabase
      .from('controle_compras')
      .select('cd_compra, dc_fornecedor, dc_grupo, dc_canal, dc_linha, dc_griffe, cd_pedido_fornecedor, cd_material_fornecedor, cd_pedido_sap, cd_material_pai, dc_modal, dt_recebimento, dt_revised_delivery, dc_status')
      .neq('dc_status', 'EXCLUIDO');
    if (filtro.fornecedor) q = q.eq('dc_fornecedor', filtro.fornecedor);
    if (filtro.canal) q = q.eq('dc_canal', filtro.canal);
    if (filtro.grupo) q = q.eq('dc_grupo', filtro.grupo);
    if (filtro.pi) q = q.ilike('cd_pedido_fornecedor', `%${filtro.pi}%`);
    if (filtro.materialPai) q = q.ilike('cd_material_pai', `%${filtro.materialPai}%`);
    return q.order('cd_compra').range(i, f);
  });
  const comprasPorCd = new Map<number, any>(compras.map((c) => [c.cd_compra, c]));
  const cds = compras.map((c) => c.cd_compra);

  // ---------- B. Chaves com informação (FUP Comex + Agente de Carga) ----------
  const pedidos = [...new Set(compras.map((c) => c.cd_pedido_sap).filter(Boolean))] as string[];
  const infoMap = new Map<string, string>(); // chave -> processo/embarque
  for (let i = 0; i < pedidos.length; i += 200) {
    const bloco = pedidos.slice(i, i + 200);
    const { data: comex } = await supabase
      .from('ext_fup_comex')
      .select('cd_pedido_sap, cd_material_pai, cd_embarque')
      .in('cd_pedido_sap', bloco);
    for (const r of comex ?? []) {
      const k = chaveDe(r.cd_pedido_sap, r.cd_material_pai);
      if (!infoMap.has(k)) infoMap.set(k, r.cd_embarque ?? '');
    }
    const { data: agente } = await supabase
      .from('acompanhamento_importacoes')
      .select('cd_pedido_sap, cd_material_pai, cd_embarque, chave')
      .in('cd_pedido_sap', bloco);
    for (const r of agente ?? []) {
      const k = r.chave || chaveDe(r.cd_pedido_sap, r.cd_material_pai);
      if (!infoMap.has(k)) infoMap.set(k, r.cd_embarque ?? '');
    }
  }

  // ---------- C. Follows das compras ----------
  const follows: any[] = [];
  for (let i = 0; i < cds.length; i += 300) {
    const { data: bloco } = await supabase
      .from('followup_fornecedor')
      .select('*')
      .in('cd_compra', cds.slice(i, i + 300))
      .order('cd_follow_forn');
    follows.push(...(bloco ?? []));
  }
  const followsPorCd = new Map<number, any[]>();
  for (const fw of follows) {
    if (!followsPorCd.has(fw.cd_compra)) followsPorCd.set(fw.cd_compra, []);
    followsPorCd.get(fw.cd_compra)!.push(fw);
  }

  // ---------- D. Baixa sistema (rule 1) ----------
  let baixados = 0;
  for (const fw of follows) {
    if (fw.dt_fim_followup) continue; // só abertos
    const c = comprasPorCd.get(fw.cd_compra);
    if (!c) continue;
    const k = chaveDe(c.cd_pedido_sap, c.cd_material_pai);
    if (!infoMap.has(k)) continue;
    const processo = infoMap.get(k) || '';
    const statusForn = processo ? `Embarcado processo: ${processo}` : 'Embarcado (baixa sistema)';
    const { error } = await supabase
      .from('followup_fornecedor')
      .update({
        dc_status_fornecedor: statusForn,
        dc_avaliacao_comprador: 'BAIXA SISTEMA',
        dc_observacao_avaliacao: statusForn,
        dc_avaliacao_final: 'BAIXA SISTEMA',
        dt_avaliacao_comprador: hoje(),
        dt_fim_followup: hoje(),
      })
      .eq('cd_follow_forn', fw.cd_follow_forn);
    if (!error) {
      fw.dt_fim_followup = hoje(); // marca como encerrado localmente
      baixados++;
    }
  }

  // ---------- E. Geração (rule 2) ----------
  let gerados = 0;
  const amAtual = anoMesAtual();
  for (const c of compras) {
    if (anoMesDe(c.dt_recebimento) <= amAtual) continue; // só recebimento futuro
    const k = chaveDe(c.cd_pedido_sap, c.cd_material_pai);
    if (infoMap.has(k)) continue; // já tem info no FUP/Agente
    const lista = followsPorCd.get(c.cd_compra) ?? [];
    const temAberto = lista.some((f) => !f.dt_fim_followup);
    if (temAberto) continue; // já será exportado

    const novo: Record<string, any> = {
      cd_compra: c.cd_compra,
      dt_revised_delivery_original: c.dt_revised_delivery,
      dt_recebimento_cb_original: c.dt_recebimento,
      dc_modal_original: c.dc_modal,
      dt_inicio_followup: hoje(),
      dc_status_fornecedor: 'PENDENTE',
      dc_avaliacao_comprador: 'PENDENTE',
    };
    // Se a última linha teve resposta, copia a resposta para a nova linha aberta
    const encerrados = lista.filter((f) => f.dt_fim_followup);
    if (encerrados.length > 0) {
      const ultima = encerrados[encerrados.length - 1];
      for (const campo of CAMPOS_RESPOSTA) if (ultima[campo] != null) novo[campo] = ultima[campo];
    }
    const { data: criado, error } = await supabase
      .from('followup_fornecedor')
      .insert(novo)
      .select('*')
      .single();
    if (!error && criado) {
      if (!followsPorCd.has(c.cd_compra)) followsPorCd.set(c.cd_compra, []);
      followsPorCd.get(c.cd_compra)!.push(criado);
      gerados++;
    }
  }

  // ---------- F. Monta export: só follows abertos, por fornecedor ----------
  const linhasPorFornecedor = new Map<string, LinhaFollowExport[]>();
  for (const [cd, lista] of followsPorCd) {
    const c = comprasPorCd.get(cd);
    if (!c) continue;
    for (const fw of lista) {
      if (fw.dt_fim_followup) continue; // exporta só SEM resposta
      const forn = c.dc_fornecedor || 'SEM FORNECEDOR';
      const linha: LinhaFollowExport = {
        cdFollow: fw.cd_follow_forn,
        cdCompra: c.cd_compra,
        supplier: c.dc_fornecedor ?? '',
        supplierOrder: c.cd_pedido_fornecedor ?? '',
        supplierReference: c.cd_material_fornecedor ?? '',
        cbOrder: c.cd_pedido_sap ?? '',
        cdReference: c.cd_material_pai ?? '',
        group: `${c.dc_grupo ?? ''} ${c.dc_canal ?? ''}`.trim(),
        collection: `${c.dc_linha ?? ''} | ${c.dc_griffe ?? ''}`,
        deliveryDate: fw.dt_revised_delivery_original ?? c.dt_revised_delivery,
        cbArrivalDate: fw.dt_recebimento_cb_original ?? c.dt_recebimento,
        modal: fw.dc_modal_original ?? c.dc_modal ?? '',
      };
      if (!linhasPorFornecedor.has(forn)) linhasPorFornecedor.set(forn, []);
      linhasPorFornecedor.get(forn)!.push(linha);
    }
  }

  return { baixados, gerados, linhasPorFornecedor };
}
