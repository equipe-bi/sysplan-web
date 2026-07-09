import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { CheckCheck, FileDown, FileUp, PlayCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCombos, useCompradores } from '@/services/combos';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import { AvaliacaoFollow } from './AvaliacaoFollow';

type StatusFiltro = '' | 'COM_RESPOSTA' | 'SEM_RESPOSTA';

interface LinhaFollow {
  cd_follow_forn: number;
  cd_compra: number;
  dt_inicio_followup: string | null;
  dc_fornecedor: string | null;
  produto: string;
  cd_pedido_fornecedor: string | null;
  cd_material_fornecedor: string | null;
  pedido_sap: string;
  dc_status_fornecedor: string | null;
  dt_revised_delivery_original: string | null;
  dt_revised_delivery_proposta: string | null;
  dc_avaliacao_comprador: string | null;
  dc_numero_bl: string | null;
  dt_novo_recebimento_comprador: string | null;
  dt_novo_delivery_comprador: string | null;
  dc_novo_modal_comprador: string | null;
  dc_grupo: string | null;
  dc_canal: string | null;
  dc_griffe: string | null;
  cd_material_pai: string | null;
}

export default function FollowupFornecedor() {
  const { usuario, podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('followup_fornecedor');
  const qc = useQueryClient();
  const { opcoes } = useCombos();
  const { data: compradores } = useCompradores();

  const [status, setStatus] = useState<StatusFiltro>('SEM_RESPOSTA');
  const [fornecedor, setFornecedor] = useState('');
  const [canal, setCanal] = useState('');
  const [grupo, setGrupo] = useState('');
  const [pi, setPi] = useState('');
  const [materialPai, setMaterialPai] = useState('');
  const [avaliacao, setAvaliacao] = useState<LinhaFollow | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['followups', status],
    queryFn: async () => {
      const seleciona = (inicio: number, fim: number) => {
        let q = supabase
          .from('followup_fornecedor')
          .select('*, compra:controle_compras!inner(cd_compra, dc_fornecedor, dc_grupo, dc_canal, dc_linha, dc_griffe, cd_pedido_fornecedor, cd_material_fornecedor, cd_pedido_sap, cd_material_pai, dc_status)')
          .neq('compra.dc_status', 'EXCLUIDO')
          .order('cd_follow_forn', { ascending: false });
        if (status === 'SEM_RESPOSTA') q = q.is('dt_fim_followup', null);
        if (status === 'COM_RESPOSTA') q = q.not('dt_fim_followup', 'is', null);
        return q.range(inicio, fim);
      };
      // limita a 5000 follow-ups mais recentes para manter a tela leve
      let rows = await fetchAll<any>(seleciona, 5000);
      if (status === 'COM_RESPOSTA') {
        // mantém apenas o último follow respondido de cada compra
        const vistos = new Set<number>();
        rows = rows.filter((r) => {
          if (vistos.has(r.cd_compra)) return false;
          vistos.add(r.cd_compra);
          return true;
        });
      }
      return (rows ?? []).map((r: any): LinhaFollow => ({
        ...r,
        dc_fornecedor: r.compra?.dc_fornecedor,
        dc_grupo: r.compra?.dc_grupo,
        dc_canal: r.compra?.dc_canal,
        dc_griffe: r.compra?.dc_griffe,
        cd_pedido_fornecedor: r.compra?.cd_pedido_fornecedor,
        cd_material_fornecedor: r.compra?.cd_material_fornecedor,
        cd_material_pai: r.compra?.cd_material_pai,
        produto: `${r.compra?.dc_grupo ?? ''} ${(r.compra?.dc_canal ?? '').slice(0, 3)} | ${['ESSENTIAL', 'CHILLI BEANS', 'PREMIUM'].includes(r.compra?.dc_linha) ? r.compra?.dc_linha : r.compra?.dc_griffe ?? ''}`,
        pedido_sap: `${r.compra?.cd_pedido_sap ?? ''} - ${r.compra?.cd_material_pai ?? ''}`,
      }));
    },
  });

  const filtrados = useMemo(() => {
    let r = data ?? [];
    if (fornecedor) r = r.filter((x) => x.dc_fornecedor === fornecedor);
    if (canal) r = r.filter((x) => x.dc_canal === canal);
    if (grupo) r = r.filter((x) => x.dc_grupo === grupo);
    if (pi) r = r.filter((x) => (x.cd_pedido_fornecedor ?? '').toLowerCase().includes(pi.toLowerCase()));
    if (materialPai) r = r.filter((x) => (x.cd_material_pai ?? '').toLowerCase().includes(materialPai.toLowerCase()));
    return r;
  }, [data, fornecedor, canal, grupo, pi, materialPai]);

  const rotinas = useMutation({
    mutationFn: async () => {
      const baixa = await supabase.rpc('fn_baixa_automatica_followup');
      if (baixa.error) throw baixa.error;
      const infos = await supabase.rpc('fn_atualiza_infos_followup');
      if (infos.error) throw infos.error;
      const need = await supabase.rpc('fn_gerar_necessidade_followup');
      if (need.error) throw need.error;
      return { baixa: baixa.data, novas: need.data };
    },
    onSuccess: (r) => {
      toast.success(`Rotinas executadas: ${r.baixa} baixa(s) automática(s), ${r.novas} follow-up(s) gerado(s).`);
      registraLog('FollowFornecedor - Rotinas automaticas', 0, '', `baixas=${r.baixa}; novos=${r.novas}`);
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const exportarPorFornecedor = async () => {
    // gera necessidade + baixa antes, como no legado
    await rotinas.mutateAsync().catch(() => {});
    let pend: any[];
    try {
      pend = await fetchAll<any>((inicio, fim) =>
        supabase.from('vw_followup_pendente').select('*').order('cd_follow_forn').range(inicio, fim),
      );
    } catch (e: any) {
      toast.error(e.message ?? String(e));
      return;
    }
    const porFornecedor = new Map<string, any[]>();
    for (const p of pend ?? []) {
      const f = p.dc_fornecedor ?? 'SEM FORNECEDOR';
      if (fornecedor && f !== fornecedor) continue;
      if (!porFornecedor.has(f)) porFornecedor.set(f, []);
      porFornecedor.get(f)!.push({
        'CD Follow': p.cd_follow_forn,
        'CD Compra': p.cd_compra,
        Supplier: p.dc_fornecedor,
        'Supplier Order': p.cd_pedido_fornecedor,
        'Supplier Reference': p.cd_material_fornecedor,
        'CB Order': p.cd_pedido_sap,
        'CD Reference': p.cd_material_pai,
        Group: p.grupo,
        Collection: p.colecao,
        'Delivery Date': p.delivery_date_atual,
        'CB Arrival Date': p.dt_recebimento_atual,
        Modal: p.dc_modal_atual,
        'Production Status': '',
        'Revised Delivery Date': '',
        'BL - bill of lading Number': '',
        'Supplier Comments': '',
      });
    }
    if (porFornecedor.size === 0) {
      toast.info('Nenhum follow-up pendente para exportar.');
      return;
    }
    for (const [forn, linhas] of porFornecedor) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Orders');
      XLSX.writeFile(wb, `Followup_Fornecedor_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} - ${forn.replace(/[\\/]/g, '')}.xlsx`);
    }
    registraLog('FollowFornecedor - Exportacao');
    toast.success(`${porFornecedor.size} arquivo(s) gerado(s) — um por fornecedor.`);
  };

  const importarRespostas = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { cellDates: true });
    const linhas = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
    const dt = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

    const erros: string[] = [];
    const validas: Record<string, any>[] = [];
    for (const [i, l] of linhas.entries()) {
      const cd = Number(l['CD Follow']);
      if (!cd) continue;
      if (!l['Production Status'] || !l['Revised Delivery Date']) {
        erros.push(`Linha ${i + 2} (Follow ${cd}): resposta do fornecedor incompleta`);
        continue;
      }
      if (
        !l['Avaliação Comprador'] || !l['Novo Recebimento'] || !l['Novo Delivery'] || !l['Novo Modal'] ||
        ['Pendencia fornecedor - Detalhar ação no campo obs', 'Proposta Recusada - detalhar campo observação', 'Avaliação Pendente'].includes(l['Avaliação Final'])
      ) {
        erros.push(`Linha ${i + 2} (Follow ${cd}): avaliação do comprador incompleta`);
        continue;
      }
      validas.push(l);
    }
    if (erros.length > 0) {
      toast.error(`Erro importação, campos não preenchidos (${erros.length} linha(s)).`, {
        description: erros.slice(0, 5).join(' | '),
        duration: 10000,
      });
      return;
    }
    let aplicadas = 0;
    for (const l of validas) {
      const cd = Number(l['CD Follow']);
      const cdCompra = Number(l['CD Compra']);
      const { error: e1 } = await supabase
        .from('followup_fornecedor')
        .update({
          dc_status_fornecedor: l['Production Status'],
          dc_observacao_fornecedor: l['Supplier Comments'],
          dt_revised_delivery_proposta: dt(l['Revised Delivery Date']),
          dc_numero_bl: l['BL - bill of lading Number'],
          dc_avaliacao_fornecedor: l['Status fornecedor'],
          dc_avaliacao_comprador: l['Avaliação Comprador'],
          dc_observacao_avaliacao: l['Observação Comprador'],
          dt_novo_recebimento_comprador: dt(l['Novo Recebimento']),
          dt_novo_delivery_comprador: dt(l['Novo Delivery']),
          dc_novo_modal_comprador: l['Novo Modal'],
          dc_avaliacao_final: l['Avaliação Final'],
          dt_avaliacao_comprador: new Date().toISOString().slice(0, 10),
          dt_fim_followup: new Date().toISOString().slice(0, 10),
        })
        .eq('cd_follow_forn', cd);
      if (e1) {
        toast.error(`Follow ${cd}: ${e1.message}`);
        continue;
      }
      // aplica na compra: delivery sempre que difere; modal se difere; recebimento só se ainda era o original
      const { data: compra } = await supabase
        .from('controle_compras')
        .select('dt_recebimento, dt_revised_delivery, dc_modal')
        .eq('cd_compra', cdCompra)
        .maybeSingle();
      if (compra) {
        const upd: Record<string, any> = {};
        const novoDelivery = dt(l['Novo Delivery']);
        const novoModal = l['Novo Modal'];
        const novoRec = dt(l['Novo Recebimento']);
        if (novoDelivery && novoDelivery !== dt(l['Delivery Date'])) upd.dt_revised_delivery = novoDelivery;
        if (novoModal && novoModal !== l['Modal']) upd.dc_modal = novoModal;
        if (novoRec && novoRec !== dt(l['CB Arrival Date']) && compra.dt_recebimento === dt(l['CB Arrival Date'])) {
          upd.dt_recebimento = novoRec;
        }
        if (Object.keys(upd).length > 0) {
          await supabase.from('controle_compras').update(upd).eq('cd_compra', cdCompra);
        }
      }
      aplicadas++;
    }
    registraLog('FollowFornecedor - Importacao', 0, '', `${aplicadas} respostas`);
    await supabase.from('importacoes').insert({
      usuario_id: usuario?.id,
      tipo: 'followup_fornecedor',
      nome_arquivo: file.name,
      total_linhas: linhas.length,
      linhas_validas: aplicadas,
      linhas_erro: erros.length,
      status: 'aplicado',
      aplicado_em: new Date().toISOString(),
    });
    toast.success(`${aplicadas} resposta(s) de follow-up aplicada(s).`);
    qc.invalidateQueries({ queryKey: ['followups'] });
  };

  const colunas: Coluna<LinhaFollow>[] = [
    { key: 'cd_follow_forn', titulo: 'Follow' },
    { key: 'cd_compra', titulo: 'CD' },
    { key: 'dt_inicio_followup', titulo: 'Início', render: (r) => formatDate(r.dt_inicio_followup) },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'produto', titulo: 'Produto' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_material_fornecedor', titulo: 'Ref Fornecedor' },
    { key: 'pedido_sap', titulo: 'Pedido SAP' },
    { key: 'dc_status_fornecedor', titulo: 'Status Fornecedor' },
    { key: 'dt_revised_delivery_original', titulo: 'Delivery Atual', render: (r) => formatDate(r.dt_revised_delivery_original) },
    { key: 'dt_revised_delivery_proposta', titulo: 'Delivery Proposta', render: (r) => formatDate(r.dt_revised_delivery_proposta) },
    { key: 'dc_avaliacao_comprador', titulo: 'Avaliação' },
    { key: 'dc_numero_bl', titulo: 'BL' },
    { key: 'dt_novo_recebimento_comprador', titulo: 'Rec Revisado', render: (r) => formatDate(r.dt_novo_recebimento_comprador) },
    { key: 'dt_novo_delivery_comprador', titulo: 'Delivery Revisado', render: (r) => formatDate(r.dt_novo_delivery_comprador) },
    { key: 'dc_novo_modal_comprador', titulo: 'Modal Revisado' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-up Fornecedor</h1>
          <p className="text-sm text-muted-foreground">Cobrança e avaliação de status junto aos fornecedores</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw /> Atualizar
          </Button>
          {editavel && (
            <>
              <Button variant="secondary" loading={rotinas.isPending} onClick={() => rotinas.mutate()}>
                <PlayCircle /> Gerar necessidade + baixa automática
              </Button>
              <Button variant="outline" onClick={exportarPorFornecedor}>
                <FileDown /> Exportar (por fornecedor)
              </Button>
              <label>
                <Button variant="outline" onClick={() => document.getElementById('imp-follow')?.click()}>
                  <FileUp /> Importar respostas
                </Button>
                <input
                  id="imp-follow"
                  type="file"
                  accept=".xlsx,.xlsb,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importarRespostas(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-56">
            <Label>Situação</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFiltro)}>
              <option value="SEM_RESPOSTA">ULTIMO FOLLOW - AGUARD RESPOSTA</option>
              <option value="COM_RESPOSTA">ULTIMO FOLLOW - COM RESPOSTA</option>
              <option value="">TODOS</option>
            </Select>
          </div>
          <div className="w-44">
            <Label>Fornecedor</Label>
            <Select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Todos" options={opcoes('FORNECEDOR')} />
          </div>
          <div className="w-36">
            <Label>Canal</Label>
            <Select value={canal} onChange={(e) => setCanal(e.target.value)} placeholder="Todos" options={opcoes('CANAL')} />
          </div>
          <div className="w-36">
            <Label>Grupo</Label>
            <Select value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Todos" options={[...new Set((compradores ?? []).map((c: any) => c.dc_grupo).filter(Boolean))] as string[]} />
          </div>
          <div className="w-36">
            <Label>PI</Label>
            <Input value={pi} onChange={(e) => setPi(e.target.value)} />
          </div>
          <div className="w-36">
            <Label>Material Pai</Label>
            <Input value={materialPai} onChange={(e) => setMaterialPai(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.cd_follow_forn}
        onRowDoubleClick={(r) => setAvaliacao(r)}
        rodape={<span className="ml-2 inline-flex items-center gap-1"><CheckCheck className="h-3 w-3" /> duplo clique para avaliar</span>}
      />

      {avaliacao && (
        <AvaliacaoFollow
          follow={avaliacao}
          somenteLeitura={!editavel}
          onFechar={(mudou) => {
            setAvaliacao(null);
            if (mudou) qc.invalidateQueries({ queryKey: ['followups'] });
          }}
        />
      )}
    </div>
  );
}
