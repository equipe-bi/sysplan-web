import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';

interface CampoDef {
  nome: string;
  label: string;
  tipo?: 'texto' | 'numero';
}

interface TabelaDef {
  id: string;
  nome: string;
  tabela: string;
  pk: string[];
  pkGerada?: boolean;
  campos: CampoDef[];
}

const TABELAS: TabelaDef[] = [
  {
    id: 'combos', nome: 'PRM Combos', tabela: 'prm_combos', pk: ['cd_combo'], pkGerada: true,
    campos: [
      { nome: 'cd_grupo', label: 'CD Grupo', tipo: 'numero' },
      { nome: 'dc_tipo_combo', label: 'Tipo Combo' },
      { nome: 'dc_combo', label: 'Valor' },
    ],
  },
  {
    id: 'grupo_planejamento', nome: 'PRM Grupo Planejamento', tabela: 'prm_grupo_planejamento',
    pk: ['dc_grupo', 'dc_subgrupo', 'dc_sexo', 'dc_formato'],
    campos: [
      { nome: 'dc_grupo', label: 'Grupo' },
      { nome: 'dc_subgrupo', label: 'SubGrupo' },
      { nome: 'dc_sexo', label: 'Sexo' },
      { nome: 'dc_formato', label: 'Formato' },
      { nome: 'dc_grupo_planejamento', label: 'Grupo Planejamento' },
    ],
  },
  {
    id: 'grupo', nome: 'PRM Grupo', tabela: 'prm_grupo', pk: ['cd_grupo'], pkGerada: true,
    campos: [{ nome: 'dc_grupo', label: 'Grupo' }],
  },
  {
    id: 'definicao_custo', nome: 'Definição de Custo', tabela: 'prm_definicao_custo',
    pk: ['dc_canal', 'dc_grupo', 'dc_modal', 'nr_anomes'],
    campos: [
      { nome: 'dc_canal', label: 'Canal' },
      { nome: 'dc_grupo', label: 'Grupo' },
      { nome: 'dc_modal', label: 'Modal' },
      { nome: 'nr_anomes', label: 'AnoMês', tipo: 'numero' },
      { nome: 'nr_dolar', label: 'Dólar', tipo: 'numero' },
      { nome: 'nr_fator_imp', label: 'Fator Imp.', tipo: 'numero' },
      { nome: 'nr_markup', label: 'Markup', tipo: 'numero' },
      { nome: 'nr_valor_agregado', label: 'Valor Agregado', tipo: 'numero' },
    ],
  },
  {
    id: 'cluster', nome: 'Cluster Comprador', tabela: 'prm_cluster_comprador', pk: ['cd_cluster'], pkGerada: true,
    campos: [
      { nome: 'dc_grupo', label: 'Grupo' },
      { nome: 'dc_canal', label: 'Canal' },
      { nome: 'dc_comprador', label: 'Comprador' },
      { nome: 'dc_comprador_grupo', label: 'Comprador Grupo' },
    ],
  },
  {
    id: 'ajuste_fob', nome: 'Ajuste FOB', tabela: 'prm_ajuste_fob', pk: ['cd_pedido_sap', 'cd_material_pai'],
    campos: [
      { nome: 'cd_pedido_sap', label: 'Pedido SAP' },
      { nome: 'cd_material_pai', label: 'Material Pai' },
      { nome: 'nr_fob', label: 'FOB', tipo: 'numero' },
    ],
  },
  {
    id: 'ajuste_pedido', nome: 'Ajuste Pedido SAP', tabela: 'prm_ajuste_pedido_sap_cadastro', pk: ['id_sysplan'],
    campos: [
      { nome: 'id_sysplan', label: 'ID Sysplan', tipo: 'numero' },
      { nome: 'cd_pedido_fornecedor', label: 'PI' },
      { nome: 'cd_material_fornecedor', label: 'Ref Fornecedor' },
      { nome: 'cd_pedido_sap', label: 'Pedido SAP' },
      { nome: 'cd_material_pai', label: 'Material Pai' },
    ],
  },
  {
    id: 'depara_pi', nome: 'De-Para Campos PI', tabela: 'prm_depara_campos_pi', pk: ['id'], pkGerada: true,
    campos: [
      { nome: 'cd_grupo', label: 'CD Grupo', tipo: 'numero' },
      { nome: 'dc_tipo_combo', label: 'Tipo Combo' },
      { nome: 'info_de', label: 'De (PI)' },
      { nome: 'info_para', label: 'Para (Combo)' },
    ],
  },
  {
    id: 'cor_pi', nome: 'Cores PI (tradução)', tabela: 'prm_cor_pi', pk: ['id'], pkGerada: true,
    campos: [
      { nome: 'dc_campo', label: 'Tipo' },
      { nome: 'dc_texto_ingles', label: 'Inglês' },
      { nome: 'dc_texto_portugues', label: 'Português' },
      { nome: 'cd_codigo_cor', label: 'Código Cor' },
      { nome: 'ordem_pesquisa', label: 'Ordem', tipo: 'numero' },
    ],
  },
  {
    id: 'essential', nome: 'Cadastro Essential', tabela: 'cadastro_essential', pk: ['cd_essential'], pkGerada: true,
    campos: [
      { nome: 'dc_grupo', label: 'Grupo' },
      { nome: 'dc_essential', label: 'Essential' },
      { nome: 'cd_material_pai_atual', label: 'Material Pai Atual' },
      { nome: 'cd_ref_exportador_atual', label: 'Ref Exportador Atual' },
      { nome: 'dc_status', label: 'Status' },
    ],
  },
];

const ROTINAS = [
  { nome: 'Recalcular Grupo Planejamento nas compras', fn: 'fn_recalcular_grupo_planejamento' },
  { nome: 'Aplicar Ajuste de FOB nas compras', fn: 'fn_aplicar_ajuste_fob' },
  { nome: 'Aplicar Ajuste Pedido SAP nas compras', fn: 'fn_aplicar_ajuste_pedido_sap' },
  { nome: 'Recarregar EXT Pedido SAP (do snapshot BW)', fn: 'fn_atualizar_pedido_sap_bw' },
];

function CrudTabela({ def }: { def: TabelaDef }) {
  const { registraLog } = useAuth();
  const qc = useQueryClient();
  const [edicao, setEdicao] = useState<Record<string, any> | null>(null);
  const [novoRegistro, setNovoRegistro] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['prm', def.tabela],
    queryFn: async () =>
      fetchAll<Record<string, any>>((inicio, fim) =>
        supabase.from(def.tabela).select('*').order(def.pk[0]).range(inicio, fim),
      ),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!edicao) return;
      const payload: Record<string, any> = {};
      for (const c of def.campos) payload[c.nome] = c.tipo === 'numero' ? Number(edicao[c.nome]) || 0 : edicao[c.nome] ?? '';
      if (novoRegistro) {
        if (!def.pkGerada) for (const k of def.pk) payload[k] = edicao[k];
        const { error } = await supabase.from(def.tabela).insert(payload);
        if (error) throw error;
      } else {
        let q = supabase.from(def.tabela).update(payload);
        for (const k of def.pk) q = q.eq(k, edicao[k]);
        const { error } = await q;
        if (error) throw error;
      }
      registraLog(`Admin - Parametro ${def.nome} - ${novoRegistro ? 'Inclusao' : 'Alteracao'}`);
    },
    onSuccess: () => {
      toast.success('Salvo.');
      setEdicao(null);
      qc.invalidateQueries({ queryKey: ['prm', def.tabela] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const excluir = useMutation({
    mutationFn: async (row: Record<string, any>) => {
      let q = supabase.from(def.tabela).delete();
      for (const k of def.pk) q = q.eq(k, row[k]);
      const { error } = await q;
      if (error) throw error;
      registraLog(`Admin - Parametro ${def.nome} - Exclusao`, 0, JSON.stringify(row).slice(0, 200));
    },
    onSuccess: () => {
      toast.success('Excluído.');
      qc.invalidateQueries({ queryKey: ['prm', def.tabela] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    ...(def.pkGerada ? [{ key: def.pk[0], titulo: def.pk[0].toUpperCase() }] : []),
    ...def.campos.map((c) => ({ key: c.nome, titulo: c.label })),
    {
      key: '__acoes',
      titulo: '',
      ordenavel: false,
      render: (row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setNovoRegistro(false); setEdicao({ ...row }); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm('Excluir registro?')) excluir.mutate(row); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => { setNovoRegistro(true); setEdicao({}); }}>
        <Plus /> Novo
      </Button>
      <DataTable colunas={colunas} dados={data ?? []} carregando={isLoading} rowKey={(r) => def.pk.map((k) => r[k]).join('|')} paginacao={25} altura="calc(100vh - 400px)" />
      {edicao && (
        <Dialog open onOpenChange={(o) => !o && setEdicao(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{def.nome}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {def.campos.map((c) => (
                <div key={c.nome}>
                  <Label>{c.label}</Label>
                  <Input
                    type={c.tipo === 'numero' ? 'number' : 'text'}
                    value={edicao[c.nome] ?? ''}
                    disabled={!novoRegistro && def.pk.includes(c.nome) && !def.pkGerada}
                    onChange={(e) => setEdicao({ ...edicao, [c.nome]: e.target.value })}
                  />
                </div>
              ))}
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

export default function AdminParametros() {
  const { registraLog } = useAuth();
  const [rodando, setRodando] = useState<string | null>(null);

  const executarRotina = async (rotina: { nome: string; fn: string }) => {
    setRodando(rotina.fn);
    const { data, error } = await supabase.rpc(rotina.fn);
    setRodando(null);
    if (error) toast.error(error.message);
    else {
      registraLog(`Admin - Rotina ${rotina.nome}`, 0, '', String(data));
      toast.success(`${rotina.nome}: ${data} registro(s) afetado(s).`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parâmetros</h1>
        <p className="text-sm text-muted-foreground">Tabelas parametrizadas do sistema e rotinas de manutenção</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Rotinas de manutenção (legado: consultas de atualização)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-3">
          {ROTINAS.map((r) => (
            <Button key={r.fn} variant="outline" size="sm" loading={rodando === r.fn} onClick={() => executarRotina(r)}>
              <Play /> {r.nome}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Tabs defaultValue={TABELAS[0].id}>
        <TabsList className="flex-wrap">
          {TABELAS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.nome}</TabsTrigger>
          ))}
        </TabsList>
        {TABELAS.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            <CrudTabela def={t} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
