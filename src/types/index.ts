export type Perfil = 'admin' | 'usuario';

export interface Usuario {
  id: string;
  cd_usuario_legado: number | null;
  nome: string;
  email: string;
  login_rede: string | null;
  filtro_comprador: string | null;
  perfil: Perfil;
  bloqueado: boolean;
  criado_em: string;
}

export interface Tela {
  codigo: string;
  nome: string;
  grupo: string;
  ordem: number;
}

export interface Permissao {
  usuario_id: string;
  tela_codigo: string;
  pode_visualizar: boolean;
  pode_editar: boolean;
}

export interface Compra {
  cd_compra: number;
  dc_status: string | null;
  dc_canal: string | null;
  dc_grupo: string | null;
  dc_subgrupo: string | null;
  dc_formato: string | null;
  dc_sexo: string | null;
  dc_segmentacao: string | null;
  dc_grupo_planejamento: string | null;
  dc_linha: string | null;
  dc_griffe: string | null;
  dc_material1: string | null;
  dc_material2: string | null;
  dc_atributo1: string | null;
  dc_atributo2: string | null;
  dc_medidas: string | null;
  dc_tamanho: string | null;
  dc_info1: string | null;
  dc_info2: string | null;
  dc_info3: string | null;
  dc_info4: string | null;
  dc_info5: string | null;
  dc_info6: string | null;
  dc_info7: string | null;
  nr_fob_negociado: number | null;
  nr_fob_real: number | null;
  nr_quantidade: number | null;
  nr_preco_varejo: number | null;
  nr_margem: number | null;
  cd_material_fornecedor: string | null;
  cd_material_pai: string | null;
  dc_fornecedor: string | null;
  cd_pedido_fornecedor: string | null;
  cd_pedido_sap: string | null;
  dc_modal: string | null;
  dt_recebimento: string | null;
  dt_delivery: string | null;
  dt_revised_delivery: string | null;
  nr_lead_time: number | null;
  dc_observacao: string | null;
  nr_anomes: number | null;
  bloqueio_edicao: boolean;
  usuario_bloqueio: string | null;
  dc_fup_produto: string | null;
  cd_essential: number | null;
  dc_aprovacao_cor: string | null;
  nr_total_fob: number | null;
}

export interface CompraLista extends Compra {
  fob_calc: number | null;
  margem_calc: number | null;
  tamanho_calc: string | null;
  cd_embarque: string | null;
  dt_entrega_origem_fup: string | null;
  dt_embarque_fup: string | null;
  dt_atraque_fup: string | null;
  dc_status_comex: string | null;
  essential_calc: string | null;
  dc_comprador: string | null;
  dc_comprador_grupo: string | null;
}

export interface FollowupFornecedor {
  cd_follow_forn: number;
  cd_compra: number;
  dt_revised_delivery_original: string | null;
  dt_recebimento_cb_original: string | null;
  dc_modal_original: string | null;
  dc_status_fornecedor: string | null;
  dc_observacao_fornecedor: string | null;
  dt_revised_delivery_proposta: string | null;
  dc_numero_bl: string | null;
  dc_avaliacao_fornecedor: string | null;
  dc_avaliacao_comprador: string | null;
  dc_observacao_avaliacao: string | null;
  dt_novo_recebimento_comprador: string | null;
  dt_novo_delivery_comprador: string | null;
  dc_novo_modal_comprador: string | null;
  dc_avaliacao_final: string | null;
  dt_inicio_followup: string | null;
  dt_fim_followup: string | null;
  dt_avaliacao_comprador: string | null;
}

export interface Combo {
  cd_combo: number;
  cd_grupo: number;
  dc_tipo_combo: string;
  dc_combo: string;
}

export interface GrupoProduto {
  cd_grupo: number;
  dc_grupo: string;
}

export interface GrupoPlanejamento {
  dc_grupo: string;
  dc_subgrupo: string;
  dc_sexo: string;
  dc_formato: string;
  dc_grupo_planejamento: string | null;
}

export interface DefinicaoCusto {
  dc_canal: string;
  dc_grupo: string;
  dc_modal: string;
  nr_anomes: number;
  nr_dolar: number;
  nr_fator_imp: number;
  nr_markup: number;
  nr_valor_agregado: number;
}

export interface ClusterComprador {
  cd_cluster: number;
  dc_grupo: string | null;
  dc_canal: string | null;
  dc_comprador: string | null;
  dc_comprador_grupo: string | null;
}

export interface Essential {
  cd_essential: number;
  dc_grupo: string | null;
  dc_essential: string | null;
  dc_status: string | null;
}

export interface ConfigColuna {
  campo: string;
  exibir: string;
  tipo_filtro: string;
  filtro: string;
  largura_coluna: number;
  legenda_exibicao: string | null;
  ordem: number;
  formatacao: string | null;
  order_by: string;
  tipo_dado: string;
}

export interface LogTransacao {
  cd_transacao: number;
  usuario_id: string | null;
  cd_usuario_legado: number | null;
  transacao: string;
  cd_item_transacao: number;
  dt_transacao: string;
  info_anterior: string | null;
  info_atual: string | null;
  campo_editado: string | null;
}

export interface ResumoFupGeral {
  cd_compra: number;
  info_usar: number;
  processo_calc: string | null;
  status_calc: string | null;
  entrega_calc: string | null;
  prev_embarque_calc: string | null;
  embarque_calc: string | null;
  prev_atraque_calc: string | null;
  atraque_calc: string | null;
  consta_despachante: string;
}

export interface PastaPI {
  dc_nome_arquivo: string;
  cd_sysplan: number;
  cd_pi: string | null;
  dt_delivery_date: string | null;
  cd_ref_fornecedor: string | null;
  dc_fornecedor: string | null;
  nr_qtd_total: number;
  nr_fob_total: number;
  dc_size: string | null;
  storage_path_arquivo: string | null;
  storage_path_foto: string | null;
  [k: string]: unknown;
}

export interface PICor {
  id?: number;
  dc_nome_arquivo: string;
  dc_numero_cor: string;
  dc_cor_lente: string;
  dc_cor_armacao: string;
  dc_acabamento_armacao: string;
  dc_cor_haste: string;
  dc_acabamento_haste: string;
  nr_qtde: number;
  nr_fob: number;
  dc_idioma: 'PORTUGUES' | 'INGLES';
}
