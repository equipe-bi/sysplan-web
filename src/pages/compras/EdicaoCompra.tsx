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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { formatDate, formatNumber, formatPercent, hojeISO } from '@/lib/utils';
import { GRUPOS_RELOGIO, type Compra } from '@/types';
import { Bloco, CampoLinha, CTRL } from './Bloco';
import { FotoInline } from './FotoProduto';

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

  const [recebimentoOriginal, setRecebimentoOriginal] = useState<string | null>(null);
  // Recebimento já ocorrido (ontem para trás) é imutável fora do Check de Recebimento
  const recebimentoTravado = !novo && !!recebimentoOriginal && recebimentoOriginal < hojeISO();

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
        setRecebimentoOriginal((data as Compra).dt_recebimento ?? null);
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

  const Combo = ({ campo, label, tipo, grupoCombo }: { campo: keyof Compra; label: string; tipo: string; grupoCombo?: number }) => (
    <CampoLinha label={label}>
      <Select
        className={CTRL}
        value={(form[campo] as string) ?? ''}
        onChange={(e) => set(campo, e.target.value)}
        placeholder=""
        options={opcoes(tipo, grupoCombo ?? GRUPO_GERAL)}
      />
    </CampoLinha>
  );

  const Texto = ({ campo, label }: { campo: keyof Compra; label: string }) => (
    <CampoLinha label={label}>
      <Input className={CTRL} value={(form[campo] as string) ?? ''} onChange={(e) => set(campo, e.target.value)} />
    </CampoLinha>
  );

  const Numero = ({ campo, label }: { campo: keyof Compra; label: string }) => (
    <CampoLinha label={label}>
      <Input className={CTRL} type="number" step="0.01" value={(form[campo] as number) ?? 0} onChange={(e) => set(campo, Number(e.target.value))} />
    </CampoLinha>
  );

  const Data = ({ campo, label }: { campo: keyof Compra; label: string }) => (
    <CampoLinha label={label}>
      <Input className={CTRL} type="date" value={(form[campo] as string) ?? ''} onChange={(e) => set(campo, e.target.value || null)} />
    </CampoLinha>
  );

  const Fixo = ({ label, valor }: { label: string; valor: string | number | null | undefined }) => (
    <CampoLinha label={label}>
      <Input className={CTRL} value={String(valor ?? '')} disabled />
    </CampoLinha>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-[1340px] w-[97vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-base">
            {novo ? 'Nova Compra' : `Edição de Compra — CD ${cdCompra}`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {/* Coluna 1 */}
          <div className="space-y-2">
            <Bloco titulo="Classificação" cor="ambar">
              {Combo({ campo: 'dc_status', label: 'Status', tipo: 'STATUS' })}
              {Combo({ campo: 'dc_canal', label: 'Canal', tipo: 'CANAL' })}
              <CampoLinha label="Grupo">
                <Select
                  className={CTRL}
                  value={form.dc_grupo ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dc_grupo: e.target.value,
                      dc_subgrupo: '', dc_formato: '', dc_material1: '', dc_material2: '',
                      dc_atributo1: '', dc_atributo2: '', dc_modal: '',
                      dc_info1: '', dc_info2: '', dc_info3: '', dc_info4: '',
                    }))
                  }
                  placeholder=""
                  options={(grupos ?? []).map((g) => g.dc_grupo)}
                />
              </CampoLinha>
              {Combo({ campo: 'dc_subgrupo', label: 'Sub Grupo', tipo: 'SUB GRUPO', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_formato', label: 'Formato', tipo: 'FORMATO', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_sexo', label: 'Sexo', tipo: 'SEXO' })}
            </Bloco>
            <Bloco titulo="Produto" cor="ciano">
              {Fixo({ label: 'Grupo Plan', valor: form.dc_grupo_planejamento })}
              {Combo({ campo: 'dc_segmentacao', label: 'Segmentação', tipo: 'SEGMENTACAO' })}
              <CampoLinha label="Linha">
                <Select
                  className={CTRL}
                  value={form.dc_linha ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, dc_linha: v, cd_essential: v === 'ESSENTIAL' ? f.cd_essential : 0 }));
                  }}
                  placeholder=""
                  options={opcoes('LINHA')}
                />
              </CampoLinha>
              {Combo({ campo: 'dc_griffe', label: 'Griffe', tipo: 'GRIFFE' })}
              {Combo({ campo: 'dc_material1', label: 'Material 1', tipo: 'MATERIAL 1', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_material2', label: 'Material 2', tipo: 'MATERIAL 2', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_atributo1', label: 'Atributo 1', tipo: 'ATRIBUTO 1', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_atributo2', label: 'Atributo 2', tipo: 'ATRIBUTO 2', grupoCombo: cdGrupo })}
              <CampoLinha label="Medidas">
                <Input className={CTRL} value={form.dc_medidas ?? ''} onChange={(e) => set('dc_medidas', e.target.value)} />
              </CampoLinha>
              {Fixo({ label: 'Tamanho', valor: tamanho })}
            </Bloco>
          </div>

          {/* Coluna 2 */}
          <div className="space-y-2">
            <Bloco titulo="Valores" cor="violeta">
              {Numero({ campo: 'nr_quantidade', label: 'Quantidade' })}
              {Numero({ campo: 'nr_fob_negociado', label: 'Fob Negociado' })}
              <CampoLinha label="Total FOB">
                <Input
                  className={CTRL} type="number" step="0.01"
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
              </CampoLinha>
              {Fixo({ label: 'Fob SAP', valor: formatNumber(fobCalc) })}
              {Numero({ campo: 'nr_preco_varejo', label: 'Preço Varejo' })}
              {Fixo({ label: 'Margem', valor: formatPercent(margem) })}
            </Bloco>
            <Bloco titulo="Fornecedor" cor="verde">
              {Combo({ campo: 'dc_fornecedor', label: 'Fornecedor', tipo: 'FORNECEDOR' })}
              {Texto({ campo: 'cd_pedido_fornecedor', label: 'PI' })}
              {Texto({ campo: 'cd_material_fornecedor', label: 'Ref Fornecedor' })}
              {Texto({ campo: 'cd_pedido_sap', label: 'Pedido SAP' })}
              {Texto({ campo: 'cd_material_pai', label: 'Material Pai' })}
            </Bloco>
            {GRUPOS_RELOGIO.includes(form.dc_grupo ?? '') ? (
              <Bloco titulo="Relógios" cor="rosa">
                {/* Tipo Pulseira — combo TIPO PULSEIRA */}
                <CampoLinha label="Tipo Pulseira">
                  <Select className={CTRL} value={form.dc_tipo_pulseira ?? ''} onChange={(e) => set('dc_tipo_pulseira', e.target.value)} placeholder="" options={opcoes('TIPO PULSEIRA', cdGrupo)} />
                </CampoLinha>
                {/* Tipo Dial — combo TIPO DIAL */}
                <CampoLinha label="Tipo Dial">
                  <Select className={CTRL} value={form.dc_tipo_dial ?? ''} onChange={(e) => set('dc_tipo_dial', e.target.value)} placeholder="" options={opcoes('TIPO DIAL', cdGrupo)} />
                </CampoLinha>
                {/* Números — combo NUMEROS */}
                <CampoLinha label="Números">
                  <Select className={CTRL} value={form.dc_numeros ?? ''} onChange={(e) => set('dc_numeros', e.target.value)} placeholder="" options={opcoes('NUMEROS', cdGrupo)} />
                </CampoLinha>
                {/* Num Máquina — combo NUM MAQUINA */}
                <CampoLinha label="Num Máquina">
                  <Select className={CTRL} value={form.dc_num_maquina ?? ''} onChange={(e) => set('dc_num_maquina', e.target.value)} placeholder="" options={opcoes('NUM MAQUINA', cdGrupo)} />
                </CampoLinha>
                {/* Acabamento Caixa — combo ACABAMENTO CAIXA */}
                <CampoLinha label="Acab. Caixa">
                  <Select className={CTRL} value={form.dc_acabamento_caixa ?? ''} onChange={(e) => set('dc_acabamento_caixa', e.target.value)} placeholder="" options={opcoes('ACABAMENTO CAIXA', cdGrupo)} />
                </CampoLinha>
                {/* Tipo de Visor — combo TIPO VISOR */}
                <CampoLinha label="Tipo de Visor">
                  <Select className={CTRL} value={form.dc_tipo_visor ?? ''} onChange={(e) => set('dc_tipo_visor', e.target.value)} placeholder="" options={opcoes('TIPO VISOR', cdGrupo)} />
                </CampoLinha>
                {/* Montadora — combo MONTADORA */}
                <CampoLinha label="Montadora">
                  <Select className={CTRL} value={form.dc_montadora ?? ''} onChange={(e) => set('dc_montadora', e.target.value)} placeholder="" options={opcoes('MONTADORA', cdGrupo)} />
                </CampoLinha>
                {/* Campos livres */}
                <CampoLinha label="Código Compra">
                  <Input className={CTRL} value={form.cd_codigo_compra ?? ''} onChange={(e) => set('cd_codigo_compra', e.target.value)} />
                </CampoLinha>
                <CampoLinha label="Spare Parts">
                  <Input className={CTRL} value={form.cd_spare_parts ?? ''} onChange={(e) => set('cd_spare_parts', e.target.value)} />
                </CampoLinha>
                <CampoLinha label="Gaveta">
                  <Input className={CTRL} value={form.dc_gaveta ?? ''} onChange={(e) => set('dc_gaveta', e.target.value)} />
                </CampoLinha>
                <CampoLinha label="NF Seculus">
                  <Input className={CTRL} value={form.dc_nf_seculus ?? ''} onChange={(e) => set('dc_nf_seculus', e.target.value)} />
                </CampoLinha>
              </Bloco>
            ) : (
              <Bloco titulo="Infos" cor="rosa">
                {/* Info 7 foi unificado no campo Gaveta (comum a todos os grupos) */}
                {infos.slice(0, 6).map((lbl, i) => {
                  const campo = `dc_info${i + 1}` as keyof Compra;
                  return i < 4 ? (
                    <CampoLinha key={campo} label={lbl}>
                      <Select
                        className={CTRL}
                        value={(form[campo] as string) ?? ''}
                        onChange={(e) => set(campo, e.target.value)}
                        placeholder=""
                        options={opcoes(`INFO ${i + 1}`, cdGrupo)}
                      />
                    </CampoLinha>
                  ) : (
                    <CampoLinha key={campo} label={lbl}>
                      <Input className={CTRL} value={(form[campo] as string) ?? ''} onChange={(e) => set(campo, e.target.value)} />
                    </CampoLinha>
                  );
                })}
                <CampoLinha label="Gaveta">
                  <Input className={CTRL} value={form.dc_gaveta ?? ''} onChange={(e) => set('dc_gaveta', e.target.value)} />
                </CampoLinha>
              </Bloco>
            )}
          </div>

          {/* Coluna 3 */}
          <div className="space-y-2">
            <Bloco titulo="Datas / Logística" cor="marrom">
              {Data({ campo: 'dt_delivery', label: 'Delivery' })}
              {Data({ campo: 'dt_revised_delivery', label: 'Revised Deliv.' })}
              {Combo({ campo: 'dc_modal', label: 'Modal', tipo: 'MODAL', grupoCombo: cdGrupo })}
              {recebimentoTravado ? (
                <CampoLinha label="Recebimento">
                  <Input
                    className={CTRL}
                    value={formatDate(form.dt_recebimento)}
                    disabled
                    title="Recebimento já ocorrido — só pode ser corrigido na tela Checks de Recebimento"
                  />
                </CampoLinha>
              ) : (
                Data({ campo: 'dt_recebimento', label: 'Recebimento' })
              )}
              {Fixo({ label: 'Lead Time', valor: leadTime })}
            </Bloco>
            <Bloco titulo="Follow-up / Comex" cor="cinza">
              {Fixo({ label: 'Status Comex', valor: fupGeral?.status_calc ?? '' })}
              {Fixo({ label: 'Processo', valor: fupGeral?.processo_calc ?? '' })}
              {Fixo({ label: 'Embarque', valor: formatDate(fupGeral?.embarque_calc ?? fupGeral?.prev_embarque_calc) })}
              {Fixo({ label: 'Atraque', valor: formatDate(fupGeral?.atraque_calc ?? fupGeral?.prev_atraque_calc) })}
              {Combo({ campo: 'dc_fup_produto', label: 'FUP Produto', tipo: 'FUP PRODUTO' })}
            </Bloco>
            <Bloco titulo="Observações" cor="cinza">
              <Textarea
                className="min-h-[88px] text-xs"
                value={form.dc_observacao ?? ''}
                onChange={(e) => set('dc_observacao', e.target.value)}
              />
            </Bloco>
          </div>

          {/* Coluna 4: foto e cores */}
          <div className="space-y-2">
            <Bloco titulo="Foto" cor="cinza">
              <FotoInline refFornecedor={form.cd_material_fornecedor ?? null} altura={170} permitirUpload />
              <p className="truncate text-center text-[10px] text-muted-foreground">{form.cd_material_fornecedor}</p>
            </Bloco>
            <Bloco titulo="Cores (Pedido SAP)" cor="cinza">
              <div className="max-h-40 overflow-y-auto scrollbar-thin text-xs">
                {coresSap && coresSap.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-1 font-medium">SKU</th>
                        <th className="pr-1 font-medium">COR1</th>
                        <th className="font-medium">COR2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coresSap.map((c: any) => (
                        <tr key={c.cd_material}>
                          <td className="pr-1">{c.cd_material}</td>
                          <td className="pr-1">{c.dc_cor_lente_solar ?? ''}</td>
                          <td>{c.dc_cor_armacao ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="py-2 text-center text-muted-foreground">Sem SKUs no extrator SAP</p>
                )}
              </div>
            </Bloco>
          </div>
        </div>

        {/* Rodapé: Essential + Aprovação Cor + Salvar */}
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="flex min-w-72 flex-1 items-end gap-1">
            <div className="flex-1">
              <Label>Essential</Label>
              <Select
                className={CTRL}
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
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={form.dc_linha !== 'ESSENTIAL'} onClick={buscarEssential} title="Buscar Essential por Material/Ref">
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="w-40">
            <Label>Aprovação Cor</Label>
            <Select className={CTRL} value={form.dc_aprovacao_cor ?? ''} onChange={(e) => set('dc_aprovacao_cor', e.target.value)} placeholder="" options={['SIM', 'NAO', 'PENDENTE']} />
          </div>
          {fupGeral?.status_calc && <Badge variant="secondary">{fupGeral.status_calc}</Badge>}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => onFechar(false)}>Fechar</Button>
            <Button onClick={salvar} loading={salvando}>Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
