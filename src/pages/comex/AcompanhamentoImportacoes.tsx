import { useMemo, useRef, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, PencilRuler, Plus, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber } from '@/lib/utils';

/**
 * Acompanhamento de Importações — controle do despachante dentro do sistema.
 * A alimentação em lote é feita pela tela "Lançar no Acompanhamento" (permissão própria);
 * aqui o responsável edita os embarques (individual ou em massa) e pode inserir
 * um registro avulso quando algo fugir do fluxo.
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

/** Campos editáveis em massa pelo despachante */
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

  const [status, setStatus] = useState('');
  const [grupo, setGrupo] = useState('');
  const [pedido, setPedido] = useState('');
  const [material, setMaterial] = useState('');
  const [embarque, setEmbarque] = useState('');
  const [edicao, setEdicao] = useState<any | null>(null);
  const [novo, setNovo] = useState<typeof NOVO_REGISTRO | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const ultimoClicado = useRef<number | null>(null);
  const [campoMassa, setCampoMassa] = useState(CAMPOS_MASSA[0].campo);
  const [valorMassa, setValorMassa] = useState('');

  // Manual assignment of "lancar" and its responsible person.
  // Persisted to localStorage (key: 'acomp_lancar_assigns_v1') and also
  // attempted to persist to the DB when possible. This avoids failing
  // when the DB schema does not contain these columns.
  const [manualAssigns, setManualAssigns] = useState<Record<number, { lancar: boolean; responsavel?: string }>>({});
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignLancar, setAssignLancar] = useState<'Sim' | 'Não'>('Sim');
  const [assignResponsavel, setAssignResponsavel] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('acomp_lancar_assigns_v1');
      if (raw) setManualAssigns(JSON.parse(raw));
    } catch (e) {
      // ignore
    }
  }, []);

  const persistManualAssigns = (m: Record<number, any>) => {
    try {
      localStorage.setItem('acomp_lancar_assigns_v1', JSON.stringify(m));
    } catch (e) {
      // ignore
    }
  };

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

  const [statusFillFilter, setStatusFillFilter] = useState<string>('');

  // Augment data with status de preenchimento and lancar flag
  const dataAugment = useMemo(() => {
    return (data ?? []).map((x: any) => {
      const hasPedido = x.cd_pedido_sap && String(x.cd_pedido_sap).trim() !== '' && String(x.cd_pedido_sap).trim().toUpperCase() !== 'N/I';
      const hasMaterial = x.cd_material_pai && String(x.cd_material_pai).trim() !== '';
      const launched = !!x.cd_embarque;
      let statusFill = 'Erro de Preenchimento';
      if (launched) statusFill = 'Já lançado';
      else if (hasPedido && hasMaterial) statusFill = 'A lançar';

      // Apply any manual overrides persisted locally (or previously saved to DB)
      const manual = manualAssigns && typeof x.id !== 'undefined' ? manualAssigns[x.id] : undefined;
      const lancarFlag = manual ? manual.lancar : statusFill === 'A lançar';
      const responsavel = manual ? manual.responsavel : x.responsavel_lancamento || '';

      return { ...x, status_preenchimento: statusFill, lancar: lancarFlag, responsavel_lancamento: responsavel };
    });
  }, [data, manualAssigns]);

  const filtrados = useMemo(() => {
    let r = dataAugment ?? [];
    if (status) r = r.filter((x) => x.dc_status_calculado === status);
    if (grupo) r = r.filter((x) => (x.dc_grupo ?? '').toLowerCase().includes(grupo.toLowerCase()));
    if (pedido) r = r.filter((x) => (x.cd_pedido_sap ?? '').includes(pedido));
    if (material) r = r.filter((x) => (x.cd_material_pai ?? '').toLowerCase().includes(material.toLowerCase()));
    if (embarque) r = r.filter((x) => (x.cd_embarque ?? '').toLowerCase().includes(embarque.toLowerCase()));
    if (statusFillFilter) r = r.filter((x) => x.status_preenchimento === statusFillFilter);
    return r;
  }, [dataAugment, status, grupo, pedido, material, embarque, statusFillFilter]);

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
        const { error } = await supabase
          .from('acompanhamento_importacoes')
          .update({ [campoMassa]: valor })
          .eq('id', id);
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

  const inserir = useMutation({
    mutationFn: async () => {
      if (!novo) return;
      if (!novo.cd_pedido_sap || !novo.cd_material_pai) {
        throw new Error('Pedido SAP e Material Pai são obrigatórios.');
      }
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
      toast.success('Registro inserido no acompanhamento.');
      setNovo(null);
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  // Mutation to assign "lancar" flag and responsible person for selected rows.
  const assignLancamento = useMutation({
    mutationFn: async (payload: { ids: number[]; lancar: boolean; responsavel?: string }) => {
      const { ids, lancar, responsavel } = payload;
      const errors: string[] = [];
      for (const id of ids) {
        try {
          // Attempt to persist to DB. If the table does not have these columns,
          // Supabase will return an error and we'll fallback to local persistence.
          const updatePayload: any = { lancar, responsavel_lancamento: responsavel || null };
          const { error } = await supabase.from('acompanhamento_importacoes').update(updatePayload).eq('id', id);
          if (error) errors.push(`Linha ${id}: ${error.message}`);
        } catch (e: any) {
          errors.push(String(e.message ?? e));
        }
      }
      if (errors.length) throw new Error(errors.join('\n'));
      return true;
    },
    onSuccess: () => {
      toast.success('Atribuições salvas no servidor.');
      // update local map as well for immediate UI consistency
      const next = { ...manualAssigns };
      for (const id of selecionadas) next[id] = { lancar: assignLancar === 'Sim', responsavel: assignResponsavel };
      setManualAssigns(next);
      persistManualAssigns(next);
      setAssignDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
      setSelecionadas(new Set());
    },
    onError: (e: any) => {
      // Save locally if server persist failed
      const next = { ...manualAssigns };
      for (const id of selecionadas) next[id] = { lancar: assignLancar === 'Sim', responsavel: assignResponsavel };
      setManualAssigns(next);
      persistManualAssigns(next);
      setAssignDialogOpen(false);
      setSelecionadas(new Set());
      toast.error('Erro ao salvar no servidor — alterações salvas localmente.');
    },
  });

  // inline filter options derived from data
  const opcStatus = Array.from(new Set((data ?? []).map((d: any) => d.dc_status_calculado).filter(Boolean))).sort();
  const opcGrupos = Array.from(new Set((data ?? []).map((d: any) => d.dc_grupo).filter(Boolean))).sort();
  const opcCanal = Array.from(new Set((data ?? []).map((d: any) => d.dc_canal).filter(Boolean))).sort();
  const opcForne = Array.from(new Set((data ?? []).map((d: any) => d.dc_fornecedor).filter(Boolean))).sort();

  const colunas: Coluna<any>[] = [
    {
      key: 'status_preenchimento',
      titulo: 'Status Preenchimento',
      render: (r) => (
        <Badge variant={r.status_preenchimento === 'Já lançado' ? 'success' : r.status_preenchimento === 'A lançar' ? 'default' : 'destructive'}>
          {r.status_preenchimento}
        </Badge>
      ),
    },
    { key: 'dc_status_calculado', titulo: 'Status', render: (r) => <Badge variant={CORES_STATUS[r.dc_status_calculado] ?? 'secondary'}>{r.dc_status_calculado}</Badge> },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'nr_quantidade', titulo: 'Qtde', render: (r) => formatNumber(r.nr_quantidade, 0) },
    { key: 'dc_modal', titulo: 'Modal' },
    { key: 'lancar', titulo: 'Lançar', render: (r) => (r.lancar ? <Badge variant="default">Sim</Badge> : <span className="text-muted-foreground">Não</span>) },
    { key: 'responsavel_lancamento', titulo: 'Responsável', render: (r) => (
      r.responsavel_lancamento ? <div className="text-sm">{r.responsavel_lancamento}</div> : <span className="text-muted-foreground">—</span>
    ) },
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
          <h1 className="text-2xl font-bold tracking-tight">Followup Agente de Carga</h1>
          <p className="text-sm text-muted-foreground">
            Duplo clique edita o embarque · clique seleciona (Shift para intervalo) para edição em massa
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
          {editavel && selecionadas.size > 0 && (
            <Button onClick={() => { setAssignDialogOpen(true); setAssignLancar('Sim'); setAssignResponsavel(''); }}>
              <PencilRuler /> Definir Lançar/Responsável ({selecionadas.size})
            </Button>
          )}
          {editavel && (
            <Button onClick={() => setNovo({ ...NOVO_REGISTRO })}>
              <Plus /> Inserir registro
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

      {/* KPIs de preenchimento */}
      <div className="flex flex-wrap gap-2">
        {(() => {
          const counts = new Map<string, number>();
          for (const r of dataAugment ?? []) counts.set(r.status_preenchimento, (counts.get(r.status_preenchimento) ?? 0) + 1);
          const ja = counts.get('Já lançado') ?? 0;
          const aLancar = counts.get('A lançar') ?? 0;
          const erro = counts.get('Erro de Preenchimento') ?? 0;
          return (
            <>
              <button onClick={() => setStatusFillFilter(statusFillFilter === 'Já lançado' ? '' : 'Já lançado')}>
                <Badge className="cursor-pointer px-3 py-1" variant={statusFillFilter === 'Já lançado' ? 'default' : 'success'}>Já lançado: {ja}</Badge>
              </button>
              <button onClick={() => setStatusFillFilter(statusFillFilter === 'A lançar' ? '' : 'A lançar')}>
                <Badge className="cursor-pointer px-3 py-1" variant={statusFillFilter === 'A lançar' ? 'default' : 'secondary'}>A lançar: {aLancar}</Badge>
              </button>
              <button onClick={() => setStatusFillFilter(statusFillFilter === 'Erro de Preenchimento' ? '' : 'Erro de Preenchimento')}>
                <Badge className="cursor-pointer px-3 py-1" variant={statusFillFilter === 'Erro de Preenchimento' ? 'default' : 'destructive'}>Erro: {erro}</Badge>
              </button>
            </>
          );
        })()}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-64">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todos" options={STATUS_OPCOES} />
          </div>
          <div className="w-32"><Label>Grupo</Label><SearchInput value={grupo} onChange={(e) => setGrupo(e.target.value)} onClear={() => setGrupo('')} /></div>
          <div className="w-36"><Label>Pedido SAP</Label><SearchInput value={pedido} onChange={(e) => setPedido(e.target.value)} onClear={() => setPedido('')} /></div>
          <div className="w-36"><Label>Material Pai</Label><SearchInput value={material} onChange={(e) => setMaterial(e.target.value)} onClear={() => setMaterial('')} /></div>
          <div className="w-36"><Label>Processo</Label><SearchInput value={embarque} onChange={(e) => setEmbarque(e.target.value)} onClear={() => setEmbarque('')} /></div>

          {selecionadas.size >= 2 && editavel && (
            <div className="ml-auto flex flex-wrap items-end gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
              <div>
                <Label className="flex items-center gap-1">
                  <PencilRuler className="h-3 w-3" /> Edição em massa ({selecionadas.size} linhas)
                </Label>
                <div className="flex gap-2">
                  <Select
                    className="w-52"
                    value={campoMassa}
                    onChange={(e) => { setCampoMassa(e.target.value); setValorMassa(''); }}
                  >
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
              <Button
                size="sm"
                loading={aplicarMassa.isPending}
                onClick={() => {
                  if (confirm(`Aplicar "${defMassa.label}" em ${selecionadas.size} linha(s)?`)) aplicarMassa.mutate();
                }}
              >
                Aplicar
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Limpar seleção" onClick={() => setSelecionadas(new Set())}>
                <X />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.id}
        selecionadas={selecionadas}
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
        columnFilters={[
          { key: 'dc_status_calculado', tipo: 'select', options: opcStatus },
          { key: 'dc_grupo', tipo: 'select', options: opcGrupos },
          { key: 'dc_canal', tipo: 'select', options: opcCanal },
          { key: 'dc_fornecedor', tipo: 'select', options: opcForne },
          { key: 'cd_pedido_sap', tipo: 'text' },
          { key: 'cd_material_pai', tipo: 'text' },
          { key: 'cd_embarque', tipo: 'text' },
        ]}
      />

      {/* Assign Lançar / Responsável dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={(o) => !o && setAssignDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Definir Lançar / Responsável</DialogTitle>
            <DialogDescription>Aplica a seleção atual ({selecionadas.size} linhas).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <div>
              <Label>Marcar como Lançar?</Label>
              <Select value={assignLancar} onChange={(e) => setAssignLancar(e.target.value as 'Sim' | 'Não')}>
                <option value="Sim">Sim</option>
                <option value="Não">Não</option>
              </Select>
            </div>
            <div>
              <Label>Responsável</Label>
              <Input value={assignResponsavel} onChange={(e) => setAssignResponsavel(e.target.value)} placeholder="Nome ou e-mail" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancelar</Button>
            <Button loading={assignLancamento.isPending} onClick={() => {
              const ids = Array.from(selecionadas);
              assignLancamento.mutate({ ids, lancar: assignLancar === 'Sim', responsavel: assignResponsavel });
            }}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
