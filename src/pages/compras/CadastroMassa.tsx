import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { GRUPO_GERAL, useCombos, useGrupos } from '@/services/combos';
import { defineTamanhoProduto } from '@/lib/regras';
import { Button } from '@/components/ui/button';
import { confirmar } from '@/components/ui/confirm';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Compra } from '@/types';
import { Bloco, CampoLinha, CTRL } from './Bloco';

/**
 * Cadastro em massa: cria N novas linhas na carteira com os valores
 * pré-selecionados (canal, grupo e demais campos da lista de compras).
 * Cada linha recebe um novo CD e entra com status ABERTO por padrão.
 */
export function CadastroMassa({ onFechar }: { onFechar: (criou: boolean) => void }) {
  const { registraLog } = useAuth();
  const { data: grupos } = useGrupos();
  const { opcoes } = useCombos();

  const [qtdLinhas, setQtdLinhas] = useState(1);
  const [form, setForm] = useState<Partial<Compra>>({
    dc_status: 'ABERTO',
    nr_fob_negociado: 0,
    nr_quantidade: 0,
    nr_preco_varejo: 0,
  });

  const cdGrupo = useMemo(
    () => grupos?.find((g) => g.dc_grupo === form.dc_grupo)?.cd_grupo ?? GRUPO_GERAL,
    [grupos, form.dc_grupo],
  );

  const set = (campo: keyof Compra, valor: unknown) => setForm((f) => ({ ...f, [campo]: valor }));

  // Grupo de planejamento automático (mesma regra da edição)
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
      .then(({ data }) => set('dc_grupo_planejamento', data?.dc_grupo_planejamento ?? ''));
  }, [form.dc_grupo, form.dc_subgrupo, form.dc_sexo, form.dc_formato]);

  const criar = useMutation({
    mutationFn: async () => {
      if (!qtdLinhas || qtdLinhas < 1 || qtdLinhas > 500) {
        throw new Error('Informe a quantidade de linhas (1 a 500).');
      }
      const payload: Record<string, any> = {
        ...form,
        dc_status: form.dc_status || 'ABERTO',
        dc_tamanho: defineTamanhoProduto(form.dc_grupo ?? '', form.dc_medidas ?? '', form.dc_sexo ?? ''),
      };
      delete payload.cd_compra;
      const linhas = Array.from({ length: qtdLinhas }, () => ({ ...payload }));
      const { data, error } = await supabase
        .from('controle_compras')
        .insert(linhas)
        .select('cd_compra');
      if (error) throw error;
      const cds = (data ?? []).map((r: any) => r.cd_compra).sort((a, b) => a - b);
      registraLog('EdicaoCompra - Cadastro em Massa', 0, '', `${cds.length} linhas: CD ${cds[0]} a ${cds[cds.length - 1]}`);
      return cds;
    },
    onSuccess: (cds) => {
      toast.success(`${cds.length} linha(s) criada(s) — CD ${cds[0]} até ${cds[cds.length - 1]}.`);
      onFechar(true);
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

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

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-[1100px] w-[95vw]">
        <DialogHeader>
          <DialogTitle>Cadastro em Massa</DialogTitle>
          <DialogDescription>
            Informe a quantidade de linhas e os valores comuns — cada linha recebe um novo CD.
            Os campos deixados em branco podem ser preenchidos depois na edição individual ou em massa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <Layers className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Quantidade de linhas a criar</span>
          <Input
            className="h-8 w-24"
            type="number"
            min={1}
            max={500}
            value={qtdLinhas}
            onChange={(e) => setQtdLinhas(Number(e.target.value))}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                    }))
                  }
                  placeholder=""
                  options={(grupos ?? []).map((g) => g.dc_grupo)}
                />
              </CampoLinha>
              {Combo({ campo: 'dc_subgrupo', label: 'Sub Grupo', tipo: 'SUB GRUPO', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_formato', label: 'Formato', tipo: 'FORMATO', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_sexo', label: 'Sexo', tipo: 'SEXO' })}
              <CampoLinha label="Grupo Plan">
                <Input className={CTRL} value={form.dc_grupo_planejamento ?? ''} disabled />
              </CampoLinha>
            </Bloco>
            <Bloco titulo="Produto" cor="ciano">
              {Combo({ campo: 'dc_segmentacao', label: 'Segmentação', tipo: 'SEGMENTACAO' })}
              {Combo({ campo: 'dc_linha', label: 'Linha', tipo: 'LINHA' })}
              {Combo({ campo: 'dc_griffe', label: 'Griffe', tipo: 'GRIFFE' })}
              {Combo({ campo: 'dc_material1', label: 'Material 1', tipo: 'MATERIAL 1', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_material2', label: 'Material 2', tipo: 'MATERIAL 2', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_atributo1', label: 'Atributo 1', tipo: 'ATRIBUTO 1', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_atributo2', label: 'Atributo 2', tipo: 'ATRIBUTO 2', grupoCombo: cdGrupo })}
              {Texto({ campo: 'dc_medidas', label: 'Medidas' })}
            </Bloco>
          </div>

          <div className="space-y-2">
            <Bloco titulo="Valores" cor="violeta">
              {Numero({ campo: 'nr_quantidade', label: 'Quantidade' })}
              {Numero({ campo: 'nr_fob_negociado', label: 'Fob Negociado' })}
              {Numero({ campo: 'nr_preco_varejo', label: 'Preço Varejo' })}
            </Bloco>
            <Bloco titulo="Fornecedor" cor="verde">
              {Combo({ campo: 'dc_fornecedor', label: 'Fornecedor', tipo: 'FORNECEDOR' })}
              {Texto({ campo: 'cd_pedido_fornecedor', label: 'PI' })}
              {Texto({ campo: 'cd_material_fornecedor', label: 'Ref Fornecedor' })}
              {Texto({ campo: 'cd_pedido_sap', label: 'Pedido SAP' })}
              {Texto({ campo: 'cd_material_pai', label: 'Material Pai' })}
            </Bloco>
            <Bloco titulo="Infos" cor="rosa">
              {Combo({ campo: 'dc_info1', label: 'Info 1', tipo: 'INFO 1', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_info2', label: 'Info 2', tipo: 'INFO 2', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_info3', label: 'Info 3', tipo: 'INFO 3', grupoCombo: cdGrupo })}
              {Combo({ campo: 'dc_info4', label: 'Info 4', tipo: 'INFO 4', grupoCombo: cdGrupo })}
            </Bloco>
          </div>

          <div className="space-y-2">
            <Bloco titulo="Datas / Logística" cor="marrom">
              {Data({ campo: 'dt_delivery', label: 'Delivery' })}
              {Data({ campo: 'dt_revised_delivery', label: 'Revised Deliv.' })}
              {Combo({ campo: 'dc_modal', label: 'Modal', tipo: 'MODAL', grupoCombo: cdGrupo })}
              {Data({ campo: 'dt_recebimento', label: 'Recebimento' })}
              {Combo({ campo: 'dc_fup_produto', label: 'FUP Produto', tipo: 'FUP PRODUTO' })}
            </Bloco>
            <Bloco titulo="Observações" cor="cinza">
              <Textarea
                className="min-h-[80px] text-xs"
                value={form.dc_observacao ?? ''}
                onChange={(e) => set('dc_observacao', e.target.value)}
              />
            </Bloco>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onFechar(false)}>Cancelar</Button>
          <Button
            loading={criar.isPending}
            onClick={async () => {
              if (await confirmar({ titulo: 'Cadastro em massa', mensagem: `Criar ${qtdLinhas} nova(s) linha(s) na carteira?`, textoConfirmar: 'Criar' })) criar.mutate();
            }}
          >
            <Layers /> Criar {qtdLinhas} linha(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
