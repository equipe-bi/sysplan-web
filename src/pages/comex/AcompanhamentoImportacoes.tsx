import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, PencilRuler, Plus, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber } from '@/lib/utils';

/**
 * Followup Agente de Carga (antigo Acompanhamento de Importações).
 * Controle do agente de carga dentro do sistema. A alimentação em lote é feita
 * pela tela "Lançar no Acompanhamento"; aqui o responsável edita os embarques
 * (individual, em massa com Shift) e pode inserir um registro avulso.
 */

const CORES_STATUS: Record<string, 'success' | 'secondary' | 'destructive' | 'default' | 'outline'> = {
  'Embarcado': 'success',
  'Aguardando Embarque': 'default',
  'Data entrega não informada': 'secondary',
  'ID Origem não informado': 'destructive',
  'Pendente entrega na origem - ATRASADO': 'destructive',
  'Pendente entrega na origem - NO PRAZO': 'outline',
};

/** Campos editáveis em massa pelo agente de carga */
const CAMPOS_MASSA: { campo: string; label: string; tipo: 'texto' | 'data' }[] = [
  { campo: 'cd_embarque', label: 'Processo (Cod)', tipo: 'texto' },
  { campo: 'id_origem', label: 'ID Origem', tipo: 'texto' },
  { campo: 'dt_entrega_origem_real', label: 'Entrega Origem Real', tipo: 'data' },
  { campo: 'dt_etd', label: 'ETD (prev. embarque)', tipo: 'data' },
  { campo: 'dt_atd', label: 'ATD (embarque real)', tipo: 'data' },
  { campo: 'dt_eta', label: 'ETA (prev. atraque)', tipo: 'data' },
  { campo: 'dt_ata', label: 'ATA (atraque real)', tipo: 'data' },
  { campo: 'hbl', label: 'HBL', tipo: 'texto' },
  { campo: 'vessel', label: 'Navio (Vessel)', tipo: 'texto' },
  { campo: 'ctnr', label: 'Contêiner', tipo: 'texto' },
  { campo: 'dc_observacoes', label: 'Observações', tipo: 'texto' },
];

const NOVO_REGISTRO = {
  dc_grupo: '', dc_canal: '', dc_fornecedor: '', cd_material_pai: '',
  cd_pedido_fornecedor: '', cd_pedido_sap: '', nr_quantidade: 0,
  dc_modal: '', dt_delivery: '', dt_recebimento: '',
};

export default function AcompanhamentoImportacoes() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('acompanhamento_importacoes');
  const qc = useQueryClient();

  const [statusSel, setStatusSel] = useState('');
  const [edicao, setEdicao] = useState<any | null>(null);
  const [novo, setNovo] = useState<typeof NOVO_REGISTRO | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const ultimoClicado = useRef<number | null>(null);
  const [campoMassa, setCampoMassa] = useState(CAMPOS_MASSA[0].campo);
  const [valorMassa, setValorMassa] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['acompanhamento_importacoes'],
    queryFn: async () =>
      fetchAll<any>((i, f) =>
        supabase.from('acompanhamento_importacoes').select('*').order('dt_delivery', { ascending: true }).range(i, f),
      ),
  });

  const filtrados = useMemo(
    () => (statusSel ? (data ?? []).filter((x) => x.dc_status_calculado === statusSel) : data ?? []),
    [data, statusSel],
  );

  const resumoStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) {
      const s = r.dc_status_calculado ?? 'N/I';
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const defMassa = CAMPOS_MASSA.find((c) => c.campo === campoMassa)!;

  const aplicarMassa = useMutation({
    mutationFn: async () => {
      const valor = defMassa.tipo === 'data' ? valorMassa || null : valorMassa;
      for (const id of selecionadas) {
        const { error } = await supabase.from('acompanhamento_importacoes').update({ [campoMassa]: valor }).eq('id', id);
        if (error) throw new Error(`Linha ${id}: ${error.message}`);
      }
      registraLog('AcompImportacoes - Edicao em Massa', 0, '', `${selecionadas.size} linhas`, campoMassa);
    },
    onSuccess: () => {
      toast.success(`${defMassa.label} atualizado em ${selecionadas.size} linha(s).`);
      setSelecionadas(new Set());
      setValorMassa('');
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
      const { error } = await supabase.from('acompanhamento_importacoes').update(payload).eq('id', edicao.id);
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

  const inserir = useMutation({
    mutationFn: async () => {
      if (!novo) return;
      if (!novo.cd_pedido_sap || !novo.cd_material_pai) throw new Error('Pedido SAP e Material Pai são obrigatórios.');
      const { error } = await supabase.from('acompanhamento_importacoes').insert({
        ...novo,
        nr_quantidade: Number(novo.nr_quantidade) || 0,
        dt_delivery: novo.dt_delivery || null,
        dt_recebimento: novo.dt_recebimento || null,
      });
      if (error) throw error;
      registraLog('AcompImportacoes - Insercao Manual', 0, '', `${novo.cd_pedido_sap} ${novo.cd_material_pai}`);
    },
    onSuccess: () => {
      toast.success('Registro inserido.');
      setNovo(null);
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    {
      key: 'dc_status_calculado', titulo: 'Status',
      valor: (r) => r.dc_status_calculado,
      render: (r) => <Badge variant={CORES_STATUS[r.dc_status_calculado] ?? 'secondary'}>{r.dc_status_calculado}</Badge>,
    },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'nr_quantidade', titulo: 'Qtde', valor: (r) => r.nr_quantidade, render: (r) => formatNumber(r.nr_quantidade, 0) },
    { key: 'dc_modal', titulo: 'Modal' },
    { key: 'dt_delivery', titulo: 'Delivery', valor: (r) => r.dt_delivery, render: (r) => formatDate(r.dt_delivery) },
    { key: 'dt_recebimento', titulo: 'Recebimento', valor: (r) => r.dt_recebimento, render: (r) => formatDate(r.dt_recebimento) },
    { key: 'cd_embarque', titulo: 'Processo' },
    { key: 'id_origem', titulo: 'ID Origem' },
    { key: 'dt_entrega_origem_real', titulo: 'Entrega Origem', valor: (r) => r.dt_entrega_origem_real, render: (r) => formatDate(r.dt_entrega_origem_real) },
    { key: 'dt_etd', titulo: 'ETD', valor: (r) => r.dt_etd, render: (r) => formatDate(r.dt_etd) },
    { key: 'dt_atd', titulo: 'ATD', valor: (r) => r.dt_atd, render: (r) => formatDate(r.dt_atd) },
    { key: 'dt_eta', titulo: 'ETA', valor: (r) => r.dt_eta, render: (r) => formatDate(r.dt_eta) },
    { key: 'dt_ata', titulo: 'ATA', valor: (r) => r.dt_ata, render: (r) => formatDate(r.dt_ata) },
    { key: 'hbl', titulo: 'HBL' },
    { key: 'vessel', titulo: 'Navio' },
    { key: 'ctnr', titulo: 'Contêiner' },
    { key: 'dc_observacoes', titulo: 'Observações' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Followup Agente de Carga</h1>
          <p className="text-sm text-muted-foreground">
            Duplo clique edita o embarque · clique seleciona (Shift para intervalo) · use o funil no cabeçalho para filtrar
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
          <Button
            variant="outline"
            onClick={() => {
              exportarExcel(colunas.map((c) => ({ key: c.key, titulo: c.titulo })), filtrados, 'SysPlan_FollowupAgenteCarga');
              registraLog('AcompImportacoes - Exportacao');
            }}
          >
            <FileDown /> Excel
          </Button>
          {editavel && (
            <Button onClick={() => setNovo({ ...NOVO_REGISTRO })}>
              <Plus /> Inserir registro
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {resumoStatus.map(([s, n]) => (
          <button key={s} onClick={() => setStatusSel(statusSel === s ? '' : s)}>
            <Badge variant={statusSel === s ? 'default' : CORES_STATUS[s] ?? 'secondary'} className="cursor-pointer px-3 py-1">
              {s}: {formatNumber(n, 0)}
            </Badge>
          </button>
        ))}
      </div>

      {selecionadas.size >= 2 && editavel && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 p-3">
            <div>
              <Label className="flex items-center gap-1">
                <PencilRuler className="h-3 w-3" /> Edição em massa ({selecionadas.size} linhas)
              </Label>
              <div className="flex gap-2">
                <Select className="w-52" value={campoMassa} onChange={(e) => { setCampoMassa(e.target.value); setValorMassa(''); }}>
                  {CAMPOS_MASSA.map((c) => (
                    <option key={c.campo} value={c.campo}>{c.label}</option>
                  ))}
                </Select>
                <Input
                  className="w-44"
                  type={defMassa.tipo === 'data' ? 'date' : 'text'}
                  value={valorMassa}
                  onChange={(e) => setValorMassa(e.target.value)}
                />
              </div>
            </div>
            <Button size="sm" loading={aplicarMassa.isPending} onClick={() => {
              if (confirm(`Aplicar "${defMassa.label}" em ${selecionadas.size} linha(s)?`)) aplicarMassa.mutate();
            }}>
              Aplicar
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Limpar seleção" onClick={() => setSelecionadas(new Set())}>
              <X />
            </Button>
          </CardContent>
        </Card>
      )}

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.id}
        selecionadas={selecionadas}
        autofiltro
        onRowClick={(row, e, visiveis) => {
          setSelecionadas((s) => {
            const n = new Set(s);
            if (e.shiftKey && ultimoClicado.current != null) {
              const i1 = visiveis.findIndex((v) => v.id === ultimoClicado.current);
              const i2 = visiveis.findIndex((v) => v.id === row.id);
              if (i1 >= 0 && i2 >= 0) {
                for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) n.add(visiveis[i].id);
                return n;
              }
            }
            if (n.has(row.id)) n.delete(row.id);
            else n.add(row.id);
            ultimoClicado.current = row.id;
            return n;
          });
        }}
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

      {novo && (
        <Dialog open onOpenChange={(o) => !o && setNovo(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Inserir registro avulso</DialogTitle>
              <DialogDescription>
                Para embarques fora do fluxo padrão. A alimentação em lote é feita pela tela "Lançar no Acompanhamento".
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div><Label>Grupo</Label><Input value={novo.dc_grupo} onChange={(e) => setNovo({ ...novo, dc_grupo: e.target.value })} /></div>
              <div><Label>Canal</Label><Input value={novo.dc_canal} onChange={(e) => setNovo({ ...novo, dc_canal: e.target.value })} /></div>
              <div><Label>Fornecedor</Label><Input value={novo.dc_fornecedor} onChange={(e) => setNovo({ ...novo, dc_fornecedor: e.target.value })} /></div>
              <div><Label>Material Pai *</Label><Input value={novo.cd_material_pai} onChange={(e) => setNovo({ ...novo, cd_material_pai: e.target.value })} /></div>
              <div><Label>PI</Label><Input value={novo.cd_pedido_fornecedor} onChange={(e) => setNovo({ ...novo, cd_pedido_fornecedor: e.target.value })} /></div>
              <div><Label>Pedido SAP *</Label><Input value={novo.cd_pedido_sap} onChange={(e) => setNovo({ ...novo, cd_pedido_sap: e.target.value })} /></div>
              <div><Label>Quantidade</Label><Input type="number" value={novo.nr_quantidade} onChange={(e) => setNovo({ ...novo, nr_quantidade: Number(e.target.value) })} /></div>
              <div><Label>Modal</Label><Input value={novo.dc_modal} onChange={(e) => setNovo({ ...novo, dc_modal: e.target.value })} /></div>
              <div><Label>Delivery</Label><Input type="date" value={novo.dt_delivery} onChange={(e) => setNovo({ ...novo, dt_delivery: e.target.value })} /></div>
              <div><Label>Recebimento</Label><Input type="date" value={novo.dt_recebimento} onChange={(e) => setNovo({ ...novo, dt_recebimento: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNovo(null)}>Cancelar</Button>
              <Button loading={inserir.isPending} onClick={() => inserir.mutate()}>Inserir</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
