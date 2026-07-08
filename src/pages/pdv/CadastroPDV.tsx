import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';

export default function CadastroPDV() {
  const { podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('cadastro_pdv');
  const qc = useQueryClient();

  const [filtros, setFiltros] = useState({ canal: '', estado: '', cidade: '', bairro: '', franqueado: '', tipo: '', loja: '', sap: '', pendentes: true });
  const [vinculo, setVinculo] = useState<{ cd_sap: string; id_pdv: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pdv_lista'],
    queryFn: async () => {
      const [lojas, base, depara] = await Promise.all([
        supabase.from('pdv_cadastro_loja').select('*').limit(20000),
        supabase.from('pdv_base_cadastro').select('*').limit(20000),
        supabase.from('pdv_depara').select('*').limit(20000),
      ]);
      if (lojas.error) throw lojas.error;
      const basePorSap = new Map((base.data ?? []).map((b: any) => [b.cd_sap, b]));
      const deparaPorSap = new Map((depara.data ?? []).map((d: any) => [d.cd_sap, d.id_pdv]));
      return (lojas.data ?? []).map((l: any) => ({
        ...l,
        ...basePorSap.get(l.cd_sap),
        cd_sap: l.cd_sap,
        id_pdv: deparaPorSap.get(l.cd_sap) ?? null,
      }));
    },
  });

  const filtrados = useMemo(() => {
    let r = data ?? [];
    const contem = (v: any, f: string) => !f || String(v ?? '').toLowerCase().includes(f.toLowerCase());
    r = r.filter(
      (x: any) =>
        contem(x.dc_canal, filtros.canal) && contem(x.dc_estado, filtros.estado) &&
        contem(x.dc_cidade, filtros.cidade) && contem(x.dc_bairro, filtros.bairro) &&
        contem(x.dc_franqueado, filtros.franqueado) && contem(x.dc_grupo_loja, filtros.tipo) &&
        contem(x.dc_loja, filtros.loja) && contem(x.cd_sap, filtros.sap),
    );
    if (filtros.pendentes) r = r.filter((x: any) => x.id_pdv == null);
    return r;
  }, [data, filtros]);

  const vincular = useMutation({
    mutationFn: async () => {
      if (!vinculo?.cd_sap || !vinculo.id_pdv) throw new Error('Campos não preenchidos!');
      const { data: pdvExiste } = await supabase.from('pdv_cadastro_pdv').select('id_pdv').eq('id_pdv', Number(vinculo.id_pdv)).maybeSingle();
      if (!pdvExiste) throw new Error('PDV não existe!');
      const { data: jaVinculado } = await supabase.from('pdv_depara').select('cd_sap').eq('cd_sap', vinculo.cd_sap).maybeSingle();
      if (jaVinculado) throw new Error('CD SAP já consta no De-Para!');
      const { error } = await supabase.from('pdv_depara').insert({ id_pdv: Number(vinculo.id_pdv), cd_sap: vinculo.cd_sap });
      if (error) throw error;
      registraLog('CadastroPDV - Vinculo', Number(vinculo.id_pdv), '', vinculo.cd_sap);
    },
    onSuccess: () => {
      toast.success('PDV salvo.');
      setVinculo(null);
      qc.invalidateQueries({ queryKey: ['pdv_lista'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const novoPdv = useMutation({
    mutationFn: async () => {
      if (!vinculo?.cd_sap) throw new Error('Campos não preenchidos!');
      const { data: jaVinculado } = await supabase.from('pdv_depara').select('cd_sap').eq('cd_sap', vinculo.cd_sap).maybeSingle();
      if (jaVinculado) throw new Error('CD SAP já consta no De-Para!');
      const { data: loja } = await supabase.from('pdv_cadastro_loja').select('*').eq('cd_sap', vinculo.cd_sap).single();
      if (!loja) throw new Error('Loja não encontrada.');
      const { data: novo, error } = await supabase
        .from('pdv_cadastro_pdv')
        .insert({
          cd_pdv: loja.cd_sap, dc_pdv: loja.dc_loja, dc_canal: loja.dc_canal,
          dc_tipo_pdv: loja.dc_grupo_loja, dc_franqueado: loja.dc_franqueado,
          dc_uf: loja.dc_uf, dc_estado: loja.dc_estado, dc_cidade: loja.dc_cidade, dc_bairro: loja.dc_bairro,
        })
        .select('id_pdv')
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase.from('pdv_depara').insert({ id_pdv: novo.id_pdv, cd_sap: vinculo.cd_sap });
      if (e2) throw e2;
      registraLog('CadastroPDV - Novo PDV', novo.id_pdv, '', vinculo.cd_sap);
      return novo.id_pdv;
    },
    onSuccess: (id) => {
      toast.success(`PDV cadastrado | Número: ${id}`);
      setVinculo(null);
      qc.invalidateQueries({ queryKey: ['pdv_lista'] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const colunas: Coluna<any>[] = [
    { key: 'cd_sap', titulo: 'CD SAP' },
    { key: 'id_pdv', titulo: 'ID PDV' },
    { key: 'dc_canal', titulo: 'Canal' },
    { key: 'dc_loja', titulo: 'Loja' },
    { key: 'dt_inicio_var', titulo: 'Início Var', render: (r) => formatDate(r.dt_inicio_var) },
    { key: 'dt_fim_var', titulo: 'Fim Var', render: (r) => formatDate(r.dt_fim_var) },
    { key: 'dc_franqueado', titulo: 'Franqueado' },
    { key: 'dc_grupo_loja', titulo: 'Tipo PDV' },
    { key: 'dc_estado', titulo: 'Estado' },
    { key: 'dc_cidade', titulo: 'Cidade' },
    { key: 'dc_bairro', titulo: 'Bairro' },
    { key: 'ultimo_movimento', titulo: 'Último Mov.', render: (r) => formatDate(r.ultimo_movimento) },
  ];

  const setF = (k: string, v: any) => setFiltros((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cadastro de PDV</h1>
        <p className="text-sm text-muted-foreground">
          Vínculo de lojas SAP a PDVs. Base atualizável via Administração → Importações.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          {(['canal', 'tipo', 'estado', 'cidade', 'bairro', 'franqueado', 'loja', 'sap'] as const).map((k) => (
            <div key={k} className="w-32">
              <Label className="capitalize">{k === 'sap' ? 'CD SAP' : k}</Label>
              <Input value={(filtros as any)[k]} onChange={(e) => setF(k, e.target.value)} />
            </div>
          ))}
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filtros.pendentes}
              onChange={(e) => setF('pendentes', e.target.checked)}
              className="h-4 w-4"
            />
            Somente pendentes de vínculo
          </label>
          <Button variant="ghost" onClick={() => setFiltros({ canal: '', estado: '', cidade: '', bairro: '', franqueado: '', tipo: '', loja: '', sap: '', pendentes: true })}>
            Limpar
          </Button>
        </CardContent>
      </Card>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.cd_sap}
        onRowDoubleClick={(r) => editavel && setVinculo({ cd_sap: r.cd_sap, id_pdv: r.id_pdv ? String(r.id_pdv) : '' })}
        rodape={<span className="ml-2">duplo clique para vincular</span>}
      />

      {vinculo && (
        <Dialog open onOpenChange={(o) => !o && setVinculo(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Vincular / Criar PDV</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CD SAP (loja)</Label>
                <Input value={vinculo.cd_sap} onChange={(e) => setVinculo({ ...vinculo, cd_sap: e.target.value })} />
              </div>
              <div>
                <Label>ID PDV existente</Label>
                <Input value={vinculo.id_pdv} onChange={(e) => setVinculo({ ...vinculo, id_pdv: e.target.value.replace(/\D/g, '') })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVinculo(null)}>Voltar</Button>
              <Button variant="secondary" loading={novoPdv.isPending} onClick={() => novoPdv.mutate()}>
                <PlusCircle /> Novo PDV a partir da loja
              </Button>
              <Button loading={vincular.isPending} onClick={() => vincular.mutate()}>
                <Link2 /> Vincular a PDV existente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
