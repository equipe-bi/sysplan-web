/**
 * Geração do arquivo de Follow-up de Fornecedor, replicando a máscara oficial
 * (Followup_Fornecedor_Mascara.xlsb):
 *  - Aba Orders: A–L dados do SysPlan (bloqueados), M–P preenchidos pelo fornecedor
 *    (M com lista suspensa), Q–Z avaliação Chilli Beans (fórmulas; R lista suspensa)
 *  - Aba DePara: dicionários de status/avaliação/modal usados por fórmulas e listas
 *  - Planilha protegida com senha Plan8 (só células liberadas são editáveis)
 */

export interface LinhaFollowExport {
  cdFollow: number;
  cdCompra: number;
  supplier: string;
  supplierOrder: string;
  supplierReference: string;
  cbOrder: string;
  cdReference: string;
  group: string;
  collection: string;
  deliveryDate: string | null;   // ISO yyyy-mm-dd
  cbArrivalDate: string | null;
  modal: string;
}

const SENHA = 'Plan8';

const DEPARA: (string | number | null)[][] = [
  ['STATUS FORNECEDOR', null, null, 'STATUS CHILLI BEANS', null, 'Modal'],
  ['NOT STARTED', 'NÃO INICIADO', null, 'SEM ALTERAÇÃO', 1, 'SEA'],
  ['IN PRODUCTION - NO PENDING', 'EM PRODUÇÃO - SEM PENDENCIAS', null, 'RECUSAR ALTERAÇÃO DELIVERY', 2, 'AIR'],
  ['IN PRODUCTION - DELAY', 'EM PRODUÇÃO - ATRASO', null, 'ACEITAR ALTERAÇÃO DELIVERY', 3, 'AIR PREPAID'],
  ['WAITING - APPROVAL', 'AGUARDANDO - APROVAÇÃO', null, 'ACEITAR ALTERAÇÃO DELIVERY | MUDANÇA RECEBIMENTO', 4, 'ROAD'],
  ['WAITING - COLOR CODE', 'AGUARDANDO - CODIGO DE COR', null, 'ACEITAR ALTERAÇÃO DELIVERY | MUDANÇA MODAL AIR COLLECTION', 5, 'SEA - SECULUS'],
  ['WAITING - BOARDING INSTRUCTION', 'AGUARDANDO - INSTRUÇÃO DE EMBARQUE', null, 'ACEITAR ALTERAÇÃO DELIVERY | MUDANÇA MODAL AIR PREPAID', 6, 'AIR - SECULUS'],
  ['WAITING - OTHERS', 'AGUARDANDO - OUTROS', null, null, null, 'SEA - MONTADO'],
  ['READY', 'CARGA PRONTA', null, null, null, 'AIR - MONTADO'],
  ['DELIVERED', 'CARGA ENTREGUE', null, null, null, null],
  ['NO RESPONSE SUPPLIER', 'SEM RESPOSTA FORNECEDOR', null, null, null, null],
];

const CABECALHO = [
  'CD Follow', 'CD Compra', 'Supplier', 'Supplier Order', 'Supplier Reference',
  'CB Order', 'CD Reference', 'Group', 'Collection', 'Delivery Date',
  'CB Arrival Date', 'Modal', 'Production Status', 'Revised Delivery Date',
  'BL - bill of lading Number', 'Supplier Comments', 'Status fornecedor',
  'Avaliação Comprador', 'Observação Comprador', 'Novo Recebimento',
  'Novo Delivery', 'Novo Modal', 'Cd_analise', 'Lead Time Original',
  'Lead Time Revisado', 'Avaliação Final',
];

function dataLocal(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`);
}

/** Fórmulas por linha (r = número da linha na planilha), fiéis à máscara */
function formulas(r: number): Record<string, string> {
  return {
    N: `IF(J${r}>0,J${r},0)`,
    Q: `IF(A${r}>0,IF(AND(M${r}="DELIVERED",O${r}=""),"INFORM BL",IF(OR(N${r}=0,N${r}=""),"INFORM REVISED DELIVERY",IF(N${r}>J${r},"DELIVERY DELAY",IF(N${r}<J${r},"EARLY DELIVERY",IF(M${r}="","INFORM STATUS","OTHERS"))))),"")`,
    T: `IF(W${r}=4,0,K${r})`,
    U: `IF(OR(W${r}=1,W${r}=2),J${r},N${r})`,
    V: `IF(W${r}=5,"AIR",IF(W${r}=6,"AIR PREPAID",IF(L${r}<>"",L${r},"")))`,
    W: `IFERROR(XLOOKUP(R${r},DePara!D:D,DePara!E:E,0,0,1),0)`,
    X: `IF(AND(J${r}>0,K${r}>0),K${r}-J${r},0)`,
    Y: `IF(U${r}>0,IF(T${r}>0,T${r}-U${r},K${r}-U${r}),0)`,
    Z: `IF(AND(LEFT(M${r},7)="WAITING",S${r}=""),"Pendencia fornecedor - Detalhar ação no campo obs",IF(AND(OR(W${r}=1,W${r}=2),N${r}<>J${r},S${r}=""),"Proposta Recusada - detalhar campo observação",IF(A${r}<>"",IF(OR(R${r}="",U${r}=0,T${r}=0,V${r}="",U${r}="",T${r}=""),"Avaliação Pendente",IF(OR(U${r}<>J${r},T${r}<>K${r},V${r}<>L${r}),IF(U${r}<>J${r},"Delivery Alterado","Delivery Mantido")&" | "&IF(T${r}<>K${r},"Recebimento Alterado","Recebimento Mantido")&" | "&IF(V${r}<>L${r},"Modal Alterado","Modal Mantido"),"Não Alterado")),"")))`,
  };
}

export async function gerarArquivoFollowup(linhas: LinhaFollowExport[]): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  // ---------- Aba DePara ----------
  const wsDe = wb.addWorksheet('DePara');
  DEPARA.forEach((row) => wsDe.addRow(row));
  wsDe.getRow(1).font = { bold: true };
  [18, 34, 4, 52, 6, 16].forEach((w, i) => (wsDe.getColumn(i + 1).width = w));
  await wsDe.protect(SENHA, { selectLockedCells: true });

  // ---------- Aba Orders ----------
  const ws = wb.addWorksheet('Orders', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(CABECALHO);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };

  const larguras = [10, 10, 22, 16, 18, 14, 14, 22, 26, 14, 14, 12, 26, 18, 22, 30, 22, 30, 26, 14, 14, 14, 10, 10, 10, 34];
  larguras.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const colunasData = ['J', 'K', 'N', 'T', 'U'];
  linhas.forEach((l, idx) => {
    const r = idx + 2;
    const row = ws.getRow(r);
    row.getCell('A').value = l.cdFollow;
    row.getCell('B').value = l.cdCompra;
    row.getCell('C').value = l.supplier;
    row.getCell('D').value = l.supplierOrder;
    row.getCell('E').value = l.supplierReference;
    row.getCell('F').value = l.cbOrder;
    row.getCell('G').value = l.cdReference;
    row.getCell('H').value = l.group;
    row.getCell('I').value = l.collection;
    row.getCell('J').value = dataLocal(l.deliveryDate);
    row.getCell('K').value = dataLocal(l.cbArrivalDate);
    row.getCell('L').value = l.modal;
    const f = formulas(r);
    for (const [col, formula] of Object.entries(f)) {
      row.getCell(col).value = { formula } as any;
    }
    for (const col of colunasData) row.getCell(col).numFmt = 'dd/mm/yyyy';

    // Libera para edição: M–P (fornecedor) e R, S, T (avaliação Chilli Beans)
    for (const col of ['M', 'N', 'O', 'P', 'R', 'S', 'T']) {
      row.getCell(col).protection = { locked: false };
    }
    // Listas suspensas
    row.getCell('M').dataValidation = {
      type: 'list', allowBlank: true, formulae: ['DePara!$A$2:$A$11'],
      showErrorMessage: true, errorTitle: 'Production Status',
      error: 'Selecione um status da lista.',
    };
    row.getCell('R').dataValidation = {
      type: 'list', allowBlank: true, formulae: ['DePara!$D$2:$D$7'],
      showErrorMessage: true, errorTitle: 'Avaliação',
      error: 'Selecione uma avaliação da lista.',
    };
  });

  ws.autoFilter = { from: 'A1', to: { row: 1, column: CABECALHO.length } };
  await ws.protect(SENHA, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
    formatColumns: true,
    formatRows: true,
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function baixarBlob(blob: Blob, nomeArquivo: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(a.href);
}
