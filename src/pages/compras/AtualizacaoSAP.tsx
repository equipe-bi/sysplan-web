import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileUp, RefreshCw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchPaginasParalelo } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { PainelFiltros } from '@/components/ui/painel-filtros';
import { confirmar } from '@/components/ui/confirm';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportarExcel, lerPlanilha } from '@/lib/exportar';

/**
 * Atualização de Pedido SAP / Material Pai
 * ----------------------------------------
 * Tela dedicada (esses campos são bloqueados na edição de compra).
 * Permite atualizar em massa via Excel (exporta modelo → preenche → importa)
 * e editar registro a registro (duplo clique).
 */
export default function AtualizacaoSAP() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('lista_compras');
  const qc = useQueryClient();

  const [busca, setBusca] = useState('');
  const [edicao, setEdicao] = useState<any | null>(null);
  const [importando, setImportando] = useState(false);

  const COLS_SAP = 'cd_compra, dc_status, dc_grupo, dc_canal, dc_fornecedor, cd_pedido_fornecedor, cd_material_fornecedor, cd_pedido_sap, cd_material_pai';
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['atualizacao_sap'],
    queryFn: async () => {
      // conta primeiro e busca as páginas em paralelo (bem mais rápido que sequencial)
      const { count } = await supabase
        .from('controle_compras')
        .select('cd_compra', { count: 'exact', head: true })
        .neq('dc_status', 'EXCLUIDO');
      return fetchPaginasParalelo<any>(
        (i, f) =>
          supabase
            .from('controle_compras')
            .select(COLS_SAP)
            .neq('dc_status', 'EXCLUIDO')
            .order('cd_compra', { ascending: false })
            .range(i, f),
        count ?? 0,
      );
    },
  });

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return data ?? [];
    return (data ?? []).filter((r) =>
      [r.cd_compra, r.cd_pedido_fornecedor, r.cd_material_fornecedor, r.cd_pedido_sap, r.cd_material_pai, r.dc_fornecedor]
        .some((v) => String(v ?? '').toLowerCase().includes(b)),
    );
  }, [data, busca]);

  const exportarModelo = () => {
    exportarExcel(
      [
        { key: 'cd_compra', titulo: 'cd_compra' },
        { key: 'cd_pedido_sap', titulo: 'cd_pedido_sap' },
        { key: 'cd_material_pai', titulo: 'cd_material_pai' },
      ],
      filtrados.map((r) => ({ cd_compra: r.cd_compra, cd_pedido_sap: r.cd_pedido_sap ?? '', cd_material_pai: r.cd_material_pai ?? '' })),
      'SysPlan_Modelo_PedidoSAP_MaterialPai',
    );
    registraLog('AtualizacaoSAP - Exportar Modelo');
  };

  const importar = async (file: File) => {
    setImportando(true);
    try {
      const linhas = await lerPlanilha(file);
      const val = (l: any, ...nomes: string[]) => {
        for (const n of nomes) if (l[n] != null && l[n] !== '') return l[n];
        return undefined;
      };
      const rows = linhas
        .map((l) => ({
          cd_compra: Number(val(l, 'cd_compra', 'CD_COMPRA', 'CD Compra', 'CD')),
          cd_pedido_sap: val(l, 'cd_pedido_sap', 'CD_PEDIDO_SAP', 'Pedido SAP', 'PO'),
          cd_material_pai: val(l, 'cd_material_pai', 'CD_MATERIAL_PAI', 'Material Pai'),
        }))
        .filter((r) => r.cd_compra && (r.cd_pedido_sap != null || r.cd_material_pai != null));
      if (rows.length === 0) throw new Error('Nenhuma linha válida encontrada (colunas cd_compra + Pedido SAP/Material Pai).');

      // Confirmação: mostra a quantidade de linhas que serão alteradas antes de executar
      const ok = await confirmar({
        titulo: 'Confirmar importação',
        mensagem: `${rows.length.toLocaleString('pt-BR')} linha(s) serão atualizadas (Pedido SAP / Material Pai).\n\nDeseja executar a importação?`,
        textoConfirmar: 'Executar importação',
      });
      if (!ok) return;

      let aplicadas = 0;
      const erros: string[] = [];
      // executa em lotes paralelos para acelerar
      for (let i = 0; i < rows.length; i += 25) {
        const lote = rows.slice(i, i + 25);
        const res = await Promise.all(
          lote.map((r) => {
            const upd: any = {};
            if (r.cd_pedido_sap != null) upd.cd_pedido_sap = String(r.cd_pedido_sap);
            if (r.cd_material_pai != null) upd.cd_material_pai = String(r.cd_material_pai);
            return supabase.from('controle_compras').update(upd).eq('cd_compra', r.cd_compra).then(({ error }) => ({ cd: r.cd_compra, error }));
          }),
        );
        for (const { cd, error } of res) {
          if (error) erros.push(`CD ${cd}: ${error.message}`);
          else aplicadas++;
        }
      }
      registraLog('AtualizacaoSAP - Importacao em Massa', 0, '', `${aplicadas} atualizados`);
      toast.success(`${aplicadas} registro(s) atualizados${erros.length ? ` · ${erros.length} erro(s)` : ''}.`, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ['atualizacao_sap'] });
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setImportando(false);
    }
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!edicao) return;
      const { error } = await supabase
        .from('controle_compras')
        .update({ cd_pedido_sap: edicao.cd_pedido_sap || null, cd_material_pai: edicao.cd_material_pai || null })
        .eq('cd_compra', edicao.cd_compra);
      if (error) throw error;
      registraLog('AtualizacaoSAP - Edicao Unitaria', edicao.cd_compra, '', `${edicao.cd_pedido_sap} / ${edicao.cd_material_pai}`);
    },
    onSuccess: () => {
      toast.success('Registro atualizado.');
      setEdicao(null);
      qc.invalidateQueries({ queryKey: ['atualizacao_sap'] });
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    { key: 'cd_compra', titulo: 'CD Compra' },
    { key: 'dc_status', titulo: 'Status' },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_material_fornecedor', titulo: 'Ref Fornecedor' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Atualização Pedido SAP / Material Pai</h1>
          <p className="text-sm text-muted-foreground">
            Campos bloqueados na edição de compra — atualize aqui em massa (Excel) ou registro a registro (duplo clique)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw /> Atualizar</Button>
          <Button variant="outline" onClick={exportarModelo}><FileDown /> Exportar modelo</Button>
          {editavel && (
            <>
              <Button loading={importando} onClick={() => document.getElementById('imp-sap')?.click()}>
                <FileUp /> Importar em massa
              </Button>
              <input
                id="imp-sap" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ''; }}
              />
            </>
          )}
        </div>
      </div>

      <PainelFiltros>
          <div className="w-80">
            <Label>Pesquisar (CD, PI, Ref, Pedido SAP, Material Pai, Fornecedor)</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
      </PainelFiltros>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.cd_compra}
        autofiltro
        busca={false}
        onRowDoubleClick={(r) => editavel && setEdicao({ ...r })}
        rodape={<span className="ml-2">duplo clique para editar Pedido SAP / Material Pai</span>}
      />

      {edicao && (
        <Dialog open onOpenChange={(o) => !o && setEdicao(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Atualizar — CD {edicao.cd_compra}</DialogTitle></DialogHeader>
            <div className="rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
              {edicao.dc_grupo} · {edicao.dc_canal} · {edicao.dc_fornecedor} · PI {edicao.cd_pedido_fornecedor} · Ref {edicao.cd_material_fornecedor}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Pedido SAP</Label>
                <Input value={edicao.cd_pedido_sap ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_pedido_sap: e.target.value })} />
              </div>
              <div>
                <Label>Material Pai</Label>
                <Input value={edicao.cd_material_pai ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_material_pai: e.target.value })} />
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
