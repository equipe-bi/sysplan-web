import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileDown, FileUp, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { validaCompra } from '@/lib/regras';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import type { Compra, CompraLista } from '@/types';

/** Campos editáveis em massa (equivalente a PRM_Campos_EdicaoMassa_Compras) */
const CAMPOS: (keyof Compra)[] = [
  'cd_compra', 'dc_status', 'dc_fup_produto', 'dc_canal', 'dc_grupo', 'dc_subgrupo', 'dc_formato',
  'dc_sexo', 'dc_segmentacao', 'dc_grupo_planejamento', 'dc_linha', 'cd_essential', 'dc_griffe',
  'dc_material1', 'dc_material2', 'dc_atributo1', 'dc_atributo2', 'dc_medidas', 'dc_info1',
  'dc_info2', 'dc_info3', 'dc_info4', 'dc_info5', 'dc_info6', 'dc_info7', 'dc_observacao',
  'dc_fornecedor', 'cd_material_fornecedor', 'cd_pedido_fornecedor', 'cd_pedido_sap',
  'cd_material_pai', 'nr_fob_negociado', 'nr_total_fob', 'dc_aprovacao_cor', 'nr_quantidade',
  'nr_preco_varejo', 'dt_recebimento', 'dt_delivery', 'dt_revised_delivery', 'dc_modal',
];

const CAMPOS_DATA = new Set(['dt_recebimento', 'dt_delivery', 'dt_revised_delivery']);
const CAMPOS_NUM = new Set(['cd_compra', 'cd_essential', 'nr_fob_negociado', 'nr_total_fob', 'nr_quantidade', 'nr_preco_varejo']);

interface Inconsistencia {
  linha: number;
  cd_compra: string;
  problema: string;
}

interface Diff {
  cd_compra: number;
  alteracoes: Partial<Compra>;
}

export function EdicaoMassa({
  dados,
  onFechar,
}: {
  dados: CompraLista[];
  onFechar: (mudou: boolean) => void;
}) {
  const { usuario, registraLog } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [analise, setAnalise] = useState<{
    diffs: Diff[];
    inclusoes: Partial<Compra>[];
    inconsistencias: Inconsistencia[];
  } | null>(null);
  const [aplicando, setAplicando] = useState(false);

  const exportar = () => {
    const linhas = dados.map((d) => {
      const o: Record<string, any> = {};
      for (const c of CAMPOS) o[c] = (d as any)[c] ?? '';
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wsOrig = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Edicao');
    XLSX.utils.book_append_sheet(wb, wsOrig, 'Original');
    XLSX.writeFile(wb, `SysPlan_EdicaoMassa_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
    registraLog('ListaCompras - Alteracao Massa - Exportacao');
    toast.success('Arquivo de edição em massa exportado. Edite a aba "Edicao" e importe de volta.');
  };

  const normaliza = (campo: string, valor: any): any => {
    if (valor === '' || valor == null) return CAMPOS_NUM.has(campo) ? 0 : null;
    if (CAMPOS_DATA.has(campo)) {
      if (valor instanceof Date) return valor.toISOString().slice(0, 10);
      const s = String(valor);
      const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
      return s.slice(0, 10);
    }
    if (CAMPOS_NUM.has(campo)) return Number(valor) || 0;
    return String(valor);
  };

  const analisar = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { cellDates: true });
    if (!wb.SheetNames.includes('Edicao') || !wb.SheetNames.includes('Original')) {
      toast.error('Arquivo inválido: abas "Edicao" e "Original" são obrigatórias.');
      return;
    }
    const edicao = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Edicao'], { defval: null });
    const original = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Original'], { defval: null });
    const origPorCd = new Map(original.map((r) => [Number(r.cd_compra), r]));

    const diffs: Diff[] = [];
    const inclusoes: Partial<Compra>[] = [];
    const inconsistencias: Inconsistencia[] = [];

    edicao.forEach((linha, idx) => {
      const nLinha = idx + 2;
      const cd = Number(linha.cd_compra) || 0;
      const registro: Partial<Compra> = {};
      for (const c of CAMPOS) registro[c] = normaliza(c, linha[c]) as never;

      if (cd === 0) {
        // linha nova: valida se algo foi preenchido
        const temConteudo = CAMPOS.some((c) => c !== 'cd_compra' && linha[c] != null && linha[c] !== '');
        if (!temConteudo) return;
        const erros = validaCompra({
          ...registro,
          nr_lead_time:
            registro.dt_recebimento && registro.dt_revised_delivery
              ? (new Date(registro.dt_recebimento as string).getTime() -
                  new Date(registro.dt_revised_delivery as string).getTime()) / 86_400_000
              : 0,
        });
        if (!registro.dt_recebimento || !registro.dt_delivery || !registro.dt_revised_delivery) {
          erros.push('Datas obrigatórias não preenchidas');
        }
        if (erros.length > 0) {
          inconsistencias.push({ linha: nLinha, cd_compra: 'NOVA', problema: erros.join('; ') });
        } else {
          delete registro.cd_compra;
          inclusoes.push(registro);
        }
        return;
      }

      const orig = origPorCd.get(cd);
      if (!orig) {
        inconsistencias.push({ linha: nLinha, cd_compra: String(cd), problema: 'CD não consta na aba Original (linha adicionada com CD manual?)' });
        return;
      }
      if (!registro.dt_recebimento || !registro.dt_delivery || !registro.dt_revised_delivery) {
        inconsistencias.push({ linha: nLinha, cd_compra: String(cd), problema: 'Datas obrigatórias vazias' });
        return;
      }
      const alteracoes: Partial<Compra> = {};
      for (const c of CAMPOS) {
        if (c === 'cd_compra') continue;
        const vNovo = registro[c];
        const vOrig = normaliza(c, orig[c]);
        if (String(vNovo ?? '') !== String(vOrig ?? '')) {
          alteracoes[c] = vNovo as never;
        }
      }
      if (Object.keys(alteracoes).length > 0) diffs.push({ cd_compra: cd, alteracoes });
    });

    setAnalise({ diffs, inclusoes, inconsistencias });
  };

  const aplicar = async () => {
    if (!analise) return;
    setAplicando(true);
    try {
      for (const d of analise.diffs) {
        const { error } = await supabase
          .from('controle_compras')
          .update(d.alteracoes)
          .eq('cd_compra', d.cd_compra);
        if (error) throw new Error(`CD ${d.cd_compra}: ${error.message}`);
      }
      if (analise.inclusoes.length > 0) {
        const { error } = await supabase.from('controle_compras').insert(analise.inclusoes);
        if (error) throw new Error(`Inclusões: ${error.message}`);
      }
      registraLog('ListaCompras - Alteracao Massa - Importacao', 0, '', `${analise.diffs.length} edições, ${analise.inclusoes.length} inclusões`);
      await supabase.from('importacoes').insert({
        usuario_id: usuario?.id,
        tipo: 'edicao_massa',
        total_linhas: analise.diffs.length + analise.inclusoes.length,
        linhas_validas: analise.diffs.length + analise.inclusoes.length,
        linhas_erro: analise.inconsistencias.length,
        status: 'aplicado',
        inconsistencias: analise.inconsistencias,
        aplicado_em: new Date().toISOString(),
      });
      toast.success(`Finalizado — ${analise.diffs.length} linha(s) editada(s) | ${analise.inclusoes.length} incluída(s).`);
      onFechar(true);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAplicando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edição em Massa</DialogTitle>
          <DialogDescription>
            Exporte a base filtrada, edite a aba "Edicao" no Excel e importe de volta. As alterações são
            comparadas campo a campo com a aba "Original" e registradas no log.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button variant="outline" onClick={exportar}>
            <FileDown /> Exportar base filtrada ({dados.length} linhas)
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp /> Importar arquivo editado
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsb,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analisar(f);
              e.target.value = '';
            }}
          />
        </div>

        {analise && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Badge variant="secondary">{analise.diffs.length} linha(s) com edição</Badge>
              <Badge variant="secondary">{analise.inclusoes.length} inclusão(ões)</Badge>
              <Badge variant={analise.inconsistencias.length > 0 ? 'destructive' : 'success'}>
                {analise.inconsistencias.length} inconsistência(s)
              </Badge>
            </div>
            {analise.inconsistencias.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm scrollbar-thin">
                <p className="mb-1 flex items-center gap-1 font-medium text-destructive">
                  <TriangleAlert className="h-4 w-4" /> Relatório de inconsistências (linhas ignoradas)
                </p>
                {analise.inconsistencias.map((inc, i) => (
                  <p key={i}>
                    Linha {inc.linha} (CD {inc.cd_compra}): {inc.problema}
                  </p>
                ))}
              </div>
            )}
            {analise.diffs.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm scrollbar-thin">
                <p className="mb-1 font-medium">Alterações detectadas</p>
                {analise.diffs.slice(0, 100).map((d) => (
                  <p key={d.cd_compra} className="text-muted-foreground">
                    CD {d.cd_compra}: {Object.keys(d.alteracoes).join(', ')}
                  </p>
                ))}
                {analise.diffs.length > 100 && <p>... e mais {analise.diffs.length - 100}</p>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)}>Cancelar</Button>
          <Button
            disabled={!analise || (analise.diffs.length === 0 && analise.inclusoes.length === 0)}
            loading={aplicando}
            onClick={aplicar}
          >
            Confirmar e aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
