import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PencilRuler } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCombos } from '@/services/combos';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';

/**
 * Edição em massa direto na lista: seleciona as linhas, escolhe o campo e o novo valor.
 * Cada alteração é auditada campo a campo pelo trigger do banco.
 */
interface CampoMassa {
  campo: string;
  label: string;
  tipo: 'texto' | 'numero' | 'data' | 'combo';
  comboTipo?: string;
}

const CAMPOS: CampoMassa[] = [
  { campo: 'dt_recebimento', label: 'Data Recebimento', tipo: 'data' },
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
  onAplicado,
}: {
  selecionadas: Set<number>;
  onAplicado: () => void;
}) {
  const { registraLog } = useAuth();
  const { opcoes } = useCombos();
  const [campo, setCampo] = useState(CAMPOS[0].campo);
  const [valor, setValor] = useState('');

  const def = useMemo(() => CAMPOS.find((c) => c.campo === campo)!, [campo]);

  const aplicar = useMutation({
    mutationFn: async () => {
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

  return (
    <div className="ml-auto flex flex-wrap items-end gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <div>
        <Label className="flex items-center gap-1">
          <PencilRuler className="h-3 w-3" /> Edição em massa ({selecionadas.size} linhas)
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
            {CAMPOS.map((c) => (
              <option key={c.campo} value={c.campo}>{c.label}</option>
            ))}
          </Select>
          {def.tipo === 'combo' ? (
            <Select className="w-48" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="" options={opcoes(def.comboTipo!)} />
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
    </div>
  );
}
