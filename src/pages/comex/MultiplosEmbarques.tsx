import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, PlayCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { confirmar } from '@/components/ui/confirm';
import { Input, Label } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Card, CardContent } from '@/components/ui/card';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber } from '@/lib/utils';

export default function MultiplosEmbarques() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('multiplos_embarques');
  const qc = useQueryClient();
  const [selecionada, setSelecionada] = useState<any | null>(null);
  const [pedidoAjuste, setPedidoAjuste] = useState('');
  const [soPendentes, setSoPendentes] = useState(true);

  /** Pendente = linha ainda sem o Pedido SAP ajustado preenchido */
  const ehPendente = (r: any) => !r.cd_pedido_sap_ajuste || String(r.cd_pedido_sap_ajuste).trim() === '';

  const { data, isLoading } = useQuery({
    queryKey: ['multiplos_depara'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prm_depara_pedido_multiplos_embarques')
        .select('*')
        .order('cd_pedido_sap');
      if (error) throw error;
      return data as any[];
    },
  });

  // Identificar novos: apaga todos os pendentes (sem pedido ajustado) e reinsere do zero,
  // preservando as linhas que já têm o Pedido SAP ajustado preenchido.
  const alimentar = useMutation({
    mutationFn: async () => {
      const del = await supabase
        .from('prm_depara_pedido_multiplos_embarques')
        .delete()
        .or('cd_pedido_sap_ajuste.is.null,cd_pedido_sap_ajuste.eq.');
      if (del.error) throw del.error;
      const { data, error } = await supabase.rpc('fn_alimentar_depara_multiplos_embarques');
      if (error) throw error;
      registraLog('Comex - Multiplos Embarques - Recriar Pendentes', 0, '', `${data} inseridos`);
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(`Pendentes recriados: ${n} pedido(s) com múltiplos embarques.`);
      qc.invalidateQueries({ queryKey: ['multiplos_depara'] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!selecionada) throw new Error('Selecione uma linha.');
      const { error } = await supabase
        .from('prm_depara_pedido_multiplos_embarques')
        .update({ cd_pedido_sap_ajuste: pedidoAjuste })
        .eq('codigo', selecionada.codigo);
      if (error) throw error;
      registraLog('Comex - Multiplos Embarques - Ajuste', selecionada.codigo, selecionada.cd_pedido_sap_ajuste ?? '', pedidoAjuste, 'cd_pedido_sap_ajuste');
    },
    onSuccess: () => {
      toast.success('De-para atualizado.');
      setSelecionada(null);
      setPedidoAjuste('');
      qc.invalidateQueries({ queryKey: ['multiplos_depara'] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const exportarPendentes = async () => {
    const { data: pend, error } = await supabase.from('vw_multiplos_embarques_pendentes').select('*');
    if (error) {
      toast.error(error.message);
      return;
    }
    exportarExcel(
      [
        { key: 'cd_pedido_sap', titulo: 'Pedido SAP' }, { key: 'cd_material_pai', titulo: 'Material Pai' },
        { key: 'cd_pedido_sap_ajuste', titulo: 'Pedido Ajuste' }, { key: 'cd_embarque', titulo: 'Embarque' },
        { key: 'dc_status_comex', titulo: 'Status Comex' }, { key: 'rec_fup', titulo: 'Rec FUP' },
        { key: 'qtde_fup', titulo: 'Qtde FUP' }, { key: 'dc_comprador', titulo: 'Comprador' },
        { key: 'rec_compra', titulo: 'Rec Compra' },
      ],
      pend ?? [],
      `SysPlan_MultiplosEmbarques_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    );
    registraLog('Comex - Multiplos Embarques - Exportacao');
  };

  const colunas: Coluna<any>[] = [
    { key: 'codigo', titulo: 'Código' },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP Original' },
    { key: 'cd_material_pai', titulo: 'Material Pai' },
    { key: 'cd_embarque', titulo: 'Embarque' },
    {
      key: 'cd_pedido_sap_ajuste',
      titulo: 'Pedido Ajustado',
      render: (r) => (ehPendente(r) ? <span className="text-destructive">— pendente —</span> : r.cd_pedido_sap_ajuste),
    },
  ];

  const totalPendentes = useMemo(() => (data ?? []).filter(ehPendente).length, [data]);
  const filtrados = useMemo(
    () => (soPendentes ? (data ?? []).filter(ehPendente) : data ?? []),
    [data, soPendentes],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Múltiplos Embarques</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos SAP com mais de um embarque — informe o pedido ajustado por embarque
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="mr-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
            Somente pendentes ({totalPendentes})
          </label>
          {editavel && (
            <Button
              variant="secondary"
              loading={alimentar.isPending}
              onClick={async () => {
                if (await confirmar({ titulo: 'Identificar novos', mensagem: 'Isto apaga todos os pendentes (sem Pedido Ajustado) e reidentifica do zero. As linhas já ajustadas são preservadas. Continuar?', variante: 'destructive', textoConfirmar: 'Reidentificar' })) {
                  alimentar.mutate();
                }
              }}
            >
              <PlayCircle /> Identificar novos
            </Button>
          )}
          <Button variant="outline" onClick={exportarPendentes}>
            <FileDown /> Pendentes de abertura
          </Button>
        </div>
      </div>

      {editavel && selecionada && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-3">
            <div><Label>Linha</Label><Input value={selecionada.codigo} disabled className="w-24" /></div>
            <div><Label>Pedido Original</Label><Input value={selecionada.cd_pedido_sap ?? ''} disabled className="w-40" /></div>
            <div><Label>Embarque</Label><Input value={selecionada.cd_embarque ?? ''} disabled className="w-40" /></div>
            <div>
              <Label>Pedido SAP Ajustado</Label>
              <SearchInput value={pedidoAjuste} onChange={(e) => setPedidoAjuste(e.target.value)} onClear={() => setPedidoAjuste('')} className="w-48" />
            </div>
            <Button loading={salvar.isPending} onClick={() => salvar.mutate()}>
              <Save /> Salvar
            </Button>
          </CardContent>
        </Card>
      )}

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.codigo}
        autofiltro
        onRowClick={(r) => {
          setSelecionada(r);
          setPedidoAjuste(r.cd_pedido_sap_ajuste ?? '');
        }}
      />
    </div>
  );
}
