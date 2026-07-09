import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { anoMes, formatDate, formatNumber, cn } from '@/lib/utils';
import { useCombos } from '@/services/combos';

export default function ControleImportacao() {
  const { registraLog } = useAuth();
  const { opcoes } = useCombos();

  const [canal, setCanal] = useState('');
  const [grupo, setGrupo] = useState('');
  const [griffe, setGriffe] = useState('');
  const [inicioRec, setInicioRec] = useState(String(anoMes()));
  const [fimRec, setFimRec] = useState(String(anoMes(100)));
  const [statusSelecionado, setStatusSelecionado] = useState<string | null>(null);
  const [mesLista, setMesLista] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['analise_fup'],
    queryFn: async () =>
      fetchAll<any>((inicio, fim) =>
        supabase.from('vw_analise_fup_comex').select('*').order('cd_compra').range(inicio, fim),
      ),
  });

  const filtrados = useMemo(() => {
    let r = (data ?? []).filter((x) => x.info_usar != null);
    if (canal) r = r.filter((x) => (x.dc_canal ?? '').includes(canal));
    if (grupo) r = r.filter((x) => (x.dc_grupo ?? '').includes(grupo));
    if (griffe) r = r.filter((x) => (x.dc_griffe ?? '').includes(griffe));
    if (inicioRec) r = r.filter((x) => Number(x.nr_anomes) >= Number(inicioRec));
    if (fimRec) r = r.filter((x) => Number(x.nr_anomes) <= Number(fimRec));
    return r;
  }, [data, canal, grupo, griffe, inicioRec, fimRec]);

  const porStatus = useMemo(() => {
    const mapa = new Map<string, { qtde: number; infoUsar: number }>();
    for (const r of filtrados) {
      const g = r.grupo_status ?? 'N/I';
      const atual = mapa.get(g) ?? { qtde: 0, infoUsar: r.info_usar };
      atual.qtde += r.nr_quantidade ?? 0;
      mapa.set(g, atual);
    }
    return [...mapa.entries()]
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => a.infoUsar - b.infoUsar);
  }, [filtrados]);

  const detalhe = useMemo(
    () => (statusSelecionado ? filtrados.filter((r) => r.grupo_status === statusSelecionado) : filtrados),
    [filtrados, statusSelecionado],
  );

  const { data: listaEntrega } = useQuery({
    queryKey: ['lista_entrega'],
    queryFn: async () =>
      fetchAll<any>((inicio, fim) =>
        supabase.from('vw_lista_entrega_origem').select('*').order('cd_pedido_sap').range(inicio, fim),
      ),
  });

  const mesesDelivery = useMemo(
    () => [...new Set((listaEntrega ?? []).map((l) => l.anomes_delivery).filter(Boolean))].sort() as string[],
    [listaEntrega],
  );

  const exportarListaEntrega = () => {
    if (!mesLista) {
      toast.error('Selecionar mês de delivery.');
      return;
    }
    const linhas = (listaEntrega ?? []).filter((l) => l.anomes_delivery === mesLista);
    exportarExcel(
      [
        { key: 'grupo', titulo: 'Grupo' }, { key: 'dc_linha', titulo: 'Linha' },
        { key: 'dc_griffe', titulo: 'Griffe' }, { key: 'dc_canal', titulo: 'Canal' },
        { key: 'dc_fornecedor', titulo: 'Fornecedor' }, { key: 'cd_material_pai', titulo: 'Material Pai' },
        { key: 'cd_pedido_fornecedor', titulo: 'PI' }, { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
        { key: 'nr_quantidade', titulo: 'Quantidade' }, { key: 'dt_recebimento', titulo: 'Recebimento' },
        { key: 'dc_modal', titulo: 'Modal' }, { key: 'dt_revised_delivery', titulo: 'Revised Delivery' },
        { key: 'lead_time', titulo: 'Lead Time' }, { key: 'avaliacao', titulo: 'Avaliação' },
      ],
      linhas,
      `SysPlan_ListaEntrega_${mesLista}`,
    );
    registraLog(`Comex - Lista Embarque ${mesLista} - Exportacao`);
  };

  const exportarRelatorio = () => {
    exportarExcel(
      [
        { key: 'cd_compra', titulo: 'CD' }, { key: 'dc_canal', titulo: 'Canal' },
        { key: 'dc_grupo', titulo: 'Grupo' }, { key: 'dc_linha', titulo: 'Linha' },
        { key: 'dc_griffe', titulo: 'Griffe' }, { key: 'cd_material_pai', titulo: 'Material Pai' },
        { key: 'cd_pedido_sap', titulo: 'Pedido SAP' }, { key: 'nr_quantidade', titulo: 'Qtde' },
        { key: 'dt_recebimento', titulo: 'Recebimento' }, { key: 'dt_revised_delivery', titulo: 'Revised Delivery' },
        { key: 'dc_modal', titulo: 'Modal' }, { key: 'processo_calc', titulo: 'Processo' },
        { key: 'status_calc', titulo: 'Status' }, { key: 'grupo_status', titulo: 'Grupo Status' },
      ],
      filtrados,
      `SysPlan_ControleImportacao_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      'Base',
    );
    registraLog('Comex - Relatorio - Exportacao');
  };

  const colunasDetalhe: Coluna<any>[] = [
    { key: 'status_calc', titulo: 'Status' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_linha', titulo: 'Linha' },
    { key: 'dc_griffe', titulo: 'Griffe' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'nr_quantidade', titulo: 'Qtde', render: (r) => formatNumber(r.nr_quantidade, 0) },
    { key: 'dt_recebimento', titulo: 'Recebimento', render: (r) => formatDate(r.dt_recebimento) },
    { key: 'dt_revised_delivery', titulo: 'Revised Delivery', render: (r) => formatDate(r.dt_revised_delivery) },
    { key: 'dc_modal', titulo: 'Modal' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Controle de Importação</h1>
          <p className="text-sm text-muted-foreground">Consolidação Comex &gt; Despachante &gt; Fornecedor</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
          <Button variant="outline" onClick={exportarRelatorio}><FileDown /> Relatório</Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-36"><Label>Canal</Label><Select value={canal} onChange={(e) => setCanal(e.target.value)} placeholder="Todos" options={opcoes('CANAL')} /></div>
          <div className="w-36"><Label>Grupo</Label><Input value={grupo} onChange={(e) => setGrupo(e.target.value)} /></div>
          <div className="w-36"><Label>Griffe</Label><Input value={griffe} onChange={(e) => setGriffe(e.target.value)} /></div>
          <div className="w-28"><Label>Rec. início</Label><Input value={inicioRec} onChange={(e) => setInicioRec(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="w-28"><Label>Rec. fim</Label><Input value={fimRec} onChange={(e) => setFimRec(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="ml-auto flex items-end gap-2">
            <div className="w-32">
              <Label>Lista entrega origem</Label>
              <Select value={mesLista} onChange={(e) => setMesLista(e.target.value)} placeholder="Mês..." options={mesesDelivery} />
            </div>
            <Button variant="outline" onClick={exportarListaEntrega}><FileDown /> Exportar lista</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Status consolidado</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
              : porStatus.map((s) => (
                  <button
                    key={s.status}
                    onClick={() => setStatusSelecionado(statusSelecionado === s.status ? null : s.status)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                      statusSelecionado === s.status
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent',
                    )}
                  >
                    <span className="truncate">{s.status}</span>
                    <span className="ml-2 font-semibold">{formatNumber(s.qtde, 0)}</span>
                  </button>
                ))}
          </CardContent>
        </Card>
        <DataTable
          colunas={colunasDetalhe}
          dados={detalhe}
          carregando={isLoading}
          rowKey={(r) => r.cd_compra}
          altura="calc(100vh - 380px)"
        />
      </div>
    </div>
  );
}
