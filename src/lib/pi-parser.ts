import * as XLSX from 'xlsx';
import JSZip from 'jszip';

/**
 * Parser da Proforma Invoice (PI) do fornecedor — porta a lógica de AvaliaPI (VBA),
 * que localizava células por rótulo na planilha e extraía o mapa de cores C1..C8.
 */

export interface CorPI {
  numero: string;
  lensColor: string;
  frameColor: string;
  frameDescription: string;
  templeColor: string;
  templeDescription: string;
  qtde: number;
  fob: number;
}

export interface DadosPI {
  cdSysplan: number;
  cdPI: string;
  deliveryDate: string | null;
  refFornecedor: string;
  fornecedor: string;
  reorder: string;
  lastModel: string;
  griffe: string;
  qtdTotal: number;
  fobTotal: number;
  frame1: string;
  frame2: string;
  lens: string;
  atributo1: string;
  atributo2: string;
  atributo3: string;
  flap: string;
  hinge: string;
  size: string;
  temple1: string;
  temple2: string;
  bridge: string;
  rim: string;
  tips: string;
  nosePad: string;
  lensCategory: string;
  lensTratamento1: string;
  lensTratamento2: string;
  cliponType: string;
  cores: CorPI[];
}

interface Celula {
  r: number;
  c: number;
  v: any;
}

function montarMatriz(ws: XLSX.WorkSheet): Celula[] {
  const celulas: Celula[] = [];
  const ref = ws['!ref'];
  if (!ref) return celulas;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null && cell.v !== '') celulas.push({ r, c, v: cell.v });
    }
  }
  return celulas;
}

export function parsePI(buffer: ArrayBuffer): DadosPI {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const celulas = montarMatriz(ws);

  const achar = (rotulo: string, exato = false): Celula | null => {
    const alvo = rotulo.toUpperCase();
    return (
      celulas.find((cel) => {
        const s = String(cel.v).toUpperCase().trim();
        return exato ? s === alvo : s.includes(alvo);
      }) ?? null
    );
  };
  const valorEm = (r: number, c: number): any =>
    celulas.find((cel) => cel.r === r && cel.c === c)?.v ?? null;

  /** valor imediatamente à direita do rótulo (coluna+1, mesma linha) */
  const aoLado = (rotulo: string): any => {
    const cel = achar(rotulo);
    if (!cel) return null;
    // procura o primeiro valor à direita (até 3 colunas — células mescladas)
    for (let dc = 1; dc <= 3; dc++) {
      const v = valorEm(cel.r, cel.c + dc);
      if (v != null && v !== '') return v;
    }
    return null;
  };

  const str = (v: any) => (v == null ? '' : String(v).trim());
  const numero = (v: any) => Number(v) || 0;
  const data = (v: any): string | null => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    if (typeof v === 'string') {
      const br = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
      const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return v.slice(0, 10);
    }
    return null;
  };

  let hinge = str(aoLado('HINGE MATERIAL'));
  if (!hinge) hinge = str(aoLado('SPRING HING'));
  let clipon = str(aoLado('CLIP ON TYPE'));
  if (!clipon) clipon = str(aoLado('CLIPON TYPE'));

  // ----- Cores C1..C8 -----
  const cores: CorPI[] = [];
  const lensColorLinha = (achar('Lens Color', true) ?? achar('Lens Color:'))?.r;
  const frameColorLinha = achar('Frame Color')?.r;
  const frameDescLinha = achar('Frame Description')?.r;
  const templeColorLinha = achar('Temple Color')?.r;
  const templeDescLinha = achar('Temple Description')?.r;
  const fobLinha = achar('Unit Price')?.r;
  const qtdeLinha = (achar('Qty Per Color') ?? achar('Qty', true))?.r;

  for (let i = 1; i <= 8; i++) {
    const col = celulas.find((cel) => String(cel.v).trim().toUpperCase() === `C${i}`)?.c;
    if (col == null) continue;
    const cor: CorPI = {
      numero: `C${i}`,
      lensColor: lensColorLinha != null ? str(valorEm(lensColorLinha, col)) : '',
      frameColor: frameColorLinha != null ? str(valorEm(frameColorLinha, col)) : '',
      frameDescription: frameDescLinha != null ? str(valorEm(frameDescLinha, col)) : '',
      templeColor: templeColorLinha != null ? str(valorEm(templeColorLinha, col)) : '',
      templeDescription: templeDescLinha != null ? str(valorEm(templeDescLinha, col)) : '',
      qtde: qtdeLinha != null ? numero(valorEm(qtdeLinha, col)) : 0,
      fob: fobLinha != null ? numero(valorEm(fobLinha, col)) : 0,
    };
    if (cor.lensColor || cor.frameColor || cor.frameDescription || cor.templeColor || cor.templeDescription) {
      cores.push(cor);
    }
  }

  return {
    cdSysplan: numero(aoLado('Sysplan number')),
    cdPI: str(aoLado('PI number')),
    deliveryDate: data(aoLado('Delivery Date')),
    refFornecedor: str(aoLado('Ref. Supplier')),
    fornecedor: str(aoLado('Supplier Name')),
    reorder: str(aoLado('REORDER')),
    lastModel: str(aoLado('Last Model')),
    griffe: str(aoLado('Griffe')),
    qtdTotal: numero(aoLado('Qty Total')),
    fobTotal: numero(aoLado('Total:')),
    frame1: str(aoLado('FRAME MATERIAL 1')),
    frame2: str(aoLado('FRAME MATERIAL 2')),
    lens: str(aoLado('LENS MATERIAL')),
    atributo1: str(aoLado('ATRIBUTE 1')),
    atributo2: str(aoLado('ATRIBUTE 2')),
    atributo3: str(aoLado('ATRIBUTE 3')),
    flap: str(aoLado('FLAP')),
    hinge,
    size: str(aoLado('SIZE CODE')),
    temple1: str(aoLado('TEMPLE MATERIAL 1')),
    temple2: str(aoLado('TEMPLE MATERIAL 2')),
    bridge: str(aoLado('BRIDGE MATERIAL')),
    rim: str(aoLado('RIM MATERIAL')),
    tips: str(aoLado('TIPS MATERIAL')),
    nosePad: str(aoLado('NOSE PAD')),
    lensCategory: str(aoLado('LENS CATEGORY')),
    lensTratamento1: str(aoLado('LENS TREATAMENT 1')),
    lensTratamento2: str(aoLado('LENS TREATAMENT 2')),
    cliponType: clipon,
    cores,
  };
}

/**
 * Extrai a foto do produto do arquivo xlsx (maior imagem embutida em xl/media),
 * substituindo a extração de shape via COM do legado.
 */
export async function extrairFotoPI(buffer: ArrayBuffer): Promise<Blob | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const midias = Object.keys(zip.files).filter(
      (n) => n.startsWith('xl/media/') && /\.(png|jpe?g|gif|bmp)$/i.test(n),
    );
    if (midias.length === 0) return null;
    let maior: { nome: string; tamanho: number } | null = null;
    for (const nome of midias) {
      const conteudo = await zip.files[nome].async('uint8array');
      if (!maior || conteudo.length > maior.tamanho) maior = { nome, tamanho: conteudo.length };
    }
    if (!maior) return null;
    const bytes = await zip.files[maior.nome].async('arraybuffer');
    const ext = maior.nome.split('.').pop()!.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/** Tradutor de cores EN→PT usando o dicionário prm_cor_pi (ExtrairCorPortugues do VBA) */
export function traduzirCor(
  texto: string,
  tipo: string,
  dicionario: { dc_campo: string; dc_texto_ingles: string; dc_texto_portugues: string; ordem_pesquisa: number }[],
): string {
  if (!texto) return '';
  const candidatos = dicionario
    .filter((d) => d.dc_campo === tipo)
    .sort((a, b) => a.ordem_pesquisa - b.ordem_pesquisa);
  const upper = texto.toUpperCase();
  for (const c of candidatos) {
    if (c.dc_texto_ingles && upper.includes(c.dc_texto_ingles.toUpperCase().trim())) {
      return c.dc_texto_portugues ?? '';
    }
  }
  return '';
}

export function traduzCoresPI(cor: CorPI, dicionario: any[]) {
  const corLente = traduzirCor(cor.lensColor, 'COR BASE', dicionario);
  const detalheLente = traduzirCor(cor.lensColor, 'DETALHE LENTE', dicionario);
  const lensPT = corLente + (detalheLente ? ` ${detalheLente}` : '');

  const framePT = traduzirCor(cor.frameColor, 'COR BASE', dicionario);
  let acab = traduzirCor(cor.frameDescription, 'ACABAMENTO PINTURA', dicionario) || traduzirCor(cor.frameColor, 'ACABAMENTO PINTURA', dicionario);
  let tipoAcab = traduzirCor(cor.frameDescription, 'TIPO PINTURA', dicionario) || traduzirCor(cor.frameColor, 'TIPO PINTURA', dicionario);
  const acabFramePT = tipoAcab && acab ? `${tipoAcab} ${acab}` : tipoAcab || acab;

  const templePT = traduzirCor(cor.templeColor, 'COR BASE', dicionario);
  acab = traduzirCor(cor.templeDescription, 'ACABAMENTO PINTURA', dicionario) || traduzirCor(cor.templeColor, 'ACABAMENTO PINTURA', dicionario);
  tipoAcab = traduzirCor(cor.templeDescription, 'TIPO PINTURA', dicionario) || traduzirCor(cor.templeColor, 'TIPO PINTURA', dicionario);
  const acabTemplePT = tipoAcab && acab ? `${tipoAcab} ${acab}` : tipoAcab || acab;

  return { lensPT, framePT, acabFramePT, templePT, acabTemplePT };
}
