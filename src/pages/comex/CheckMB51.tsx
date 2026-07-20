import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { confirmar } from '@/components/ui/confirm';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { formatDate, formatNumber } from '@/lib/utils';

/**
 * Divergências MB51 x Controle de Compras (porta o script Python de conferência).
 * Cruza por Pedido SAP e classifica: apenas MB51, apenas Controle (meses passados),
 * material diferente, recebido em outro mês, recebimento futuro, duplicados.
 * As correções são aplicadas direto no Controle de Compras (com log).
 */

const CORES: Record<string, 'destructive' | 'secondary' | 'default' | 'outline'> = {
  'Pedido existe apenas no MB51': 'destructive',
  'Pedido existe apenas no Controle': 'destructive',
  'Material diferente': 'secondary',
  'Recebido em outro mês': 'secondary',
  'Material e mês divergentes': 'destructive',
  'Recebimento futuro': 'outline',
};

interface LinhaCheck {
  cd_pedido_sap: string;
  material_mb51: string | null;
  material_controle: string | null;
  dt_mb51: string | null;
  dt_controle: string | null;
  cd_compra: number | null;
  dc_canal: string | null;
  dc_grupo: string | null;
  status: string;
}

export function CheckMB51({ editavel }: { editavel: boolean }) {
  const { registraLog } = useAuth();
  const qc = useQueryClient();
  const [statusSel, setStatusSel] = useState('');
  const [alterar, setAlterar] = useState<LinhaCheck | null>(null);
  const [campoAlterar, setCampoAlterar] = useState('dt_recebimento');
  const [valorAlterar, setValorAlterar] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['check_mb51'],
    queryFn: async () => {
      const linhas: LinhaCheck[] = [];
      let offset = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from('vw_check_mb51')
          .select('*')
          .neq('status', 'OK')
          .range(offset, offset + 999);
        if (error) throw error;
        linhas.push(...((page ?? []) as LinhaCheck[]));
        if (!page || page.length < 1000) break;
        offset += 1000;
      }
      return linhas;
    },
  });

  const { data: duplicados } = useQuery({
    queryKey: ['check_mb51_dup'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vw_check_mb51_duplicados').select('*').limit(2000);
      if (error) throw error;
      return data as { cd_pedido_sap: string; quantidade: number }[];
    },
  });

  const resumo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filtrados = useMemo(
    () => (statusSel ? (data ?? []).filter((r) => r.status === statusSel) : data ?? []),
    [data, statusSel],
  );

  const excluir = useMutation({
    mutationFn: async (row: LinhaCheck) => {
      if (!row.cd_compra) throw new Error('Linha sem CD de compra.');
      const { error } = await supabase
        .from('controle_compras')
        .update({ dc_status: 'EXCLUIDO' })
        .eq('cd_compra', row.cd_compra);
      if (error) throw error;
      registraLog('CheckMB51 - Excluir Registro', row.cd_compra);
    },
    onSuccess: () => {
      toast.success('Registro marcado como EXCLUIDO (permanece na tabela, fora das listas).');
      qc.invalidateQueries({ queryKey: ['check_mb51'] });
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const aplicarAlteracao = useMutation({
    mutationFn: async () => {
      if (!alterar?.cd_compra) throw new Error('Linha sem CD de compra.');
      if (!valorAlterar) throw new Error('Informe o novo valor.');
      if (campoAlterar === 'dt_recebimento') {
        // Recebimento passado é travado no banco; o Check usa a função autorizada
        const { error } = await supabase.rpc('fn_corrigir_recebimento', {
          p_cd_compra: alterar.cd_compra,
          p_data: valorAlterar,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('controle_compras')
          .update({ [campoAlterar]: valorAlterar })
          .eq('cd_compra', alterar.cd_compra);
        if (error) throw error;
      }
      registraLog('CheckMB51 - Alterar Registro', alterar.cd_compra, '', valorAlterar, campoAlterar);
    },
    onSuccess: () => {
      toast.success('Registro atualizado.');
      setAlterar(null);
      qc.invalidateQueries({ queryKey: ['check_mb51'] });
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const abrirAlterar = (row: LinhaCheck) => {
    setAlterar(row);
    // sugestão de correção conforme a divergência
    if (row.status === 'Recebido em outro mês' || row.status === 'Recebimento futuro') {
      setCampoAlterar('dt_recebimento');
      setValorAlterar(row.dt_mb51 ?? '');
    } else if (row.status === 'Material diferente' || row.status === 'Material e mês divergentes') {
      setCampoAlterar('cd_material_pai');
      setValorAlterar(row.material_mb51 ?? '');
    } else {
      setCampoAlterar('dt_recebimento');
      setValorAlterar(row.dt_mb51 ?? '');
    }
  };

  const colunas: Coluna<LinhaCheck>[] = [
    { key: 'status', titulo: 'Status', render: (r) => <Badge variant={CORES[r.status] ?? 'secondary'}>{r.status}</Badge> },
    { key: 'cd_pedido_sap', titulo: 'Pedido SAP' },
    { key: 'cd_compra', titulo: 'CD Compra' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_grupo', titulo: 'Grupo' },
    { key: 'material_mb51', titulo: 'Material MB51' },
    { key: 'material_controle', titulo: 'Material Controle' },
    { key: 'dt_mb51', titulo: 'Data MB51', render: (r) => formatDate(r.dt_mb51) },
    { key: 'dt_controle', titulo: 'Data Controle', render: (r) => formatDate(r.dt_controle) },
    ...(editavel
      ? [{
          key: '__acoes',
          titulo: 'Ações',
          ordenavel: false,
          render: (r: LinhaCheck) =>
            r.cd_compra ? (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); abrirAlterar(r); }}>
                  <Pencil className="h-3 w-3" /> Alterar para
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmar({ titulo: 'Excluir registro', mensagem: `O registro ${r.cd_compra} será marcado como EXCLUIDO (não é apagado da tabela). Continuar?`, variante: 'destructive', textoConfirmar: 'Excluir' })) excluir.mutate(r);
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Excluir
                </Button>
              </div>
            ) : null,
        } as Coluna<LinhaCheck>]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {resumo.map(([s, n]) => (
          <button key={s} onClick={() => setStatusSel(statusSel === s ? '' : s)}>
            <Badge variant={statusSel === s ? 'default' : CORES[s] ?? 'secondary'} className="cursor-pointer px-3 py-1">
              {s}: {formatNumber(n, 0)}
            </Badge>
          </button>
        ))}
        {(duplicados?.length ?? 0) > 0 && (
          <Badge variant="outline" className="px-3 py-1">Pedidos duplicados: {duplicados!.length}</Badge>
        )}
        <Button
          variant="outline" size="sm" className="ml-auto"
          onClick={() => exportarExcel(colunas.filter((c) => c.key !== '__acoes').map((c) => ({ key: c.key, titulo: c.titulo })), filtrados, 'SysPlan_Divergencias_MB51')}
        >
          <FileDown /> Exportar
        </Button>
      </div>

      {(data ?? []).length === 0 && !isLoading && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma divergência encontrada. Importe o MB51 atualizado (botão acima) para rodar a conferência.
          </CardContent>
        </Card>
      )}

      <DataTable colunas={colunas} dados={filtrados} carregando={isLoading} rowKey={(r) => `${r.cd_pedido_sap}|${r.cd_compra}|${r.material_mb51}|${r.material_controle}`} paginacao={100} />

      {alterar && (
        <Dialog open onOpenChange={(o) => !o && setAlterar(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Alterar registro — CD {alterar.cd_compra}</DialogTitle>
              <DialogDescription>
                {alterar.status} · Pedido {alterar.cd_pedido_sap} · MB51: {alterar.material_mb51 ?? '—'} em {formatDate(alterar.dt_mb51)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Campo</Label>
                <Select value={campoAlterar} onChange={(e) => setCampoAlterar(e.target.value)}>
                  <option value="dt_recebimento">Data Recebimento</option>
                  <option value="cd_material_pai">Material Pai</option>
                  <option value="cd_pedido_sap">Pedido SAP</option>
                </Select>
              </div>
              <div>
                <Label>Alterar para</Label>
                <Input
                  type={campoAlterar === 'dt_recebimento' ? 'date' : 'text'}
                  value={valorAlterar}
                  onChange={(e) => setValorAlterar(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAlterar(null)}>Cancelar</Button>
              <Button loading={aplicarAlteracao.isPending} onClick={() => aplicarAlteracao.mutate()}>Aplicar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
