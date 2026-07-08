import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ColunaExport {
  key: string;
  titulo: string;
}

function montaMatriz(colunas: ColunaExport[], dados: Record<string, any>[]) {
  const header = colunas.map((c) => c.titulo);
  const rows = dados.map((d) => colunas.map((c) => d[c.key] ?? ''));
  return { header, rows };
}

export function exportarExcel(
  colunas: ColunaExport[],
  dados: Record<string, any>[],
  nomeArquivo: string,
  nomeAba = 'Dados',
) {
  const { header, rows } = montaMatriz(colunas, dados);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  XLSX.writeFile(wb, `${nomeArquivo}.xlsx`);
}

export function exportarCsv(
  colunas: ColunaExport[],
  dados: Record<string, any>[],
  nomeArquivo: string,
) {
  const { header, rows } = montaMatriz(colunas, dados);
  const esc = (v: any) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nomeArquivo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportarPdf(
  colunas: ColunaExport[],
  dados: Record<string, any>[],
  nomeArquivo: string,
  titulo: string,
) {
  const { header, rows } = montaMatriz(colunas, dados);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  doc.setFontSize(14);
  doc.text(titulo, 40, 36);
  doc.setFontSize(9);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 52);
  autoTable(doc, {
    head: [header],
    body: rows.map((r) => r.map((v) => String(v))),
    startY: 64,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [31, 58, 122] },
  });
  doc.save(`${nomeArquivo}.pdf`);
}

/** Lê a primeira planilha de um arquivo Excel/CSV como matriz de objetos */
export async function lerPlanilha(file: File, aba?: string): Promise<Record<string, any>[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { cellDates: true });
  const nome = aba && wb.SheetNames.includes(aba) ? aba : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: null, raw: true });
}

/** Lê uma planilha como matriz bruta (linhas x colunas), para PI com layout livre */
export async function lerPlanilhaMatriz(file: File): Promise<any[][]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
}
