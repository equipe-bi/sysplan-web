// Importa o histórico da planilha do despachante (BaseHoffen) para acompanhamento_importacoes.
// Uso: node scripts/import-hoffen.mjs "caminho/AcompanhamentoImportacoes_ChilliBeansHoffen.xlsx"
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadEnv, restRequest } from './lib.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const env = loadEnv();
const arquivo = process.argv[2] ?? path.join(ROOT, '..', 'AcompanhamentoImportacoes_ChilliBeansHoffen.xlsx');

const wb = XLSX.readFile(arquivo, { cellDates: true });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets['BaseHoffen'], { defval: null });

const dt = (v) => {
  if (v instanceof Date) {
    // datas "vazias" do Excel (1899-12-30)
    if (v.getFullYear() < 1990) return null;
    return v.toISOString().slice(0, 10);
  }
  return null;
};
const s = (v) => (v == null || v === 0 || v === '0' ? null : String(v).trim() || null);

const registros = linhas
  .filter((l) => s(l['Pedido SAP']) && s(l['Material Pai']))
  .map((l) => ({
    dc_grupo: s(l['Grupo']),
    dc_linha: s(l['Linha']),
    dc_griffe: s(l['Griffe']),
    dc_canal: s(l['Canal']),
    dc_fornecedor: s(l['Fornecedor']),
    cd_ref_fornecedor: s(l['Ref Fornecedor']),
    cd_material_pai: s(l['Material Pai']),
    cd_pedido_fornecedor: s(l['Pedido Fornecedor']),
    cd_pedido_sap: s(l['Pedido SAP']),
    nr_quantidade: Number(l['Quantidade']) || 0,
    dt_recebimento: dt(l['Data Recebimento']),
    dc_modal: s(l['Modal']),
    dt_delivery: dt(l['Delivery Date']),
    dc_data_inicio: s(l['Data Inicio']),
    cd_embarque: s(l['Cod Hoffen']),
    id_origem: s(l['ID Origem']),
    dt_entrega_origem_real: dt(l['Entrega Origem Real']),
    dt_etd: dt(l['ETD']),
    dt_atd: dt(l['ATD']),
    dt_eta: dt(l['ETA']),
    dt_ata: dt(l['ATA']),
    hbl: s(l['HBL']),
    vessel: s(l['VESSEL']),
    ctnr: s(l['CTNR']),
    dc_observacoes: s(l['Observações']),
  }));

console.log(`Planilha: ${linhas.length} linhas; válidas: ${registros.length}`);
for (let i = 0; i < registros.length; i += 1000) {
  await restRequest(env, 'POST', '/rest/v1/acompanhamento_importacoes', registros.slice(i, i + 1000), {
    Prefer: 'return=minimal',
  });
  process.stdout.write(`\r${Math.min(i + 1000, registros.length)}/${registros.length}`);
}
console.log('\nHistórico do despachante importado.');
