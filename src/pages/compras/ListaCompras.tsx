import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
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
import { SearchInput } from '@/components/ui/search-input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarCsv, exportarExcel, exportarPdf, type ColunaExport, lerPlanilha } from '@/lib/exportar';
import { anoMes, formatDateTime, formatNumber, formatPercent, hojeISO } from '@/lib/utils';
import { miniaturaUrl } from '@/lib/cloudinary';
import type { CompraLista, ConfigColuna } from '@/types';
import { campoParaColuna, renderizador } from './colunas';
import { CadastroMassa } from './CadastroMassa';
import { EdicaoCompra } from './EdicaoCompra';
import { EdicaoMassaCampo } from './EdicaoMassaCampo';
import { FotoCabecalho } from './FotoProduto';

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
  const [fPO, setFPO] = useState(filtroInicial);
  const [fPI, setFPI] = useState('');
  const [anoMesInicio, setAnoMesInicio] = useState(String(anoMes(-10)));
  const [filtrosAvancados, setFiltrosAvancados] = useState<FiltroAvancado[]>([]);
  const [dialogFiltros, setDialogFiltros] = useState(false);
  const [cdEdicao, setCdEdicao] = useState<number | null>(null);
  const [cadastroMassa, setCadastroMassa] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [fotoRef, setFotoRef] = useState<string | null>(null);
  const ultimoClicado = useRef<number | null>(null);
  // Filtros rápidos em cascata (opções de um dependem dos demais)
  const [fCanal, setFCanal] = useState('');
  const [fGrupo, setFGrupo] = useState('');
  const [fGriffe, setFGriffe] = useState('');
  const [fMaterialPai, setFMaterialPai] = useState('');
  const [fProcesso, setFProcesso] = useState('');
  const [fRefFornecedor, setFRefFornecedor] = useState('');

  // Column visibility (persistido por usuário)
  const [colsModalOpen, setColsModalOpen] = useState(false);
  const [importMassaOpen, setImportMassaOpen] = useState(false);
  const [importandoMassa, setImportandoMassa] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[] | null>(null);

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
    queryKey: ['compras_lista', fPO, fPI, anoMesInicio],
    queryFn: async () =>
      fetchAll<CompraLista>((inicio, fim) => {
        let q = supabase.from('vw_controle_compras_lista').select('*');
        if (anoMesInicio) q = q.gte('nr_anomes', Number(anoMesInicio));
        if (fPO) q = q.eq('dc_comprador', fPO);
        if (fPI) q = q.eq('dc_comprador_grupo', fPI);
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

  // Base com os filtros avançados aplicados (antes dos filtros rápidos)
  const baseFiltrada = useMemo(() => {
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

  const filtrosRapidos = { fCanal, fGrupo, fGriffe, fMaterialPai, fProcesso, fRefFornecedor };

  const aplicaRapidos = (dados: CompraLista[], ignorar?: keyof typeof filtrosRapidos) => {
    let r = dados;
    if (fCanal && ignorar !== 'fCanal') r = r.filter((x) => x.dc_canal === fCanal);
    if (fGrupo && ignorar !== 'fGrupo') r = r.filter((x) => x.dc_grupo === fGrupo);
    if (fGriffe && ignorar !== 'fGriffe') r = r.filter((x) => x.dc_griffe === fGriffe);
    if (fMaterialPai && ignorar !== 'fMaterialPai') {
      const v = fMaterialPai.toLowerCase();
      r = r.filter((x) => (x.cd_material_pai ?? '').toLowerCase().includes(v));
    }
    if (fProcesso && ignorar !== 'fProcesso') {
      const v = fProcesso.toLowerCase();
      r = r.filter((x) => (x.cd_embarque ?? '').toLowerCase().includes(v));
    }
    if (fRefFornecedor && ignorar !== 'fRefFornecedor') {
      const v = fRefFornecedor.toLowerCase();
      r = r.filter((x) => (x.cd_material_fornecedor ?? '').toLowerCase().includes(v));
    }
    return r;
  };

  const filtrados = useMemo(
    () => aplicaRapidos(baseFiltrada),
    [baseFiltrada, fCanal, fGrupo, fGriffe, fMaterialPai, fProcesso, fRefFornecedor],
  );

  // Opções em cascata: cada combo lista os valores existentes considerando os OUTROS filtros
  const opcoesRapidas = (campo: keyof CompraLista, ignorar: keyof typeof filtrosRapidos): string[] =>
    [...new Set(aplicaRapidos(baseFiltrada, ignorar).map((x) => x[campo]).filter(Boolean))].sort() as string[];

  // Grupos distintos das linhas selecionadas (edição em massa exige grupo único)
  const gruposSelecionados = useMemo(
    () =>
      [...new Set(
        (compras ?? [])
          .filter((c) => selecionadas.has(c.cd_compra))
          .map((c) => c.dc_grupo ?? ''),
      )],
    [compras, selecionadas],
  );

  const opcoesCanal = useMemo(() => opcoesRapidas('dc_canal', 'fCanal'), [baseFiltrada, fGrupo, fGriffe, fMaterialPai, fProcesso]);
  const opcoesGrupo = useMemo(() => opcoesRapidas('dc_grupo', 'fGrupo'), [baseFiltrada, fCanal, fGriffe, fMaterialPai, fProcesso]);
  const opcoesGriffe = useMemo(() => opcoesRapidas('dc_griffe', 'fGriffe'), [baseFiltrada, fCanal, fGrupo, fMaterialPai, fProcesso]);

  // Miniaturas: mapa ref fornecedor -> URL da foto (Cloudinary), carregado uma vez
  const { data: mapaFotos } = useQuery({
    queryKey: ['fotos_produto_mapa'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const linhas = await fetchAll<{ cd_ref_fornecedor: string; url: string }>((i, f) =>
        supabase.from('fotos_produto').select('cd_ref_fornecedor, url').order('cd_ref_fornecedor').range(i, f),
      );
      return new Map(linhas.map((l) => [l.cd_ref_fornecedor, miniaturaUrl(l.url)]));
    },
  });

  const colunas: Coluna<CompraLista>[] = useMemo(() => {
    // determine base keys from config or fallback
    const baseKeys = (configCols ?? []).map((c) => campoParaColuna(c.campo));
    // initialize visibleCols from localStorage when config is available
    if (visibleCols === null && configCols) {
      const key = `lista_compras_cols_${usuario?.id ?? 'anon'}`;
      const saved = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (saved) {
        try { setVisibleCols(JSON.parse(saved)); } catch { setVisibleCols(baseKeys); }
      } else {
        setVisibleCols(baseKeys);
      }
    }

    const colFoto: Coluna<CompraLista> = {
      key: '__foto',
      titulo: 'Foto',
      ordenavel: false,
      render: (row) => {
        const url = row.cd_material_fornecedor ? mapaFotos?.get(row.cd_material_fornecedor) : null;
        return url ? (
          <img src={url} alt="" loading="lazy" className="h-10 w-14 rounded border object-contain" />
        ) : (
          <div className="h-10 w-14 rounded border border-dashed opacity-30" />
        );
      },
    };
    const colUltAlteracao: Coluna<CompraLista> = {
      key: 'ult_alteracao_em',
      titulo: 'Últ. Alteração',
      render: (row) =>
        row.ult_alteracao_em ? (
          <span>
            {formatDateTime(row.ult_alteracao_em)}
            <span className="text-muted-foreground"> · {row.ult_alteracao_usuario || '—'}</span>
          </span>
        ) : (
          ''
        ),
    };
    const colUltMudanca: Coluna<CompraLista> = {
      key: 'ult_alteracao_campo',
      titulo: 'Última Mudança',
      render: (row) =>
        row.ult_alteracao_campo ? (
          <span title={`${row.ult_alteracao_de ?? ''} → ${row.ult_alteracao_para ?? ''}`}>
            <b>{row.ult_alteracao_campo}</b>: {(row.ult_alteracao_de ?? '—') || '—'} → {(row.ult_alteracao_para ?? '—') || '—'}
          </span>
        ) : (
          ''
        ),
    };
    const base: Coluna<CompraLista>[] = (configCols ?? []).map((c) => ({
      key: campoParaColuna(c.campo),
      titulo: c.legenda_exibicao ?? c.campo,
      render: renderizador(c),
    }));

    const meio = base.length > 0
      ? base
      : [
          { key: 'cd_compra', titulo: 'CD' },
          { key: 'dc_status', titulo: 'Status' },
          { key: 'dc_canal', titulo: 'Canal' },
          { key: 'dc_grupo', titulo: 'Grupo' },
        ];

    // Apply visibleCols filter if initialized
    let visibleSet: Set<string> | null = null;
    if (visibleCols) visibleSet = new Set(visibleCols);
    const filteredBase = visibleSet ? meio.filter((c) => visibleSet!.has(c.key)) : meio;

    return [colFoto, ...filteredBase, colUltAlteracao, colUltMudanca];
  }, [configCols, mapaFotos, visibleCols]);

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

  // inline filter options for columns
  const opcCanalFull = Array.from(new Set((compras ?? []).map((c: any) => c.dc_canal).filter(Boolean))).sort();
  const opcGrupoFull = Array.from(new Set((compras ?? []).map((c: any) => c.dc_grupo).filter(Boolean))).sort();
  const opcForneFull = Array.from(new Set((compras ?? []).map((c: any) => c.dc_fornecedor).filter(Boolean))).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Lista de Compras</h1>
            <p className="text-sm text-muted-foreground">Carteira de compras e importação</p>
          </div>
          <FotoCabecalho refFornecedor={fotoRef} />
        </div>
        <div className="flex flex-wrap gap-2">
          {editavel && (
            <>
              <Button onClick={() => setCdEdicao(0)}>
                <Plus /> Novo Registro
              </Button>
              <Button variant="secondary" onClick={() => setCadastroMassa(true)}>
                <Layers /> Cadastro em Massa
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => setDialogFiltros(true)}>
            <Filter /> Filtros {filtrosAvancados.length > 0 && <Badge>{filtrosAvancados.length}</Badge>}
          </Button>
          <Button variant="outline" onClick={() => setColsModalOpen(true)}>
            <Layers /> Colunas
          </Button>
          <Button variant="outline" onClick={() => setImportMassaOpen(true)}>
            <FileSpreadsheet /> Importação em Massa
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
            <Label>PO</Label>
            <Select value={fPO} onChange={(e) => setFPO(e.target.value)} placeholder="Todos" options={listaCompradores} />
          </div>
          <div className="w-44">
            <Label>PI</Label>
            <Select value={fPI} onChange={(e) => setFPI(e.target.value)} placeholder="Todos" options={listaCompradorGrupos} />
          </div>
          <div className="w-28">
            <Label>AnoMês início</Label>
            <Input value={anoMesInicio} onChange={(e) => setAnoMesInicio(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div className="w-36">
            <Label>Canal</Label>
            <Select value={fCanal} onChange={(e) => setFCanal(e.target.value)} placeholder="Todos" options={opcoesCanal} />
          </div>
          <div className="w-36">
            <Label>Grupo</Label>
            <Select value={fGrupo} onChange={(e) => setFGrupo(e.target.value)} placeholder="Todos" options={opcoesGrupo} />
          </div>
          <div className="w-40">
            <Label>Griffe</Label>
            <Select value={fGriffe} onChange={(e) => setFGriffe(e.target.value)} placeholder="Todas" options={opcoesGriffe} />
          </div>
          <div className="w-32">
            <Label>Material Pai</Label>
            <SearchInput value={fMaterialPai} onChange={(e) => setFMaterialPai(e.target.value)} onClear={() => setFMaterialPai('')} />
          </div>
          <div className="w-32">
            <Label>Processo FUP</Label>
            <SearchInput value={fProcesso} onChange={(e) => setFProcesso(e.target.value)} onClear={() => setFProcesso('')} />
          </div>
          <div className="w-40">
            <Label>Ref Fornecedor</Label>
            <SearchInput value={fRefFornecedor} onChange={(e) => setFRefFornecedor(e.target.value)} onClear={() => setFRefFornecedor('')} />
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFPO(filtroInicial);
              setFPI('');
              setAnoMesInicio(String(anoMes(-10)));
              setFiltrosAvancados([]);
              setFCanal('');
              setFGrupo('');
              setFGriffe('');
              setFMaterialPai('');
              setFProcesso('');
              setFRefFornecedor('');
            }}
          >
            Limpar filtros
          </Button>
          {selecionadas.size >= 2 && editavel && (
            <EdicaoMassaCampo
              selecionadas={selecionadas}
              grupos={gruposSelecionados}
              temRecebimentoPassado={(compras ?? []).some(
                (c) => selecionadas.has(c.cd_compra) && !!c.dt_recebimento && c.dt_recebimento < hojeISO(),
              )}
              onLimparSelecao={() => setSelecionadas(new Set())}
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
        onRowClick={(row, e, visiveis) => {
          setFotoRef(row.cd_material_fornecedor);
          setSelecionadas((s) => {
            const n = new Set(s);
            // Shift+clique: seleciona o intervalo entre o último clique e a linha atual
            if (e.shiftKey && ultimoClicado.current != null) {
              const i1 = visiveis.findIndex((v) => v.cd_compra === ultimoClicado.current);
              const i2 = visiveis.findIndex((v) => v.cd_compra === row.cd_compra);
              if (i1 >= 0 && i2 >= 0) {
                for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) {
                  n.add(visiveis[i].cd_compra);
                }
                return n;
              }
            }
            if (n.has(row.cd_compra)) n.delete(row.cd_compra);
            else n.add(row.cd_compra);
            ultimoClicado.current = row.cd_compra;
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
        columnFilters={[
          { key: 'dc_canal', tipo: 'select', options: opcCanalFull },
          { key: 'dc_grupo', tipo: 'select', options: opcGrupoFull },
          { key: 'dc_fornecedor', tipo: 'select', options: opcForneFull },
          { key: 'cd_pedido_sap', tipo: 'text' },
          { key: 'cd_material_pai', tipo: 'text' },
        ]}
      />


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

      {/* Colunas modal */}
      <Dialog open={colsModalOpen} onOpenChange={setColsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Colunas visíveis</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="text-sm text-muted-foreground">Toggle as colunas que deseja ver na lista. Salvo no navegador por usuário.</div>
            <div className="space-y-1 pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleCols ? visibleCols.includes('__foto') : true}
                  onChange={(e) => {
                    const key = '__foto';
                    const cur = visibleCols ?? [];
                    const next = e.target.checked ? [...cur, key] : cur.filter((k) => k !== key);
                    setVisibleCols(next);
                  }}
                />
                <span>Foto</span>
              </label>
              {(configCols ?? []).map((c) => {
                const key = campoParaColuna(c.campo);
                return (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={visibleCols ? visibleCols.includes(key) : true}
                      onChange={(e) => {
                        const cur = visibleCols ?? (configCols ?? []).map((x) => campoParaColuna(x.campo));
                        const next = e.target.checked ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
                        setVisibleCols(next);
                      }}
                    />
                    <span>{c.legenda_exibicao ?? c.campo}</span>
                  </label>
                );
              })}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleCols ? visibleCols.includes('ult_alteracao_em') : true}
                  onChange={(e) => {
                    const key = 'ult_alteracao_em';
                    const cur = visibleCols ?? [];
                    const next = e.target.checked ? [...cur, key] : cur.filter((k) => k !== key);
                    setVisibleCols(next);
                  }}
                />
                <span>Últ. Alteração</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleCols ? visibleCols.includes('ult_alteracao_campo') : true}
                  onChange={(e) => {
                    const key = 'ult_alteracao_campo';
                    const cur = visibleCols ?? [];
                    const next = e.target.checked ? [...cur, key] : cur.filter((k) => k !== key);
                    setVisibleCols(next);
                  }}
                />
                <span>Última Mudança</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleCols ? visibleCols.includes('__acoes') : true}
                  onChange={(e) => {
                    const key = '__acoes';
                    const cur = visibleCols ?? [];
                    const next = e.target.checked ? [...cur, key] : cur.filter((k) => k !== key);
                    setVisibleCols(next);
                  }}
                />
                <span>Ações (Excluir)</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVisibleCols(null); setColsModalOpen(false); }}>Cancelar</Button>
            <Button onClick={() => {
              const key = `lista_compras_cols_${usuario?.id ?? 'anon'}`;
              if (visibleCols) localStorage.setItem(key, JSON.stringify(visibleCols));
              setColsModalOpen(false);
            }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importação em massa (Pedido SAP / Material Pai) */}
      <Dialog open={importMassaOpen} onOpenChange={setImportMassaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importação em Massa — Pedido SAP / Material Pai</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Exportar um modelo, preencher as colunas e importar para atualizar os registros.</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => {
                const cols: ColunaExport[] = [
                  { key: 'cd_compra', titulo: 'cd_compra' },
                  { key: 'cd_pedido_sap', titulo: 'cd_pedido_sap' },
                  { key: 'cd_material_pai', titulo: 'cd_material_pai' },
                ];
                const dados = (filtrados ?? []).map((r: any) => ({ cd_compra: r.cd_compra, cd_pedido_sap: r.cd_pedido_sap ?? '', cd_material_pai: r.cd_material_pai ?? '' }));
                exportarExcel(cols, dados, 'SysPlan_Modelo_Importacao_PedidoSAP_MaterialPai');
              }}>Exportar modelo (com CDs visíveis)</Button>
              <label>
                <Button variant="outline" loading={importandoMassa}>Importar arquivo</Button>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!f) return;
                    setImportandoMassa(true);
                    try {
                      const linhas = await lerPlanilha(f);
                      const rows = linhas.map((l) => ({
                        cd_compra: Number(l['cd_compra'] ?? l['CD_COMPRA'] ?? l['CD Compra'] ?? l['CD Follow'] ?? l['CD']),
                        cd_pedido_sap: l['cd_pedido_sap'] ?? l['CD_PEDIDO_SAP'] ?? l['cd_pedido_sap'] ?? l['cd_pedido_sap'],
                        cd_material_pai: l['cd_material_pai'] ?? l['CD_MATERIAL_PAI'] ?? l['cd_material_pai'] ?? l['cd_material_pai'],
                      })).filter((r) => r.cd_compra);
                      if (rows.length === 0) throw new Error('Nenhuma linha válida encontrada (cd_compra).');
                      let aplicadas = 0;
                      for (const r of rows) {
                        const upd: any = {};
                        if (r.cd_pedido_sap) upd.cd_pedido_sap = String(r.cd_pedido_sap);
                        if (r.cd_material_pai) upd.cd_material_pai = String(r.cd_material_pai);
                        if (Object.keys(upd).length === 0) continue;
                        const { error } = await supabase.from('controle_compras').update(upd).eq('cd_compra', r.cd_compra);
                        if (error) console.error(`CD ${r.cd_compra}:`, error.message);
                        else aplicadas++;
                      }
                      toast.success(`Importação concluída: ${aplicadas} registro(s) atualizados.`);
                      qc.invalidateQueries({ queryKey: ['compras_lista'] });
                      setImportMassaOpen(false);
                    } catch (err: any) {
                      toast.error(err.message ?? String(err));
                    } finally {
                      setImportandoMassa(false);
                    }
                  }}
                />
              </label>
            </div>
            <div className="text-xs text-muted-foreground">O arquivo deve conter as colunas: cd_compra, cd_pedido_sap, cd_material_pai. Use o modelo para evitar problemas.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportMassaOpen(false)}>Fechar</Button>
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

      {cadastroMassa && (
        <CadastroMassa
          onFechar={(criou) => {
            setCadastroMassa(false);
            if (criou) qc.invalidateQueries({ queryKey: ['compras_lista'] });
          }}
        />
      )}

    </div>
  );
}
