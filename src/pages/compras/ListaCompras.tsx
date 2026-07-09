import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCombos, useCompradores } from '@/services/combos';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarCsv, exportarExcel, exportarPdf, type ColunaExport } from '@/lib/exportar';
import { anoMes, formatNumber, formatPercent } from '@/lib/utils';
import type { CompraLista, ConfigColuna } from '@/types';
import { campoParaColuna, renderizador } from './colunas';
import { EdicaoCompra } from './EdicaoCompra';
import { EdicaoMassaCampo } from './EdicaoMassaCampo';
import { FotoProduto } from './FotoProduto';

interface FiltroAvancado {
  campo: string;
  operador: string;
  valor: string;
}

export default function ListaCompras() {
  const { usuario, podeEditar, registraLog } = useAuth();
  const qc = useQueryClient();
  const editavel = podeEditar('lista_compras');

  const filtroInicial = usuario?.filtro_comprador && usuario.filtro_comprador !== 'GERAL'
    ? usuario.filtro_comprador
    : '';
  const [comprador, setComprador] = useState(filtroInicial);
  const [compradorGrupo, setCompradorGrupo] = useState('');
  const [anoMesInicio, setAnoMesInicio] = useState(String(anoMes(-10)));
  const [filtrosAvancados, setFiltrosAvancados] = useState<FiltroAvancado[]>([]);
  const [dialogFiltros, setDialogFiltros] = useState(false);
  const [cdEdicao, setCdEdicao] = useState<number | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [fotoRef, setFotoRef] = useState<string | null>(null);

  const { data: configCols } = useQuery({
    queryKey: ['prm_lista_compras'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prm_lista_compras')
        .select('*')
        .eq('exibir', 'SIM')
        .order('ordem');
      if (error) throw error;
      return data as ConfigColuna[];
    },
  });

  const { data: compras, isLoading, refetch } = useQuery({
    queryKey: ['compras_lista', comprador, compradorGrupo, anoMesInicio],
    queryFn: async () =>
      fetchAll<CompraLista>((inicio, fim) => {
        let q = supabase.from('vw_controle_compras_lista').select('*');
        if (anoMesInicio) q = q.gte('nr_anomes', Number(anoMesInicio));
        if (comprador) q = q.eq('dc_comprador', comprador);
        if (compradorGrupo) q = q.eq('dc_comprador_grupo', compradorGrupo);
        return q.order('dt_recebimento', { ascending: true }).order('cd_compra').range(inicio, fim);
      }),
  });

  const { data: compradores } = useCompradores();
  useCombos();

  const listaCompradores = useMemo(
    () => [...new Set((compradores ?? []).map((c: any) => c.dc_comprador).filter(Boolean))].sort() as string[],
    [compradores],
  );
  const listaCompradorGrupos = useMemo(
    () => [...new Set((compradores ?? []).map((c: any) => c.dc_comprador_grupo).filter(Boolean))].sort() as string[],
    [compradores],
  );

  const filtrados = useMemo(() => {
    let r = compras ?? [];
    for (const f of filtrosAvancados) {
      if (!f.valor) continue;
      const col = campoParaColuna(f.campo);
      const v = f.valor.toLowerCase();
      r = r.filter((row: any) => {
        const cell = row[col];
        if (cell == null) return f.operador === '<>';
        const s = String(cell).toLowerCase();
        switch (f.operador) {
          case '=': return s === v;
          case '<>': return s !== v;
          case 'Like': return s.includes(v);
          case '>=': return Number(cell) >= Number(f.valor) || s >= v;
          case '<=': return Number(cell) <= Number(f.valor) || s <= v;
          default: return true;
        }
      });
    }
    return r;
  }, [compras, filtrosAvancados]);

  const colunas: Coluna<CompraLista>[] = useMemo(() => {
    const base: Coluna<CompraLista>[] = (configCols ?? []).map((c) => ({
      key: campoParaColuna(c.campo),
      titulo: c.legenda_exibicao ?? c.campo,
      render: renderizador(c),
    }));
    return base.length > 0
      ? base
      : [
          { key: 'cd_compra', titulo: 'CD' },
          { key: 'dc_status', titulo: 'Status' },
          { key: 'dc_canal', titulo: 'Canal' },
          { key: 'dc_grupo', titulo: 'Grupo' },
        ];
  }, [configCols]);

  const resumo = useMemo(() => {
    const qtde = filtrados.reduce((s, r) => s + (r.nr_quantidade ?? 0), 0);
    const fobPond = filtrados.reduce((s, r) => s + (r.nr_quantidade ?? 0) * (r.fob_calc ?? r.nr_fob_negociado ?? 0), 0);
    const pvPond = filtrados.reduce((s, r) => s + (r.nr_quantidade ?? 0) * (r.nr_preco_varejo ?? 0), 0);
    const margemPond = filtrados.reduce((s, r) => s + (r.nr_quantidade ?? 0) * (r.margem_calc ?? 0), 0);
    return {
      linhas: filtrados.length,
      qtde,
      fobMedio: qtde ? fobPond / qtde : 0,
      pvMedio: qtde ? pvPond / qtde : 0,
      margem: qtde ? margemPond / qtde : 0,
    };
  }, [filtrados]);

  const excluir = useMutation({
    mutationFn: async (cd: number) => {
      const { error } = await supabase
        .from('controle_compras')
        .update({ dc_status: 'EXCLUIDO' })
        .eq('cd_compra', cd);
      if (error) throw error;
      registraLog('EdicaoCompra - Excluir', cd);
    },
    onSuccess: () => {
      toast.success('Registro excluído.');
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const colunasExport: ColunaExport[] = colunas.map((c) => ({ key: c.key, titulo: c.titulo }));
  const dadosExport = filtrados.map((r: any) => {
    const o: Record<string, any> = {};
    for (const c of colunas) o[c.key] = r[c.key];
    return o;
  });

  const abrirEdicao = async (row: CompraLista) => {
    if (!editavel) return;
    const { data, error } = await supabase.rpc('fn_bloquear_compra', {
      p_cd_compra: row.cd_compra,
      p_bloquear: true,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data === false) {
      const { data: c } = await supabase
        .from('controle_compras')
        .select('usuario_bloqueio, usuarios:usuario_bloqueio(nome)')
        .eq('cd_compra', row.cd_compra)
        .single();
      toast.warning(`Linha bloqueada para edição | Usuário: ${(c as any)?.usuarios?.nome ?? 'desconhecido'}`);
      return;
    }
    registraLog('EdicaoCompra - Consulta', row.cd_compra);
    setCdEdicao(row.cd_compra);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lista de Compras</h1>
          <p className="text-sm text-muted-foreground">Carteira de compras e importação</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editavel && (
            <Button onClick={() => setCdEdicao(0)}>
              <Plus /> Novo Registro
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialogFiltros(true)}>
            <Filter /> Filtros {filtrosAvancados.length > 0 && <Badge>{filtrosAvancados.length}</Badge>}
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw /> Atualizar
          </Button>
          <Button variant="outline" onClick={() => { exportarExcel(colunasExport, dadosExport, 'SysPlan_ListaCompras'); registraLog('ListaCompras - Exportacao Excel'); }}>
            <FileSpreadsheet /> Excel
          </Button>
          <Button variant="outline" onClick={() => { exportarCsv(colunasExport, dadosExport, 'SysPlan_ListaCompras'); registraLog('ListaCompras - Exportacao CSV'); }}>
            <Download /> CSV
          </Button>
          <Button variant="outline" onClick={() => { exportarPdf(colunasExport, dadosExport, 'SysPlan_ListaCompras', 'SysPlan - Lista de Compras'); registraLog('ListaCompras - Exportacao PDF'); }}>
            <FileText /> PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-44">
            <Label>Comprador</Label>
            <Select value={comprador} onChange={(e) => setComprador(e.target.value)} placeholder="Todos" options={listaCompradores} />
          </div>
          <div className="w-44">
            <Label>Grupo / Comprador</Label>
            <Select value={compradorGrupo} onChange={(e) => setCompradorGrupo(e.target.value)} placeholder="Todos" options={listaCompradorGrupos} />
          </div>
          <div className="w-32">
            <Label>AnoMês início</Label>
            <Input value={anoMesInicio} onChange={(e) => setAnoMesInicio(e.target.value.replace(/\D/g, ''))} />
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setComprador(filtroInicial);
              setCompradorGrupo('');
              setAnoMesInicio(String(anoMes(-10)));
              setFiltrosAvancados([]);
            }}
          >
            Limpar filtros
          </Button>
          {selecionadas.size >= 2 && editavel && (
            <EdicaoMassaCampo
              selecionadas={selecionadas}
              onAplicado={() => {
                setSelecionadas(new Set());
                qc.invalidateQueries({ queryKey: ['compras_lista'] });
              }}
            />
          )}
        </CardContent>
      </Card>

      <DataTable
        colunas={[
          ...colunas,
          ...(editavel
            ? [{
                key: '__acoes',
                titulo: '',
                ordenavel: false,
                render: (row: CompraLista) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    title="Excluir (lógico)"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`O registro ${row.cd_compra} será marcado como EXCLUIDO. Continuar?`)) {
                        excluir.mutate(row.cd_compra);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ),
              } as Coluna<CompraLista>]
            : []),
        ]}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.cd_compra}
        selecionadas={selecionadas}
        onRowClick={(row) => {
          setFotoRef(row.cd_material_fornecedor);
          setSelecionadas((s) => {
            const n = new Set(s);
            if (n.has(row.cd_compra)) n.delete(row.cd_compra);
            else n.add(row.cd_compra);
            return n;
          });
        }}
        onRowDoubleClick={abrirEdicao}
        rodape={
          <span className="ml-3">
            Qtde: <b>{formatNumber(resumo.qtde, 0)}</b> · FOB médio: <b>{formatNumber(resumo.fobMedio)}</b> · PV médio:{' '}
            <b>{formatNumber(resumo.pvMedio)}</b> · Margem: <b>{formatPercent(resumo.margem)}</b>
          </span>
        }
      />

      <FotoProduto refFornecedor={fotoRef} />

      <Dialog open={dialogFiltros} onOpenChange={setDialogFiltros}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Filtros avançados</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {filtrosAvancados.map((f, i) => (
              <div key={i} className="flex gap-2">
                <Select
                  className="flex-1"
                  value={f.campo}
                  onChange={(e) => {
                    const n = [...filtrosAvancados];
                    n[i] = { ...f, campo: e.target.value };
                    setFiltrosAvancados(n);
                  }}
                >
                  {(configCols ?? []).map((c) => (
                    <option key={c.campo} value={c.campo}>{c.legenda_exibicao ?? c.campo}</option>
                  ))}
                </Select>
                <Select
                  className="w-28"
                  value={f.operador}
                  onChange={(e) => {
                    const n = [...filtrosAvancados];
                    n[i] = { ...f, operador: e.target.value };
                    setFiltrosAvancados(n);
                  }}
                  options={['Like', '=', '<>', '>=', '<=']}
                />
                <Input
                  className="flex-1"
                  value={f.valor}
                  onChange={(e) => {
                    const n = [...filtrosAvancados];
                    n[i] = { ...f, valor: e.target.value };
                    setFiltrosAvancados(n);
                  }}
                />
                <Button variant="ghost" size="icon" onClick={() => setFiltrosAvancados(filtrosAvancados.filter((_, j) => j !== i))}>
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFiltrosAvancados([
                  ...filtrosAvancados,
                  { campo: configCols?.[0]?.campo ?? 'DC_Status', operador: 'Like', valor: '' },
                ])
              }
            >
              <Plus /> Adicionar filtro
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiltrosAvancados([])}>Limpar</Button>
            <Button onClick={() => setDialogFiltros(false)}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {cdEdicao !== null && (
        <EdicaoCompra
          cdCompra={cdEdicao}
          onFechar={(salvou) => {
            setCdEdicao(null);
            if (salvou) qc.invalidateQueries({ queryKey: ['compras_lista'] });
          }}
        />
      )}

    </div>
  );
}
