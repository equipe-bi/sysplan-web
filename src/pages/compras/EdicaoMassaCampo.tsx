import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PencilRuler, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { GRUPO_GERAL, useCombos, useGrupos } from '@/services/combos';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { GRUPOS_RELOGIO } from '@/types';

/**
 * Edição em massa direto na lista: seleciona as linhas, escolhe o campo e o novo valor.
 * Cada alteração é auditada campo a campo pelo trigger do banco.
 */
interface CampoMassa {
  campo: string;
  label: string;
  tipo: 'texto' | 'numero' | 'data' | 'combo';
  comboTipo?: string;
  /** Se informado, busca opções do combo para este grupo (nome do grupo, ex: 'RELOGIOS') */
  comboGrupoNome?: string;
}

const CAMPOS: CampoMassa[] = [
  { campo: 'dt_recebimento', label: 'Data Recebimento', tipo: 'data' },
  { campo: 'dc_gaveta', label: 'Gaveta', tipo: 'texto' },
  { campo: 'dt_delivery', label: 'Data Delivery', tipo: 'data' },
  { campo: 'dt_revised_delivery', label: 'Revised Delivery', tipo: 'data' },
  { campo: 'dc_status', label: 'Status', tipo: 'combo', comboTipo: 'STATUS' },
  { campo: 'dc_canal', label: 'Canal', tipo: 'combo', comboTipo: 'CANAL' },
  { campo: 'dc_fup_produto', label: 'FUP Produto', tipo: 'combo', comboTipo: 'FUP PRODUTO' },
  { campo: 'dc_fornecedor', label: 'Fornecedor', tipo: 'combo', comboTipo: 'FORNECEDOR' },
  { campo: 'dc_linha', label: 'Linha', tipo: 'combo', comboTipo: 'LINHA' },
  { campo: 'dc_griffe', label: 'Griffe', tipo: 'combo', comboTipo: 'GRIFFE' },
  { campo: 'dc_segmentacao', label: 'Segmentação', tipo: 'combo', comboTipo: 'SEGMENTACAO' },
  { campo: 'dc_sexo', label: 'Sexo', tipo: 'combo', comboTipo: 'SEXO' },
  { campo: 'dc_modal', label: 'Modal', tipo: 'texto' },
  { campo: 'dc_aprovacao_cor', label: 'Aprovação Cor', tipo: 'texto' },
  { campo: 'cd_pedido_sap', label: 'Pedido SAP', tipo: 'texto' },
  { campo: 'cd_material_pai', label: 'Material Pai', tipo: 'texto' },
  { campo: 'cd_pedido_fornecedor', label: 'PI (Pedido Fornecedor)', tipo: 'texto' },
  { campo: 'cd_material_fornecedor', label: 'Ref Fornecedor', tipo: 'texto' },
  { campo: 'nr_quantidade', label: 'Quantidade', tipo: 'numero' },
  { campo: 'nr_fob_negociado', label: 'FOB Negociado', tipo: 'numero' },
  { campo: 'nr_total_fob', label: 'Total FOB', tipo: 'numero' },
  { campo: 'nr_preco_varejo', label: 'Preço Varejo', tipo: 'numero' },
  { campo: 'dc_observacao', label: 'Observação', tipo: 'texto' },
];

export function EdicaoMassaCampo({
  selecionadas,
  grupos,
  temRecebimentoPassado,
  onAplicado,
  onLimparSelecao,
}: {
  selecionadas: Set<number>;
  /** Grupos distintos das linhas selecionadas — a edição em massa exige grupo único */
  grupos: string[];
  /** Alguma linha selecionada tem recebimento de ontem para trás (data travada) */
  temRecebimentoPassado: boolean;
  onAplicado: () => void;
  onLimparSelecao: () => void;
}) {
  const { registraLog } = useAuth();
  const { opcoes } = useCombos();
  const { data: gruposPrm } = useGrupos();
  const [campo, setCampo] = useState(CAMPOS[0].campo);
  const [valor, setValor] = useState('');

  const grupoUnico = grupos.length === 1 ? grupos[0] : null;
  const ehRelogio = !!grupoUnico && GRUPOS_RELOGIO.includes(grupoUnico);

  /** Resolve o cd_grupo pelo nome (ex: 'RELOGIOS' → número) */
  const cdGrupoRelogio = useMemo(
    () => gruposPrm?.find((g) => GRUPOS_RELOGIO.includes(g.dc_grupo))?.cd_grupo ?? GRUPO_GERAL,
    [gruposPrm],
  );

  // Campos exclusivos de relógio entram apenas quando a seleção é toda de relógios
  const camposDisponiveis = useMemo<CampoMassa[]>(
    () =>
      ehRelogio
        ? [
            ...CAMPOS,
            // Campos com lista suspensa (vinda do prm_combos do grupo Relógios)
            { campo: 'dc_tipo_pulseira',    label: 'Relógio: Tipo Pulseira',   tipo: 'combo', comboTipo: 'TIPO PULSEIRA',    comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_tipo_dial',        label: 'Relógio: Tipo Dial',       tipo: 'combo', comboTipo: 'TIPO DIAL',        comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_numeros',          label: 'Relógio: Números',         tipo: 'combo', comboTipo: 'NUMEROS',          comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_num_maquina',      label: 'Relógio: Num Máquina',     tipo: 'combo', comboTipo: 'NUM MAQUINA',      comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_acabamento_caixa', label: 'Relógio: Acab. Caixa',     tipo: 'combo', comboTipo: 'ACABAMENTO CAIXA', comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_tipo_visor',       label: 'Relógio: Tipo de Visor',   tipo: 'combo', comboTipo: 'TIPO VISOR',       comboGrupoNome: grupoUnico ?? undefined },
            { campo: 'dc_montadora',        label: 'Relógio: Montadora',       tipo: 'combo', comboTipo: 'MONTADORA',        comboGrupoNome: grupoUnico ?? undefined },
            // Campos texto livre
            { campo: 'cd_codigo_compra',    label: 'Relógio: Código Compra',   tipo: 'texto' },
            { campo: 'cd_spare_parts',      label: 'Relógio: Spare Parts',     tipo: 'texto' },
            // Gaveta agora é campo comum a todos os grupos (unificado com o antigo Info 7)
            { campo: 'dc_nf_seculus',       label: 'Relógio: NF Seculus',      tipo: 'texto' },
          ] as CampoMassa[]
        : CAMPOS,
    [ehRelogio, grupoUnico],
  );

  const def = useMemo(
    () => camposDisponiveis.find((c) => c.campo === campo) ?? camposDisponiveis[0],
    [camposDisponiveis, campo],
  );

  /** Resolve as opções do combo: usa cdGrupoRelogio para campos de relógio, GRUPO_GERAL para os demais */
  const opcoesCombo = useMemo(() => {
    if (!def.comboTipo) return [];
    const cdGrupo = def.comboGrupoNome ? cdGrupoRelogio : GRUPO_GERAL;
    return opcoes(def.comboTipo, cdGrupo);
  }, [def, cdGrupoRelogio, opcoes]);

  const aplicar = useMutation({
    mutationFn: async () => {
      if (campo === 'dt_recebimento' && temRecebimentoPassado) {
        throw new Error(
          'A seleção tem linha(s) com recebimento já ocorrido (ontem para trás) — essa data só pode ser corrigida na tela Checks de Recebimento.',
        );
      }
      if (valor === '' && def.tipo !== 'texto') throw new Error('Informe o novo valor.');
      const novoValor =
        def.tipo === 'numero' ? Number(valor) || 0 : def.tipo === 'data' ? valor || null : valor;
      for (const cd of selecionadas) {
        const { error } = await supabase
          .from('controle_compras')
          .update({ [campo]: novoValor })
          .eq('cd_compra', cd);
        if (error) throw new Error(`CD ${cd}: ${error.message}`);
      }
      registraLog('EdicaoCompra - Alteracao Massa', 0, '', String(novoValor ?? ''), campo);
    },
    onSuccess: () => {
      toast.success(`${def.label} atualizado em ${selecionadas.size} linha(s).`);
      setValor('');
      onAplicado();
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  if (!grupoUnico) {
    return (
      <div className="ml-auto flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <span>
          Edição em massa exige linhas do <b>mesmo grupo</b> — a seleção tem {grupos.length} grupos ({grupos.join(', ')}).
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Limpar seleção" onClick={onLimparSelecao}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="ml-auto flex flex-wrap items-end gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <div>
        <Label className="flex items-center gap-1">
          <PencilRuler className="h-3 w-3" /> Edição em massa ({selecionadas.size} linhas · {grupoUnico})
        </Label>
        <div className="flex gap-2">
          <Select
            className="w-52"
            value={campo}
            onChange={(e) => {
              setCampo(e.target.value);
              setValor('');
            }}
          >
            {camposDisponiveis.map((c) => (
              <option key={c.campo} value={c.campo}>{c.label}</option>
            ))}
          </Select>
          {def.tipo === 'combo' ? (
            <Select className="w-48" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="" options={opcoesCombo} />
          ) : (
            <Input
              className="w-48"
              type={def.tipo === 'data' ? 'date' : def.tipo === 'numero' ? 'number' : 'text'}
              step={def.tipo === 'numero' ? '0.01' : undefined}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          )}
        </div>
      </div>
      <Button size="sm" loading={aplicar.isPending} onClick={() => {
        if (confirm(`Aplicar "${def.label}" em ${selecionadas.size} linha(s)?`)) aplicar.mutate();
      }}>
        Aplicar
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Limpar seleção (desmarcar todas as linhas)"
        onClick={onLimparSelecao}
      >
        <X />
      </Button>
    </div>
  );
}
