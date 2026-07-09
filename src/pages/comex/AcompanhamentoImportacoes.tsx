import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, PlayCircle, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber } from '@/lib/utils';

/**
 * Acompanhamento de Importações — substitui a planilha do despachante (Hoffen).
 * O planejamento gera as pendências a partir do Controle de Compras; o despachante
 * preenche ID de origem, datas de embarque/atraque, HBL, navio, contêiner e observações.
 * O status é calculado automaticamente e alimenta a consolidação FUP do sistema.
 */

const CORES_STATUS: Record<string, 'success' | 'secondary' | 'destructive' | 'default' | 'outline'> = {
  'Embarcado': 'success',
  'Aguardando Embarque': 'default',
  'Data entrega não informada': 'secondary',
  'ID Origem não informado': 'destructive',
  'Pendente entrega na origem - ATRASADO': 'destructive',
  'Pendente entrega na origem - NO PRAZO': 'outline',
};

const STATUS_OPCOES = Object.keys(CORES_STATUS);

export default function AcompanhamentoImportacoes() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('acompanhamento_importacoes');
  const gerencia = podeEditar('controle_importacao');
  const qc = useQueryClient();

  const [status, setStatus] = useState('');
  const [grupo, setGrupo] = useState('');
  const [pedido, setPedido] = useState('');
  const [material, setMaterial] = useState('');
  const [embarque, setEmbarque] = useState('');
  const [edicao, setEdicao] = useState<any | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['acompanhamento_importacoes'],
    queryFn: async () => {
      const linhas: any[] = [];
      let offset = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from('acompanhamento_importacoes')
          .select('*')
          .order('dt_delivery', { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        linhas.push(...(page ?? []));
        if (!page || page.length < 1000) break;
        offset += 1000;
      }
      return linhas;
    },
  });

  const filtrados = useMemo(() => {
    let r = data ?? [];
    if (status) r = r.filter((x) => x.dc_status_calculado === status);
    if (grupo) r = r.filter((x) => (x.dc_grupo ?? '').toLowerCase().includes(grupo.toLowerCase()));
    if (pedido) r = r.filter((x) => (x.cd_pedido_sap ?? '').includes(pedido));
    if (material) r = r.filter((x) => (x.cd_material_pai ?? '').toLowerCase().includes(material.toLowerCase()));
    if (embarque) r = r.filter((x) => (x.cd_embarque ?? '').toLowerCase().includes(embarque.toLowerCase()));
    return r;
  }, [data, status, grupo, pedido, material, embarque]);

  const resumoStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) {
      const s = r.dc_status_calculado ?? 'N/I';
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const gerar = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc('fn_gerar_acompanhamento_importacoes');
      if (error) throw error;
      return n as number;
    },
    onSuccess: (n) => {
      toast.success(`${n} pendência(s) gerada(s) a partir do Controle de Compras.`);
      registraLog('AcompImportacoes - Gerar Pendencias', 0, '', String(n));
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!edicao) return;
      const payload = {
        cd_embarque: edicao.cd_embarque || null,
        id_origem: edicao.id_origem || null,
        dt_entrega_origem_real: edicao.dt_entrega_origem_real || null,
        dt_etd: edicao.dt_etd || null,
        dt_atd: edicao.dt_atd || null,
        dt_eta: edicao.dt_eta || null,
        dt_ata: edicao.dt_ata || null,
        hbl: edicao.hbl || null,
        vessel: edicao.vessel || null,
        ctnr: edicao.ctnr || null,
        dc_observacoes: edicao.dc_observacoes || null,
      };
      const { error } = await supabase
        .from('acompanhamento_importacoes')
        .update(payload)
        .eq('id', edicao.id);
      if (error) throw error;
      registraLog('AcompImportacoes - Atualizacao', edicao.cd_compra ?? 0, '', `${edicao.cd_pedido_sap} ${edicao.cd_material_pai}`);
    },
    onSuccess: () => {
      toast.success('Acompanhamento atualizado.');
      setEdicao(null);
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    {
      key: 'dc_status_calculado', titulo: 'Status',
      render: (r) => <Badge variant={CORES_STATUS[r.dc_status_calculado] ?? 'secondary'}>{r.dc_status_calculado}</Badge>,
    },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'nr_quantidade', titulo: 'Qtde', render: (r) => formatNumber(r.nr_quantidade, 0) },
    { key: 'dc_modal', titulo: 'Modal' },
    { key: 'dt_delivery', titulo: 'Delivery', render: (r) => formatDate(r.dt_delivery) },
    { key: 'dt_recebimento', titulo: 'Recebimento', render: (r) => formatDate(r.dt_recebimento) },
    { key: 'cd_embarque', titulo: 'Processo' },
    { key: 'id_origem', titulo: 'ID Origem' },
    { key: 'dt_entrega_origem_real', titulo: 'Entrega Origem', render: (r) => formatDate(r.dt_entrega_origem_real) },
    { key: 'dt_etd', titulo: 'ETD', render: (r) => formatDate(r.dt_etd) },
    { key: 'dt_atd', titulo: 'ATD', render: (r) => formatDate(r.dt_atd) },
    { key: 'dt_eta', titulo: 'ETA', render: (r) => formatDate(r.dt_eta) },
    { key: 'dt_ata', titulo: 'ATA', render: (r) => formatDate(r.dt_ata) },
    { key: 'hbl', titulo: 'HBL' },
    { key: 'vessel', titulo: 'Navio' },
    { key: 'ctnr', titulo: 'Contêiner' },
    { key: 'dc_observacoes', titulo: 'Observações' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Acompanhamento de Importações</h1>
          <p className="text-sm text-muted-foreground">
            Controle do despachante — preencha as informações de cada embarque (duplo clique na linha)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
          <Button
            variant="outline"
            onClick={() => {
              exportarExcel(colunas.map((c) => ({ key: c.key, titulo: c.titulo })), filtrados, 'SysPlan_AcompanhamentoImportacoes');
              registraLog('AcompImportacoes - Exportacao');
            }}
          >
            <FileDown /> Excel
          </Button>
          {gerencia && (
            <Button variant="secondary" loading={gerar.isPending} onClick={() => gerar.mutate()}>
              <PlayCircle /> Gerar pendências do Controle de Compras
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {resumoStatus.map(([s, n]) => (
          <button key={s} onClick={() => setStatus(status === s ? '' : s)}>
            <Badge variant={status === s ? 'default' : CORES_STATUS[s] ?? 'secondary'} className="cursor-pointer px-3 py-1">
              {s}: {formatNumber(n, 0)}
            </Badge>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-64">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todos" options={STATUS_OPCOES} />
          </div>
          <div className="w-32"><Label>Grupo</Label><Input value={grupo} onChange={(e) => setGrupo(e.target.value)} /></div>
          <div className="w-36"><Label>Pedido SAP</Label><Input value={pedido} onChange={(e) => setPedido(e.target.value)} /></div>
          <div className="w-36"><Label>Material Pai</Label><Input value={material} onChange={(e) => setMaterial(e.target.value)} /></div>
          <div className="w-36"><Label>Processo</Label><Input value={embarque} onChange={(e) => setEmbarque(e.target.value)} /></div>
        </CardContent>
      </Card>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.id}
        onRowDoubleClick={(r) => editavel && setEdicao({ ...r })}
        paginacao={100}
      />

      {edicao && (
        <Dialog open onOpenChange={(o) => !o && setEdicao(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {edicao.cd_pedido_sap} — {edicao.cd_material_pai}
                <Badge variant={CORES_STATUS[edicao.dc_status_calculado] ?? 'secondary'}>{edicao.dc_status_calculado}</Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
              {edicao.dc_grupo} · {edicao.dc_canal} · {edicao.dc_fornecedor} · PI {edicao.cd_pedido_fornecedor} ·{' '}
              {formatNumber(edicao.nr_quantidade, 0)} un · Delivery {formatDate(edicao.dt_delivery)} · Recebimento {formatDate(edicao.dt_recebimento)}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><Label>Processo (Cod)</Label><Input value={edicao.cd_embarque ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_embarque: e.target.value })} /></div>
              <div><Label>ID Origem</Label><Input value={edicao.id_origem ?? ''} onChange={(e) => setEdicao({ ...edicao, id_origem: e.target.value })} /></div>
              <div><Label>Entrega Origem Real</Label><Input type="date" value={edicao.dt_entrega_origem_real ?? ''} onChange={(e) => setEdicao({ ...edicao, dt_entrega_origem_real: e.target.value })} /></div>
              <div><Label>ETD (prev. embarque)</Label><Input type="date" value={edicao.dt_etd ?? ''} onChange={(e) => setEdicao({ ...edicao, dt_etd: e.target.value })} /></div>
              <div><Label>ATD (embarque real)</Label><Input type="date" value={edicao.dt_atd ?? ''} onChange={(e) => setEdicao({ ...edicao, dt_atd: e.target.value })} /></div>
              <div><Label>ETA (prev. atraque)</Label><Input type="date" value={edicao.dt_eta ?? ''} onChange={(e) => setEdicao({ ...edicao, dt_eta: e.target.value })} /></div>
              <div><Label>ATA (atraque real)</Label><Input type="date" value={edicao.dt_ata ?? ''} onChange={(e) => setEdicao({ ...edicao, dt_ata: e.target.value })} /></div>
              <div><Label>HBL</Label><Input value={edicao.hbl ?? ''} onChange={(e) => setEdicao({ ...edicao, hbl: e.target.value })} /></div>
              <div><Label>Navio (Vessel)</Label><Input value={edicao.vessel ?? ''} onChange={(e) => setEdicao({ ...edicao, vessel: e.target.value })} /></div>
              <div><Label>Contêiner</Label><Input value={edicao.ctnr ?? ''} onChange={(e) => setEdicao({ ...edicao, ctnr: e.target.value })} /></div>
              <div className="col-span-2 md:col-span-4">
                <Label>Observações</Label>
                <Textarea value={edicao.dc_observacoes ?? ''} onChange={(e) => setEdicao({ ...edicao, dc_observacoes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdicao(null)}>Cancelar</Button>
              <Button loading={salvar.isPending} onClick={() => salvar.mutate()}><Save /> Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
