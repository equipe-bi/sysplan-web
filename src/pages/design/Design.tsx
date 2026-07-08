import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCombos } from '@/services/combos';
import { formatDate } from '@/lib/utils';

const CAMPOS_DATA: [string, string][] = [
  ['dt_escolha_modelagem', 'Escolha modelagem'],
  ['dt_desenv_aprov_caito', 'Aprovação Caito'],
  ['dt_desenvolv_envio_fornecedor', 'Envio fornecedor'],
  ['dt_desenvolv_envio_licenciamento', 'Envio licenciamento'],
  ['dt_desenho_tecnico_aprovacao', 'Desenho técnico aprovado'],
  ['dt_prototipo_aprovacao', 'Protótipo aprovado'],
  ['dt_prototipo_aprovacao_caito', 'Protótipo aprovado Caito'],
  ['dt_lente_acetato_aprovacao', 'Lente/acetato aprovado'],
];

export default function Design() {
  const { podeEditar } = useAuth();
  const editavel = podeEditar('design');
  const qc = useQueryClient();
  const { opcoes } = useCombos();
  const [edicao, setEdicao] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['design'],
    queryFn: async () => {
      const { data, error } = await supabase.from('desenvolvimento_design').select('*').order('cd_desenvolv', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = { ...edicao };
      const cd = payload.cd_desenvolv;
      delete payload.cd_desenvolv;
      if (cd) {
        const { error } = await supabase.from('desenvolvimento_design').update(payload).eq('cd_desenvolv', cd);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('desenvolvimento_design').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Registro salvo.');
      setEdicao(null);
      qc.invalidateQueries({ queryKey: ['design'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    { key: 'cd_desenvolv', titulo: 'CD' },
    { key: 'cd_compra', titulo: 'Compra' },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'cd_codigo1', titulo: 'Código 1' },
    { key: 'cd_codigo2', titulo: 'Código 2' },
    { key: 'dc_desenvolv_status', titulo: 'Status' },
    ...CAMPOS_DATA.slice(0, 4).map(([k, t]) => ({ key: k, titulo: t, render: (r: any) => formatDate(r[k]) })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Desenvolvimento Design</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de desenvolvimento de produto</p>
        </div>
        {editavel && (
          <Button onClick={() => setEdicao({})}><Plus /> Novo desenvolvimento</Button>
        )}
      </div>

      <DataTable
        colunas={colunas}
        dados={data ?? []}
        carregando={isLoading}
        rowKey={(r) => r.cd_desenvolv}
        onRowDoubleClick={(r) => editavel && setEdicao(r)}
      />

      {edicao && (
        <Dialog open onOpenChange={(o) => !o && setEdicao(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{edicao.cd_desenvolv ? `Desenvolvimento ${edicao.cd_desenvolv}` : 'Novo desenvolvimento'}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <Label>CD Compra</Label>
                <Input value={edicao.cd_compra ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_compra: Number(e.target.value) || null })} />
              </div>
              <div>
                <Label>Fornecedor</Label>
                <Select value={edicao.dc_fornecedor ?? ''} onChange={(e) => setEdicao({ ...edicao, dc_fornecedor: e.target.value })} placeholder="" options={opcoes('FORNECEDOR')} />
              </div>
              <div>
                <Label>Status</Label>
                <Input value={edicao.dc_desenvolv_status ?? ''} onChange={(e) => setEdicao({ ...edicao, dc_desenvolv_status: e.target.value })} />
              </div>
              <div>
                <Label>Código 1</Label>
                <Input value={edicao.cd_codigo1 ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_codigo1: e.target.value })} />
              </div>
              <div>
                <Label>Código 2</Label>
                <Input value={edicao.cd_codigo2 ?? ''} onChange={(e) => setEdicao({ ...edicao, cd_codigo2: e.target.value })} />
              </div>
              {CAMPOS_DATA.map(([k, t]) => (
                <div key={k}>
                  <Label>{t}</Label>
                  <Input type="date" value={edicao[k] ?? ''} onChange={(e) => setEdicao({ ...edicao, [k]: e.target.value || null })} />
                </div>
              ))}
              <div className="col-span-2 md:col-span-3">
                <Label>Observação</Label>
                <Textarea value={edicao.dc_desenvolv_obs ?? ''} onChange={(e) => setEdicao({ ...edicao, dc_desenvolv_obs: e.target.value })} />
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
