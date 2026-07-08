// Migração de dados: CSVs exportados do Access -> Supabase (REST, service_role)
// Uso: npm run migrate:data  (requer schema.sql já aplicado no banco)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv, parseCsv, restRequest } from './lib.mjs';

const env = loadEnv();
const DATA_DIR = path.join(ROOT, 'migration', 'data');
const BATCH = 2000;

const dateOnly = (v) => (v ? v.slice(0, 10) : null);
const num = (v) => (v === null || v === '' ? null : Number(v));
const bool = (v) => v === 'true';

// [csv, tabela, pk para on_conflict, mapa de colunas {colunaCsv: [colunaPg, transform?]}]
const JOBS = [
  ['PRM_Grupo', 'prm_grupo', 'cd_grupo', {
    CD_Grupo: ['cd_grupo', num], DC_Grupo: ['dc_grupo'],
  }],
  ['PRM_Combos', 'prm_combos', 'cd_combo', {
    CD_Combo: ['cd_combo', num], CD_Grupo: ['cd_grupo', num],
    DC_TipoCombo: ['dc_tipo_combo'], DC_Combo: ['dc_combo'],
  }],
  ['PRM_Grupo_Planejamento', 'prm_grupo_planejamento', 'dc_grupo,dc_subgrupo,dc_sexo,dc_formato', {
    DC_Grupo: ['dc_grupo'], DC_SubGrupo: ['dc_subgrupo'], DC_Sexo: ['dc_sexo'],
    DC_Formato: ['dc_formato'], DC_Grupo_Planejamento: ['dc_grupo_planejamento'],
  }],
  ['PRM_Definicao_Custo', 'prm_definicao_custo', 'dc_canal,dc_grupo,dc_modal,nr_anomes', {
    DC_Canal: ['dc_canal'], DC_Grupo: ['dc_grupo'], DC_Modal: ['dc_modal'],
    NR_AnoMes: ['nr_anomes', num], NR_Dolar: ['nr_dolar', num],
    NR_Fator_Imp: ['nr_fator_imp', num], NR_MarkUp: ['nr_markup', num],
    NR_ValorAgregado: ['nr_valor_agregado', num],
  }],
  ['PRM_Cluster_Comprador', 'prm_cluster_comprador', 'cd_cluster', {
    CD_Cluster: ['cd_cluster', num], DC_Grupo: ['dc_grupo'], DC_Canal: ['dc_canal'],
    DC_Comprador: ['dc_comprador'], DC_CompradorGrupo: ['dc_comprador_grupo'],
  }],
  ['PRM_Ajuste_FOB', 'prm_ajuste_fob', 'cd_pedido_sap,cd_material_pai', {
    CD_PedidoSAP: ['cd_pedido_sap'], CD_MaterialPai: ['cd_material_pai'], NR_Fob: ['nr_fob', num],
  }],
  ['PRM_Ajuste_PedidoSAP_Cadastro', 'prm_ajuste_pedido_sap_cadastro', 'id_sysplan', {
    ID_Sysplan: ['id_sysplan', num], CD_Pedido_Fornecedor: ['cd_pedido_fornecedor'],
    CD_Material_Fornecedor: ['cd_material_fornecedor'], CD_Pedido_SAP: ['cd_pedido_sap'],
    CD_MaterialPai: ['cd_material_pai'],
  }],
  ['PRM_DePara_Pedido_MultiplosEmbarques', 'prm_depara_pedido_multiplos_embarques', 'codigo', {
    'Código': ['codigo', num], CD_PedidoSAP: ['cd_pedido_sap'], CD_MaterialPai: ['cd_material_pai'],
    CD_Embarque: ['cd_embarque'], CD_PedidoSAP_Ajuste: ['cd_pedido_sap_ajuste'],
  }],
  ['PRM_Versao', 'prm_versao', 'versao_atual', {
    VersaoAtual: ['versao_atual'],
  }],
  ['PRM_Campos_EdicaoMassa_Compras', 'prm_campos_edicao_massa', 'dc_campo_edicao', {
    DC_Campo_Edicao: ['dc_campo_edicao'], DC_Campo_Original: ['dc_campo_original'],
    DC_Campo_Sysplan: ['dc_campo_sysplan'],
  }],
  ['PRM_Cor_PI', 'prm_cor_pi', null, {
    DC_Campo: ['dc_campo'], DC_TextoPortugues: ['dc_texto_portugues'],
    DC_TextoIngles: ['dc_texto_ingles'], CD_CodigoCor: ['cd_codigo_cor'],
    OrdemPesquisa: ['ordem_pesquisa', num],
  }],
  ['PRM_DePara_CamposPI', 'prm_depara_campos_pi', null, {
    CD_Grupo: ['cd_grupo', num], DC_TipoCombo: ['dc_tipo_combo'],
    Info_DE: ['info_de'], Info_PARA: ['info_para'],
  }],
  ['PRM_Lista_Compras', 'prm_lista_compras', 'campo', {
    Campo: ['campo'], Exibir: ['exibir'], TipoFiltro: ['tipo_filtro'], Filtro: ['filtro'],
    LarguraColuna: ['largura_coluna', num], LegendaExibicao: ['legenda_exibicao'],
    Ordem: ['ordem', num], Formatacao: ['formatacao'], OrderBy: ['order_by'],
    TipoDado: ['tipo_dado'], LarguraColuna_Original: ['largura_coluna_original', num],
  }],
  ['DM_Cadastro_Essential', 'cadastro_essential', 'cd_essential', {
    CD_Essential: ['cd_essential', num], DC_Grupo: ['dc_grupo'], DC_Essential: ['dc_essential'],
    CD_MaterialPai_Atual: ['cd_material_pai_atual'], CD_RefExportador_Atual: ['cd_ref_exportador_atual'],
    DC_Status: ['dc_status'], DC_ReposicaoAutomatica: ['dc_reposicao_automatica'],
    DC_Vermelha: ['vermelha', bool], DC_Otica: ['otica', bool],
    DC_ClusterLoja: ['dc_cluster_loja'], DC_StatusVermelha: ['dc_status_vermelha'],
    DC_StatusOtica: ['dc_status_otica'],
  }],
  ['DM_DePara_Essential', 'depara_essential', 'cd_material_pai,cd_ref_exportador,cd_essential', {
    CD_MaterialPai: ['cd_material_pai'], CD_RefExportador: ['cd_ref_exportador'], CD_Essential: ['cd_essential'],
  }],
  ['DM_ControleCompras', 'controle_compras', 'cd_compra', {
    CD_Compra: ['cd_compra', num], DC_Status: ['dc_status'], DC_Canal: ['dc_canal'],
    DC_Grupo: ['dc_grupo'], DC_SubGrupo: ['dc_subgrupo'], DC_Formato: ['dc_formato'],
    DC_Sexo: ['dc_sexo'], DC_Segmentacao: ['dc_segmentacao'],
    DC_GrupoPlanejamento: ['dc_grupo_planejamento'], DC_Linha: ['dc_linha'], DC_Griffe: ['dc_griffe'],
    DC_Material1: ['dc_material1'], DC_Material2: ['dc_material2'],
    DC_Atributo1: ['dc_atributo1'], DC_Atributo2: ['dc_atributo2'],
    DC_Medidas: ['dc_medidas'], DC_Tamanho: ['dc_tamanho'],
    DC_Info1: ['dc_info1'], DC_Info2: ['dc_info2'], DC_Info3: ['dc_info3'], DC_Info4: ['dc_info4'],
    DC_Info5: ['dc_info5'], DC_Info6: ['dc_info6'], DC_Info7: ['dc_info7'],
    NR_FobNegociado: ['nr_fob_negociado', num], NR_FobReal: ['nr_fob_real', num],
    NR_Quantidade: ['nr_quantidade', num], NR_PrecoVarejo: ['nr_preco_varejo', num],
    NR_Margem: ['nr_margem', num], CD_MaterialFornecedor: ['cd_material_fornecedor'],
    CD_MaterialPai: ['cd_material_pai'], DC_Fornecedor: ['dc_fornecedor'],
    CD_PedidoFornecedor: ['cd_pedido_fornecedor'], CD_PedidoSAP: ['cd_pedido_sap'],
    DC_Modal: ['dc_modal'], DT_Recebimento: ['dt_recebimento', dateOnly],
    DT_Delivery: ['dt_delivery', dateOnly], DT_RevisedDelivery: ['dt_revised_delivery', dateOnly],
    NR_LeadTime: ['nr_lead_time', num], DC_Observacao: ['dc_observacao'],
    NR_AnoMes: ['nr_anomes', num],
    DC_FupProduto: ['dc_fup_produto'], CD_Essential: ['cd_essential', num],
    DC_AprovacaoCor: ['dc_aprovacao_cor'], NR_TotalFOB: ['nr_total_fob', num],
  }],
  ['DM_FollowUp_Fornecedor', 'followup_fornecedor', 'cd_follow_forn', {
    CD_FollowForn: ['cd_follow_forn', num], CD_Compra: ['cd_compra', num],
    DT_RevisedDelivery_Original: ['dt_revised_delivery_original', dateOnly],
    DT_RecebimentoCB_Original: ['dt_recebimento_cb_original', dateOnly],
    DC_Modal_Original: ['dc_modal_original'], DC_StatusFornecedor: ['dc_status_fornecedor'],
    DC_Observacao_Fornecedor: ['dc_observacao_fornecedor'],
    DT_RevisedDelivery_Proposta: ['dt_revised_delivery_proposta', dateOnly],
    DC_NumeroBL: ['dc_numero_bl'], DC_AvaliacaoFornecedor: ['dc_avaliacao_fornecedor'],
    DC_Avaliacao_Comprador: ['dc_avaliacao_comprador'], DC_Observacao_Avaliacao: ['dc_observacao_avaliacao'],
    DT_NovoRecebimento_Comprador: ['dt_novo_recebimento_comprador', dateOnly],
    DT_NovoDelivery_Comprador: ['dt_novo_delivery_comprador', dateOnly],
    DC_NovoModal_Comprador: ['dc_novo_modal_comprador'], DC_AvaliacaoFinal: ['dc_avaliacao_final'],
    DT_Inicio_FollowUp: ['dt_inicio_followup', dateOnly], DT_Fim_FollowUp: ['dt_fim_followup', dateOnly],
    DT_Avaliacao_Comprador: ['dt_avaliacao_comprador', dateOnly],
  }],
  ['DM_RegistroTransacao_Usuario', 'log_transacoes', 'cd_transacao', {
    CD_Transacao: ['cd_transacao', num], CD_Usuario: ['cd_usuario_legado', num],
    DC_Transacao: ['transacao', (v) => v ?? ''], CD_ItemTransacao: ['cd_item_transacao', num],
    DT_Transacao: ['dt_transacao'], DC_InfoAnterior: ['info_anterior'],
    DC_InfoAtual: ['info_atual'], DC_CampoEditado: ['campo_editado'],
  }],
  ['DM_Usuarios', 'usuarios_legado', 'cd_usuario', {
    CD_Usuario: ['cd_usuario', num], CD_LoginRede: ['cd_login_rede'],
    DC_Email: ['dc_email'], DC_FiltroComprador: ['dc_filtro_comprador'],
  }],
  ['EXT_FUP_Comex', 'ext_fup_comex', null, {
    CD_SequenciaEmbarque: ['cd_sequencia_embarque'], CD_Embarque: ['cd_embarque'],
    CD_PedidoSAP: ['cd_pedido_sap'], CD_Material: ['cd_material'], CD_MaterialPai: ['cd_material_pai'],
    DT_EntregaOrigem: ['dt_entrega_origem', dateOnly], DT_PrevisaoEmbarque: ['dt_previsao_embarque', dateOnly],
    DT_EmbarqueReal: ['dt_embarque_real', dateOnly], DT_PrevisaoAtraque: ['dt_previsao_atraque', dateOnly],
    DT_AtraqueReal: ['dt_atraque_real', dateOnly], DT_ChegadaCB: ['dt_chegada_cb', dateOnly],
    NR_Quantidade: ['nr_quantidade', num], NR_FOB_Total: ['nr_fob_total', num],
    DC_StatusComex: ['dc_status_comex'],
  }],
  ['EXT_FUP_Despachante', 'ext_fup_despachante', null, {
    'Pedido SAP': ['cd_pedido_sap'], 'Material Pai': ['cd_material_pai'], CD_Embarque: ['cd_embarque'],
    DT_EntregaOrigem: ['dt_entrega_origem', dateOnly], DT_PrevisaoEmbarque: ['dt_previsao_embarque', dateOnly],
    DT_EmbarqueReal: ['dt_embarque_real', dateOnly], DT_PrevisaoAtraque: ['dt_previsao_atraque', dateOnly],
    DT_AtraqueReal: ['dt_atraque_real', dateOnly], HBL: ['hbl'],
    DC_StatusComex: ['dc_status_comex'], DC_Observacao: ['dc_observacao'], Origem: ['origem'],
  }],
  ['EXT_Pedido_SAP', 'ext_pedido_sap', null, {
    CD_PedidoSAP: ['cd_pedido_sap'], CD_Material: ['cd_material'], CD_MaterialPai: ['cd_material_pai'],
    NR_ValorFOB: ['nr_valor_fob', num], NR_Quantidade: ['nr_quantidade', num],
    DC_Modal: ['dc_modal'], DC_Cor_LenteSolar: ['dc_cor_lente_solar'], DC_Cor_Armacao: ['dc_cor_armacao'],
  }],
  ['EXT_SAP_PedidoBW', 'ext_sap_pedido_bw', 'comp_code,oi_ebeln,oi_ebelp', {
    COMP_CODE: ['comp_code'], OI_EBELN: ['oi_ebeln'], OI_EBELP: ['oi_ebelp'],
    RECORDMODE: ['recordmode'], MATERIAL: ['material'], TXT_MATERIAL: ['txt_material'],
    ERDAT: ['erdat'], VENDOR: ['vendor'], '/BIC/CA_IMPNA': ['ca_impna'], DSDEL_DATE: ['dsdel_date'],
    DOCTYPE: ['doctype'], NET_PO_VAL: ['net_po_val', num], TTLQTY: ['ttlqty', num],
    BASE_UOM: ['base_uom'], '/BIC/CA_MODAL': ['ca_modal'], TXTLG: ['txtlg'], ORDER_CURR: ['order_curr'],
  }],
  ['DM_Pasta_PI', 'pasta_pi', 'dc_nome_arquivo', {
    DC_Nome_Arquivo: ['dc_nome_arquivo'], DC_Caminho_Arquivo: ['dc_caminho_arquivo'],
    DC_Tipo_Arquivo: ['dc_tipo_arquivo'], DT_Moficacao_Arquivo: ['dt_modificacao_arquivo'],
    DC_StatusMovimentacao: ['dc_status_movimentacao'], CD_Sysplan: ['cd_sysplan', num],
    DC_Sore: ['dc_sore'], CD_PI: ['cd_pi'], DT_DeliveryDate: ['dt_delivery_date', dateOnly],
    CD_RefFornecedor: ['cd_ref_fornecedor'], DC_Fornecedor: ['dc_fornecedor'],
    DC_Reorder: ['dc_reorder'], CD_LastModel: ['cd_last_model'], DC_Griffe: ['dc_griffe'],
    NR_Qtd_Total: ['nr_qtd_total', num], NR_Fob_Total: ['nr_fob_total', num],
    DC_FRame1: ['dc_frame1'], DC_Frame2: ['dc_frame2'], DC_Lens: ['dc_lens'],
    DC_Atributo1: ['dc_atributo1'], DC_Atributo2: ['dc_atributo2'], DC_Atributo3: ['dc_atributo3'],
    DC_Flap: ['dc_flap'], DC_Hinge: ['dc_hinge'], DC_Size: ['dc_size'],
    DC_Temple1: ['dc_temple1'], DC_Temple2: ['dc_temple2'], DC_Bridge: ['dc_bridge'],
    DC_Rim: ['dc_rim'], DC_Tips: ['dc_tips'], DC_NosePad: ['dc_nose_pad'],
    DC_LensCategory: ['dc_lens_category'], DC_LensTratamento1: ['dc_lens_tratamento1'],
    DC_LensTratamento2: ['dc_lens_tratamento2'], DC_CliponType: ['dc_clipon_type'],
    DC_PossuiFoto: ['dc_possui_foto'], DC_CaminhoFoto: [null],
  }],
];

async function importJob([csvName, table, pk, map]) {
  const file = path.join(DATA_DIR, `${csvName}.csv`);
  if (!existsSync(file)) {
    console.log(`-- ${csvName}: CSV não encontrado, pulado`);
    return;
  }
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.length === header.length);
  const cols = header.map((h) => map[h] ?? [null]);

  const records = dataRows.map((r) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      const [pgCol, transform] = cols[i];
      if (!pgCol) continue;
      obj[pgCol] = transform ? transform(r[i]) : r[i];
    }
    return obj;
  });

  // dedupe por PK (o Access permite duplicatas onde não havia índice)
  let unique = records;
  if (pk) {
    const seen = new Set();
    unique = records.filter((rec) => {
      const key = pk.split(',').map((c) => rec[c]).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const query = pk ? `?on_conflict=${pk}` : '';
  const prefer = pk ? 'return=minimal,resolution=ignore-duplicates' : 'return=minimal';
  let done = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    await restRequest(env, 'POST', `/rest/v1/${table}${query}`, batch, { Prefer: prefer });
    done += batch.length;
    process.stdout.write(`\r   ${table}: ${done}/${unique.length}`);
  }
  console.log(`\rOK ${table}: ${unique.length} registros${records.length !== unique.length ? ` (${records.length - unique.length} duplicados ignorados)` : ''}`);
}

console.log('Iniciando migração de dados para o Supabase...\n');
for (const job of JOBS) {
  await importJob(job);
}

console.log('\nRealinhando sequences (fn_pos_migracao)...');
await restRequest(env, 'POST', '/rest/v1/rpc/fn_pos_migracao', {});
console.log('Migração concluída.');
