import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { GRUPO_GERAL, useCombos, useEssentials, useGrupos } from '@/services/combos';
import { calcLeadTime, calcMargem, defineTamanhoProduto, labelsInfo, validaCompra, type ParametroCusto } from '@/lib/regras';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { formatDate, formatNumber, formatPercent } from '@/lib/utils';
import type { Compra } from '@/types';
import { FotoProduto } from './FotoProduto';

const VAZIA: Partial<Compra> = {
  dc_status: 'ABERTO',
  nr_fob_negociado: 0,
  nr_quantidade: 0,
  nr_preco_varejo: 0,
  nr_total_fob: 0,
};

export function EdicaoCompra({
  cdCompra,
  onFechar,
}: {
  cdCompra: number;
  onFechar: (salvou: boolean) => void;
}) {
  const { registraLog } = useAuth();
  const [form, setForm] = useState<Partial<Compra>>(VAZIA);
  const [salvando, setSalvando] = useState(false);
  const novo = cdCompra === 0;

  const { data: grupos } = useGrupos();
  const { opcoes } = useCombos();
  const { data: essentials } = useEssentials();

  const cdGrupo = useMemo(
    () => grupos?.find((g) => g.dc_grupo === form.dc_grupo)?.cd_grupo ?? GRUPO_GERAL,
    [grupos, form.dc_grupo],
  );

  // Carrega registro existente
  useEffect(() => {
    if (novo) return;
    supabase
      .from('controle_compras')
      .select('*')
      .eq('cd_compra', cdCompra)
      .single()
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          onFechar(false);
          return;
        }
        setForm(data as Compra);
      });
  }, [cdCompra]);

  // Libera o lock ao fechar
  useEffect(() => {
    return () => {
      if (!novo) {
        supabase.rpc('fn_bloquear_compra', { p_cd_compra: cdCompra, p_bloquear: false }).then(() => {});
      }
    };
  }, [cdCompra]);

  // FOB SAP (média ponderada do pedido no extrator)
  const { data: fobSap } = useQuery({
    queryKey: ['fob_sap', form.cd_pedido_sap, form.cd_material_pai],
    enabled: !!form.cd_pedido_sap && !!form.cd_material_pai,
    queryFn: async () => {
      const { data } = await supabase
        .from('vw_fob_sap')
        .select('fob_sap')
        .eq('cd_pedido_sap', form.cd_pedido_sap!)
        .eq('cd_material_pai', form.cd_material_pai!)
        .maybeSingle();
      return (data?.fob_sap as number) ?? null;
    },
  });

  // Cores do pedido SAP
  const { data: coresSap } = useQuery({
    queryKey: ['cores_sap', form.cd_pedido_sap, form.cd_material_pai],
    enabled: !!form.cd_pedido_sap && !!form.cd_material_pai,
    queryFn: async () => {
      const { data } = await supabase
        .from('ext_pedido_sap')
        .select('cd_material, dc_cor_lente_solar, dc_cor_armacao')
        .eq('cd_pedido_sap', form.cd_pedido_sap!)
        .eq('cd_material_pai', form.cd_material_pai!);
      return data ?? [];
    },
  });

  // Status Comex consolidado
  const { data: fupGeral } = useQuery({
    queryKey: ['fup_geral', cdCompra],
    enabled: !novo,
    queryFn: async () => {
      const { data } = await supabase
        .from('vw_resumo_fup_geral')
        .select('*')
        .eq('cd_compra', cdCompra)
        .maybeSingle();
      return data;
    },
  });

  // Parâmetro de custo do período para margem
  const anoMesRec = form.dt_recebimento ? Number(form.dt_recebimento.slice(0, 7).replace('-', '')) : null;
  const { data: paramCusto } = useQuery({
    queryKey: ['param_custo', form.dc_canal, form.dc_grupo, form.dc_modal, anoMesRec],
    enabled: !!form.dc_canal && !!form.dc_grupo && !!form.dc_modal && !!anoMesRec,
    queryFn: async () => {
      const { data } = await supabase
        .from('prm_definicao_custo')
        .select('nr_dolar, nr_fator_imp, nr_markup, nr_valor_agregado')
        .eq('dc_canal', form.dc_canal!)
        .eq('dc_grupo', form.dc_grupo!)
        .eq('dc_modal', form.dc_modal!)
        .eq('nr_anomes', anoMesRec!)
        .maybeSingle();
      return (data as ParametroCusto) ?? null;
    },
  });

  // Grupo de planejamento automático
  useEffect(() => {
    if (!form.dc_grupo || !form.dc_subgrupo || !form.dc_sexo || !form.dc_formato) return;
    supabase
      .from('prm_grupo_planejamento')
      .select('dc_grupo_planejamento')
      .eq('dc_grupo', form.dc_grupo)
      .eq('dc_subgrupo', form.dc_subgrupo)
      .eq('dc_sexo', form.dc_sexo)
      .eq('dc_formato', form.dc_formato)
      .maybeSingle()
      .then(({ data }) => {
        set('dc_grupo_planejamento', data?.dc_grupo_planejamento ?? '');
      });
  }, [form.dc_grupo, form.dc_subgrupo, form.dc_sexo, form.dc_formato]);

  const set = (campo: keyof Compra, valor: unknown) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const fobCalc = fobSap && fobSap > 0 ? fobSap : form.nr_fob_negociado ?? 0;
  const leadTime = calcLeadTime(form.dt_recebimento ?? null, form.dt_revised_delivery ?? null);
  const margem = calcMargem(fobCalc, form.nr_preco_varejo ?? 0, paramCusto ?? null);
  const tamanho = defineTamanhoProduto(form.dc_grupo ?? '', form.dc_medidas ?? '', form.dc_sexo ?? '');
  const infos = labelsInfo(form.dc_grupo ?? '');

  const salvar = async () => {
    const erros = validaCompra({ ...form, nr_lead_time: leadTime });
    if (erros.length > 0) {
      toast.error(erros[0]);
      return;
    }
    if (!confirm('Deseja salvar?')) return;
    setSalvando(true);
    const payload = {
      ...form,
      nr_margem: margem ?? 0,
      nr_fob_real: fobCalc,
      dc_tamanho: tamanho,
    };
    delete (payload as any).criado_em;
    delete (payload as any).atualizado_em;
    let error;
    if (novo) {
      delete (payload as any).cd_compra;
      ({ error } = await supabase.from('controle_compras').insert(payload));
    } else {
      ({ error } = await supabase.from('controle_compras').update(payload).eq('cd_compra', cdCompra));
    }
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Alterações salvas com sucesso!');
    onFechar(true);
  };

  const buscarEssential = async () => {
    const porMaterial = form.cd_material_pai
      ? await supabase.from('depara_essential').select('cd_essential').eq('cd_material_pai', form.cd_material_pai).limit(1).maybeSingle()
      : { data: null };
    const porRef = form.cd_material_fornecedor
      ? await supabase.from('depara_essential').select('cd_essential').eq('cd_ref_exportador', form.cd_material_fornecedor).limit(1).maybeSingle()
      : { data: null };
    const achado = Number(porMaterial.data?.cd_essential) || Number(porRef.data?.cd_essential) || 0;
    if (achado > 0) {
      set('cd_essential', achado);
      toast.success('Essential encontrado');
    } else {
      toast.info('Essential não encontrado');
    }
  };

  const CampoCombo = ({
    campo, label, tipo, grupoCombo,
  }: { campo: keyof Compra; label: string; tipo: string; grupoCombo?: number }) => (
    <div>
      <Label>{label}</Label>
      <Select
        value={(form[campo] as string) ?? ''}
        onChange={(e) => set(campo, e.target.value)}
        placeholder=""
        options={opcoes(tipo, grupoCombo ?? GRUPO_GERAL)}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {novo ? 'Nova Compra' : `Edição de Compra — CD ${cdCompra}`}
            {fupGeral?.status_calc && <Badge variant="secondary">{fupGeral.status_calc}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CampoCombo campo="dc_status" label="Status" tipo="STATUS" />
          <CampoCombo campo="dc_canal" label="Canal" tipo="CANAL" />
          <div>
            <Label>Grupo</Label>
            <Select
              value={form.dc_grupo ?? ''}
              onChange={(e) => {
                setForm((f) => ({
                  ...f,
                  dc_grupo: e.target.value,
                  dc_subgrupo: '', dc_formato: '', dc_material1: '', dc_material2: '',
                  dc_atributo1: '', dc_atributo2: '', dc_modal: '',
                  dc_info1: '', dc_info2: '', dc_info3: '', dc_info4: '',
                }));
              }}
              placeholder=""
              options={(grupos ?? []).map((g) => g.dc_grupo)}
            />
          </div>
          <CampoCombo campo="dc_subgrupo" label="SubGrupo" tipo="SUB GRUPO" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_formato" label="Formato" tipo="FORMATO" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_sexo" label="Sexo" tipo="SEXO" />
          <CampoCombo campo="dc_segmentacao" label="Segmentação" tipo="SEGMENTACAO" />
          <div>
            <Label>Grupo Planejamento</Label>
            <Input value={form.dc_grupo_planejamento ?? ''} disabled />
          </div>
          <div>
            <Label>Linha</Label>
            <Select
              value={form.dc_linha ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, dc_linha: v, cd_essential: v === 'ESSENTIAL' ? f.cd_essential : 0 }));
              }}
              placeholder=""
              options={opcoes('LINHA')}
            />
          </div>
          <CampoCombo campo="dc_griffe" label="Griffe" tipo="GRIFFE" />
          <div className="col-span-2 flex items-end gap-1">
            <div className="flex-1">
              <Label>Essential</Label>
              <Select
                value={String(form.cd_essential ?? '')}
                onChange={(e) => set('cd_essential', Number(e.target.value) || 0)}
                disabled={form.dc_linha !== 'ESSENTIAL'}
                placeholder=""
              >
                {(essentials ?? []).map((es: any) => (
                  <option key={es.cd_essential} value={es.cd_essential}>
                    {es.cd_essential} - {es.dc_essential}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" size="icon" disabled={form.dc_linha !== 'ESSENTIAL'} onClick={buscarEssential} title="Buscar Essential por Material/Ref">
              <Search />
            </Button>
          </div>
          <CampoCombo campo="dc_material1" label="Material 1" tipo="MATERIAL 1" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_material2" label="Material 2" tipo="MATERIAL 2" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_atributo1" label="Atributo 1" tipo="ATRIBUTO 1" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_atributo2" label="Atributo 2" tipo="ATRIBUTO 2" grupoCombo={cdGrupo} />
          <div>
            <Label>Medidas</Label>
            <Input value={form.dc_medidas ?? ''} onChange={(e) => set('dc_medidas', e.target.value)} />
          </div>
          <div>
            <Label>Tamanho (auto)</Label>
            <Input value={tamanho} disabled />
          </div>
          {infos.map((lbl, i) => {
            const campo = `dc_info${i + 1}` as keyof Compra;
            const tipoCombo = `INFO ${i + 1}`;
            return i < 4 ? (
              <div key={campo}>
                <Label>{lbl}</Label>
                <Select
                  value={(form[campo] as string) ?? ''}
                  onChange={(e) => set(campo, e.target.value)}
                  placeholder=""
                  options={opcoes(tipoCombo, cdGrupo)}
                />
              </div>
            ) : (
              <div key={campo}>
                <Label>{lbl}</Label>
                <Input value={(form[campo] as string) ?? ''} onChange={(e) => set(campo, e.target.value)} />
              </div>
            );
          })}
          <CampoCombo campo="dc_fornecedor" label="Fornecedor" tipo="FORNECEDOR" />
          <div>
            <Label>Ref. Fornecedor</Label>
            <Input value={form.cd_material_fornecedor ?? ''} onChange={(e) => set('cd_material_fornecedor', e.target.value)} />
          </div>
          <div>
            <Label>Material Pai</Label>
            <Input value={form.cd_material_pai ?? ''} onChange={(e) => set('cd_material_pai', e.target.value)} />
          </div>
          <div>
            <Label>PI (Pedido Fornecedor)</Label>
            <Input value={form.cd_pedido_fornecedor ?? ''} onChange={(e) => set('cd_pedido_fornecedor', e.target.value)} />
          </div>
          <div>
            <Label>Pedido SAP</Label>
            <Input value={form.cd_pedido_sap ?? ''} onChange={(e) => set('cd_pedido_sap', e.target.value)} />
          </div>
          <CampoCombo campo="dc_modal" label="Modal" tipo="MODAL" grupoCombo={cdGrupo} />
          <CampoCombo campo="dc_fup_produto" label="FUP Produto" tipo="FUP PRODUTO" />
          <div>
            <Label>Aprovação Cor</Label>
            <Select value={form.dc_aprovacao_cor ?? ''} onChange={(e) => set('dc_aprovacao_cor', e.target.value)} placeholder="" options={['SIM', 'NAO', 'PENDENTE']} />
          </div>
          <div>
            <Label>Quantidade</Label>
            <Input type="number" value={form.nr_quantidade ?? 0} onChange={(e) => set('nr_quantidade', Number(e.target.value))} />
          </div>
          <div>
            <Label>FOB Negociado</Label>
            <Input type="number" step="0.01" value={form.nr_fob_negociado ?? 0} onChange={(e) => set('nr_fob_negociado', Number(e.target.value))} />
          </div>
          <div>
            <Label>Total FOB</Label>
            <Input
              type="number" step="0.01"
              value={form.nr_total_fob ?? 0}
              onChange={(e) => {
                const total = Number(e.target.value);
                setForm((f) => ({
                  ...f,
                  nr_total_fob: total,
                  nr_fob_negociado:
                    total > 0 && (f.nr_quantidade ?? 0) > 0 ? total / (f.nr_quantidade ?? 1) : f.nr_fob_negociado,
                }));
              }}
            />
          </div>
          <div>
            <Label>FOB SAP (calc)</Label>
            <Input value={formatNumber(fobCalc)} disabled />
          </div>
          <div>
            <Label>Preço Varejo</Label>
            <Input type="number" step="0.01" value={form.nr_preco_varejo ?? 0} onChange={(e) => set('nr_preco_varejo', Number(e.target.value))} />
          </div>
          <div>
            <Label>Margem (calc)</Label>
            <Input value={formatPercent(margem)} disabled />
          </div>
          <div>
            <Label>Recebimento</Label>
            <Input type="date" value={form.dt_recebimento ?? ''} onChange={(e) => set('dt_recebimento', e.target.value || null)} />
          </div>
          <div>
            <Label>Delivery</Label>
            <Input type="date" value={form.dt_delivery ?? ''} onChange={(e) => set('dt_delivery', e.target.value || null)} />
          </div>
          <div>
            <Label>Revised Delivery</Label>
            <Input type="date" value={form.dt_revised_delivery ?? ''} onChange={(e) => set('dt_revised_delivery', e.target.value || null)} />
          </div>
          <div>
            <Label>Lead Time (dias)</Label>
            <Input value={leadTime ?? ''} disabled />
          </div>
          <div className="col-span-2 md:col-span-4">
            <Label>Observação</Label>
            <Textarea value={form.dc_observacao ?? ''} onChange={(e) => set('dc_observacao', e.target.value)} />
          </div>
        </div>

        {!novo && (
          <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 p-3 md:grid-cols-2">
            <div className="text-sm">
              <p className="mb-1 font-medium">Follow-up Comex</p>
              <p className="text-muted-foreground">
                Processo: <b>{fupGeral?.processo_calc || '—'}</b> · Entrega origem:{' '}
                <b>{formatDate(fupGeral?.entrega_calc)}</b> · Embarque:{' '}
                <b>{formatDate(fupGeral?.embarque_calc ?? fupGeral?.prev_embarque_calc)}</b> · Atraque:{' '}
                <b>{formatDate(fupGeral?.atraque_calc ?? fupGeral?.prev_atraque_calc)}</b>
              </p>
            </div>
            <div className="text-sm">
              <p className="mb-1 font-medium">Cores do Pedido SAP</p>
              {coresSap && coresSap.length > 0 ? (
                <div className="max-h-24 overflow-y-auto scrollbar-thin">
                  {coresSap.map((c: any) => (
                    <p key={c.cd_material} className="text-muted-foreground">
                      {c.cd_material} — {c.dc_cor_lente_solar ?? ''} / {c.dc_cor_armacao ?? ''}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Sem SKUs no extrator SAP.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)}>Fechar</Button>
          <Button onClick={salvar} loading={salvando}>Salvar</Button>
        </DialogFooter>

        <FotoProduto refFornecedor={form.cd_material_fornecedor ?? null} />
      </DialogContent>
    </Dialog>
  );
}
