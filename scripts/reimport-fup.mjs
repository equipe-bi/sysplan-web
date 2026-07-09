// Reimporta EXT_FUP_Comex e EXT_FUP_Despachante do zero (fiel ao snapshot do Access)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv, parseCsv, restRequest } from './lib.mjs';

const env = loadEnv();
const DATA_DIR = path.join(ROOT, 'migration', 'data');
const dateOnly = (v) => (v ? v.slice(0, 10) : null);
const num = (v) => (v === null || v === '' ? null : Number(v));

const JOBS = [
  ['EXT_FUP_Comex', 'ext_fup_comex', {
    CD_SequenciaEmbarque: ['cd_sequencia_embarque'], CD_Embarque: ['cd_embarque'],
    CD_PedidoSAP: ['cd_pedido_sap'], CD_Material: ['cd_material'], CD_MaterialPai: ['cd_material_pai'],
    DT_EntregaOrigem: ['dt_entrega_origem', dateOnly], DT_PrevisaoEmbarque: ['dt_previsao_embarque', dateOnly],
    DT_EmbarqueReal: ['dt_embarque_real', dateOnly], DT_PrevisaoAtraque: ['dt_previsao_atraque', dateOnly],
    DT_AtraqueReal: ['dt_atraque_real', dateOnly], DT_ChegadaCB: ['dt_chegada_cb', dateOnly],
    NR_Quantidade: ['nr_quantidade', num], NR_FOB_Total: ['nr_fob_total', num],
    DC_StatusComex: ['dc_status_comex'],
  }],
  ['EXT_FUP_Despachante', 'ext_fup_despachante', {
    'Pedido SAP': ['cd_pedido_sap'], 'Material Pai': ['cd_material_pai'], CD_Embarque: ['cd_embarque'],
    DT_EntregaOrigem: ['dt_entrega_origem', dateOnly], DT_PrevisaoEmbarque: ['dt_previsao_embarque', dateOnly],
    DT_EmbarqueReal: ['dt_embarque_real', dateOnly], DT_PrevisaoAtraque: ['dt_previsao_atraque', dateOnly],
    DT_AtraqueReal: ['dt_atraque_real', dateOnly], HBL: ['hbl'],
    DC_StatusComex: ['dc_status_comex'], DC_Observacao: ['dc_observacao'], Origem: ['origem'],
  }],
];

for (const [csvName, table, map] of JOBS) {
  await restRequest(env, 'DELETE', `/rest/v1/${table}?id=gte.0`, undefined, { Prefer: 'return=minimal' });
  const rows = parseCsv(readFileSync(path.join(DATA_DIR, `${csvName}.csv`), 'utf8'));
  const header = rows[0];
  const cols = header.map((h) => map[h] ?? [null]);
  const records = rows.slice(1).filter((r) => r.length === header.length).map((r) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      const [pgCol, transform] = cols[i];
      if (!pgCol) continue;
      obj[pgCol] = transform ? transform(r[i]) : r[i];
    }
    return obj;
  });
  for (let i = 0; i < records.length; i += 2000) {
    await restRequest(env, 'POST', `/rest/v1/${table}`, records.slice(i, i + 2000), { Prefer: 'return=minimal' });
  }
  console.log(`${table}: ${records.length} registros reimportados`);
}
console.log('Concluído.');
