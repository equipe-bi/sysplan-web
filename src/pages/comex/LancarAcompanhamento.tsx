import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarSearch, FileDown, RefreshCw, Ship } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { confirmar } from '@/components/ui/confirm';
import { Input, Label } from '@/components/ui/input';
import { PainelFiltros } from '@/components/ui/painel-filtros';
import { Badge } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber, anoMes, cn } from '@/lib/utils';

/**
 * Lançar no Acompanhamento (Followup Agente de Carga)
 * ----------------------------------------------------
 * Alimenta o Followup Agente de Carga a partir da lista de compras Web.
 * Regra (check chave MaterialPai + Pedido SAP):
 *  - "Já lançado": a chave (pedido_sap + material_pai) já existe no acompanhamento.
 *  - "Erro de Preenchimento": Material Pai (8 caracteres) ou Pedido SAP (10 dígitos)
 *    fora do padrão — não pode ser lançado.
 *  - "A lançar": preenchido corretamente, modal marcado para lançar e ainda não lançado.
 *  - "Modal não lançável": válido mas o modal não está marcado no parâmetro.
 * Os modais a lançar são configuráveis em Administração → Parâmetros (Modais a Lançar).
 */

type StatusPreench = 'Já lançado' | 'A lançar' | 'Erro de Preenchimento' | 'Modal não lançável';

const CORES: Record<StatusPreench, 'success' | 'default' | 'destructive' | 'secondary'> = {
  'Já lançado': 'secondary',
  'A lançar': 'success',
  'Erro de Preenchimento': 'destructive',
  'Modal não lançável': 'default',
};

const materialOk = (v: string | null) => !!v && /^[A-Za-z0-9]{8}$/.test(v.trim());
const pedidoOk = (v: string | null) => !!v && /^\d{10}$/.test(v.trim());

export default function LancarAcompanhamento() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('lancar_acompanhamento');
  const qc = useQueryClient();

  const [anoMesBusca, setAnoMesBusca] = useState(String(anoMes(0)));
  const [buscado, setBuscado] = useState(false);
  const [kpiSel, setKpiSel] = useState<StatusPreench | ''>('');

  // Parâmetro de modais a lançar (se a tabela ainda não existir, cai no fallback)
  const { data: modais } = useQuery({
    queryKey: ['prm_modal_lancamento'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_modal_lancamento').select('*');
      if (error) return null; // tabela ausente → fallback
      return data as { dc_modal: string; lancar: boolean }[];
    },
  });
  const modalLanca = (m: string | null) => {
    const modal = (m ?? '').toUpperCase().trim();
    if (!modais) return !modal.startsWith('ROAD'); // fallback: tudo menos ROAD
    return modais.find((x) => x.dc_modal === modal)?.lancar ?? false;
  };

  // Responsável por grupo+canal (cluster comprador)
  const { data: clusters } = useQuery({
    queryKey: ['prm_cluster_comprador'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_cluster_comprador').select('dc_grupo, dc_canal, dc_comprador');
      if (error) throw error;
      return data as { dc_grupo: string; dc_canal: string; dc_comprador: string }[];
    },
  });
  const responsavelDe = (grupo: string | null, canal: string | null) =>
    (clusters ?? []).find((c) => c.dc_grupo === grupo && c.dc_canal === canal)?.dc_comprador ?? '';

  const { data: preview, isLoading, refetch } = useQuery({
    queryKey: ['lancar_preview', anoMesBusca],
    enabled: buscado,
    queryFn: async () => {
      const ini = `${anoMesBusca.slice(0, 4)}-${anoMesBusca.slice(4, 6)}-01`;
      const y = Number(anoMesBusca.slice(0, 4));
      const m = Number(anoMesBusca.slice(4, 6));
      const fim = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

      const compras = await fetchAll<any>((i, f) =>
        supabase
          .from('controle_compras')
          .select('cd_compra, dc_grupo, dc_canal, dc_fornecedor, cd_material_pai, cd_pedido_fornecedor, cd_pedido_sap, nr_quantidade, dc_modal, dt_revised_delivery, dt_recebimento')
          .neq('dc_status', 'EXCLUIDO')
          .gte('dt_revised_delivery', ini)
          .lt('dt_revised_delivery', fim)
          .order('dt_revised_delivery')
          .range(i, f),
      );

      // Chaves já no acompanhamento (check MaterialPai + Pedido SAP)
      const jaSet = new Set<string>();
      const chaves = [...new Set(compras.map((c) => `${c.cd_pedido_sap ?? ''}${c.cd_material_pai ?? ''}`).filter((k) => k))];
      for (let i = 0; i < chaves.length; i += 300) {
        const { data: bloco } = await supabase
          .from('acompanhamento_importacoes')
          .select('chave')
          .in('chave', chaves.slice(i, i + 300));
        for (const r of bloco ?? []) jaSet.add(r.chave);
      }

      return compras.map((c) => {
        const chave = `${c.cd_pedido_sap ?? ''}${c.cd_material_pai ?? ''}`;
        const preenchOk = materialOk(c.cd_material_pai) && pedidoOk(c.cd_pedido_sap);
        let status: StatusPreench;
        if (jaSet.has(chave)) status = 'Já lançado';
        else if (!preenchOk) status = 'Erro de Preenchimento';
        else if (!modalLanca(c.dc_modal)) status = 'Modal não lançável';
        else status = 'A lançar';
        return {
          ...c,
          status_preenchimento: status,
          lancar: status === 'A lançar' ? 'Sim' : 'Não',
          responsavel: responsavelDe(c.dc_grupo, c.dc_canal),
        };
      });
    },
  });

  const kpis = useMemo(() => {
    const m = new Map<StatusPreench, number>();
    for (const r of preview ?? []) m.set(r.status_preenchimento, (m.get(r.status_preenchimento) ?? 0) + 1);
    return m;
  }, [preview]);

  const filtrados = useMemo(
    () => (kpiSel ? (preview ?? []).filter((r) => r.status_preenchimento === kpiSel) : preview ?? []),
    [preview, kpiSel],
  );
  const aLancar = useMemo(() => (preview ?? []).filter((r) => r.status_preenchimento === 'A lançar'), [preview]);

  const lancar = useMutation({
    mutationFn: async () => {
      if (aLancar.length === 0) throw new Error('Não há registros "A lançar" neste mês.');
      const registros = aLancar.map((c) => ({
        cd_compra: c.cd_compra,
        dc_grupo: c.dc_grupo === 'MATERIAIS CONSUMIVEIS' ? c.dc_grupo : c.dc_grupo,
        dc_canal: c.dc_canal,
        dc_fornecedor: c.dc_fornecedor,
        cd_ref_fornecedor: null,
        cd_material_pai: c.cd_material_pai,
        cd_pedido_fornecedor: c.cd_pedido_fornecedor,
        cd_pedido_sap: c.cd_pedido_sap,
        nr_quantidade: c.nr_quantidade ?? 0,
        dt_recebimento: c.dt_recebimento,
        dc_modal: c.dc_modal,
        dt_delivery: c.dt_revised_delivery,
      }));
      for (let i = 0; i < registros.length; i += 500) {
        const { error } = await supabase.from('acompanhamento_importacoes').insert(registros.slice(i, i + 500));
        if (error) throw error;
      }
      registraLog('LancarAcompanhamento - Lancamento', 0, '', `AnoMes ${anoMesBusca} → ${registros.length} registros`);
      return registros.length;
    },
    onSuccess: (qtd) => {
      toast.success(`${qtd} registro(s) lançado(s) no Follow-up Agente de Carga!`);
      qc.invalidateQueries({ queryKey: ['acompanhamento_importacoes'] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    {
      key: 'status_preenchimento', titulo: 'Status Preenchimento',
      valor: (r) => r.status_preenchimento,
      render: (r) => <Badge variant={CORES[r.status_preenchimento as StatusPreench] ?? 'secondary'}>{r.status_preenchimento}</Badge>,
    },
    { key: 'lancar', titulo: 'Lançar' },
    { key: 'responsavel', titulo: 'Responsável' },
    { key: 'cd_compra', titulo: 'CD Compra' },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'nr_quantidade', titulo: 'Qtde', valor: (r) => r.nr_quantidade, render: (r) => formatNumber(r.nr_quantidade, 0) },
    { key: 'dc_modal', titulo: 'Modal' },
    { key: 'dt_revised_delivery', titulo: 'Revised Delivery', valor: (r) => r.dt_revised_delivery, render: (r) => formatDate(r.dt_revised_delivery) },
    { key: 'dt_recebimento', titulo: 'Recebimento', valor: (r) => r.dt_recebimento, render: (r) => formatDate(r.dt_recebimento) },
  ];

  const isValido = /^\d{6}$/.test(anoMesBusca);

  const kpiCard = (label: StatusPreench, cor: string) => (
    <button key={label} onClick={() => setKpiSel(kpiSel === label ? '' : label)}>
      <div className={cn('rounded-md border px-4 py-2 text-left transition-colors', kpiSel === label && 'ring-2 ring-primary', cor)}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{formatNumber(kpis.get(label) ?? 0, 0)}</p>
      </div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lançar no Follow-up Agente de Carga</h1>
        <p className="text-sm text-muted-foreground">
          Filtre pelo AnoMês do Revised Delivery e lance no Followup Agente de Carga (check chave Material Pai + Pedido SAP)
        </p>
      </div>

      <PainelFiltros titulo="Filtros e ações">
          <div className="w-40">
            <Label>AnoMês (Revised Delivery)</Label>
            <Input
              placeholder="Ex: 202608"
              value={anoMesBusca}
              onChange={(e) => { setAnoMesBusca(e.target.value.replace(/\D/g, '').slice(0, 6)); setBuscado(false); }}
            />
          </div>
          <Button onClick={() => { if (!isValido) { toast.error('Informe o AnoMês no formato YYYYMM.'); return; } setBuscado(true); refetch(); }}>
            <CalendarSearch /> Buscar
          </Button>
          {buscado && (
            <>
              <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
              <Button
                variant="outline"
                onClick={() => {
                  exportarExcel(colunas.map((c) => ({ key: c.key, titulo: c.titulo })), aLancar, `SysPlan_ALancar_${anoMesBusca}`);
                  registraLog('LancarAcompanhamento - Exportacao A Lancar', 0, '', `${aLancar.length} linhas`);
                }}
              >
                <FileDown /> Exportar "a lançar"
              </Button>
            </>
          )}
      </PainelFiltros>

      {buscado && (
        <>
          <div className="flex flex-wrap gap-3">
            {kpiCard('A lançar', 'border-emerald-500/40 bg-emerald-500/5')}
            {kpiCard('Erro de Preenchimento', 'border-destructive/40 bg-destructive/5')}
            {kpiCard('Já lançado', 'bg-muted/40')}
            {kpiCard('Modal não lançável', 'border-amber-500/40 bg-amber-500/5')}
            {editavel && aLancar.length > 0 && (
              <Button
                className="ml-auto self-center"
                size="lg"
                loading={lancar.isPending}
                onClick={async () => {
                  if (await confirmar({ titulo: 'Lançar no Acompanhamento', mensagem: `Lançar ${aLancar.length} registro(s) "A lançar" do AnoMês ${anoMesBusca}?`, textoConfirmar: 'Lançar' })) lancar.mutate();
                }}
              >
                <Ship /> Lançar {aLancar.length} registro(s)
              </Button>
            )}
          </div>

          <DataTable
            colunas={colunas}
            dados={filtrados}
            carregando={isLoading}
            rowKey={(r) => r.cd_compra}
            autofiltro
            paginacao={200}
          />
        </>
      )}

      {!buscado && (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
          <CalendarSearch className="h-12 w-12 opacity-30" />
          <p className="text-sm">Informe o AnoMês e clique em Buscar.</p>
        </div>
      )}
    </div>
  );
}
