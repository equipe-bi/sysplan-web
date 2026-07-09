import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { exportarExcel } from '@/lib/exportar';
import { lerPlanilha } from '@/lib/exportar';
import { CheckMB51 } from './CheckMB51';

/**
 * Checks de recebimento (consultas de auditoria do legado) + importação MB51.
 * Views simples ficam no banco; os checks que dependem do MB51 usam a staging importada.
 */
const CHECKS = [
  { id: 'pi_duplicado', nome: 'PI Duplicado', view: 'vw_check_pi_duplicado' },
  { id: 'po_duplicado', nome: 'PO Duplicado', view: 'vw_check_po_duplicado' },
  { id: 'gp_nao_cadastrado', nome: 'GP não cadastrado', view: 'vw_check_gp_nao_cadastrado' },
  { id: 'multiplos_pendentes', nome: 'Múltiplos embarques pendentes', view: 'vw_multiplos_embarques_pendentes' },
];

export default function ChecksRecebimento() {
  const { usuario, podeEditar, registraLog } = useAuth();
  const [aba, setAba] = useState('mb51');
  const editavel = podeEditar('checks_recebimento');

  const consultas = CHECKS.map((c) =>
    useQuery({
      queryKey: ['check', c.id],
      queryFn: async () => {
        const { data, error } = await supabase.from(c.view).select('*').limit(5000);
        if (error) throw error;
        return data as any[];
      },
    }),
  );

  const importarMB51 = async (file: File) => {
    const linhas = await lerPlanilha(file);
    if (linhas.length === 0) {
      toast.error('Planilha vazia.');
      return;
    }
    const dt = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
    const registros = linhas.map((l) => ({
      material: l['Material'] != null ? String(l['Material']) : null,
      centro: l['Centro'] != null ? String(l['Centro']) : null,
      deposito: l['Depósito'] != null ? String(l['Depósito']) : null,
      tipo_movimento: l['Tipo de movimento'] != null ? String(l['Tipo de movimento']) : null,
      dt_lancamento: dt(l['Data de lançamento']),
      qtd_um_registro: Number(l['Qtd  UM registro'] ?? l['Qtd UM registro'] ?? 0) || 0,
      referencia: l['Referência'] != null ? String(l['Referência']) : null,
      fornecedor: l['Fornecedor'] != null ? String(l['Fornecedor']) : null,
      pedido: l['Pedido'] != null ? String(l['Pedido']) : null,
      texto_breve_material: l['Texto breve material'] != null ? String(l['Texto breve material']) : null,
    }));
    await supabase.from('stg_entrada_sap_mb51').delete().gte('id', 0);
    for (let i = 0; i < registros.length; i += 1000) {
      const { error } = await supabase.from('stg_entrada_sap_mb51').insert(registros.slice(i, i + 1000));
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    registraLog('Checks - Importacao MB51', 0, '', `${registros.length} linhas`);
    await supabase.from('importacoes').insert({
      usuario_id: usuario?.id, tipo: 'mb51', nome_arquivo: file.name,
      total_linhas: registros.length, linhas_validas: registros.length,
      status: 'aplicado', aplicado_em: new Date().toISOString(),
    });
    toast.success(`MB51 importado (${registros.length} linhas).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checks de Recebimento</h1>
          <p className="text-sm text-muted-foreground">Auditorias de consistência entre Sysplan, SAP e Comex</p>
        </div>
        {podeEditar('checks_recebimento') && (
          <>
            <Button variant="secondary" onClick={() => document.getElementById('imp-mb51')?.click()}>
              <FileUp /> Importar MB51 (entradas SAP)
            </Button>
            <input
              id="imp-mb51" type="file" accept=".xlsx,.xlsb,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importarMB51(f); e.target.value = ''; }}
            />
          </>
        )}
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="mb51">Divergências MB51</TabsTrigger>
          {CHECKS.map((c, i) => (
            <TabsTrigger key={c.id} value={c.id}>
              {c.nome} ({consultas[i].data?.length ?? '…'})
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="mb51">
          <CheckMB51 editavel={editavel} />
        </TabsContent>
        {CHECKS.map((c, i) => {
          const dados = consultas[i].data ?? [];
          const cols = dados.length > 0
            ? Object.keys(dados[0]).map((k) => ({ key: k, titulo: k }))
            : [{ key: 'x', titulo: '' }];
          return (
            <TabsContent key={c.id} value={c.id}>
              <div className="mb-2 flex justify-end">
                <Button
                  variant="outline" size="sm"
                  onClick={() => exportarExcel(cols, dados, `SysPlan_Check_${c.id}`)}
                >
                  <FileDown /> Exportar
                </Button>
              </div>
              <DataTable
                colunas={cols}
                dados={dados}
                carregando={consultas[i].isLoading}
                rowKey={(r) => JSON.stringify(r)}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
