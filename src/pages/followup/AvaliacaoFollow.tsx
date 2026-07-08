import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, hojeISO } from '@/lib/utils';

const OPCOES_AVALIACAO = [
  'OK - Proposta aceita',
  'Proposta Recusada - detalhar campo observação',
  'Pendencia fornecedor - Detalhar ação no campo obs',
  'BAIXA AUTOMATICA',
  'PENDENTE',
];

export function AvaliacaoFollow({
  follow,
  somenteLeitura,
  onFechar,
}: {
  follow: any;
  somenteLeitura: boolean;
  onFechar: (mudou: boolean) => void;
}) {
  const { registraLog } = useAuth();
  const [avaliacaoComprador, setAvaliacaoComprador] = useState(follow.dc_avaliacao_comprador ?? '');
  const [observacao, setObservacao] = useState(follow.dc_observacao_avaliacao ?? '');
  const [salvando, setSalvando] = useState(false);

  const leadAtual =
    follow.dt_recebimento_cb_original && follow.dt_revised_delivery_original
      ? Math.round((new Date(follow.dt_recebimento_cb_original).getTime() - new Date(follow.dt_revised_delivery_original).getTime()) / 86_400_000)
      : null;
  const leadProposta =
    follow.dt_recebimento_cb_original && follow.dt_revised_delivery_proposta
      ? Math.round((new Date(follow.dt_recebimento_cb_original).getTime() - new Date(follow.dt_revised_delivery_proposta).getTime()) / 86_400_000)
      : null;

  const salvar = async () => {
    setSalvando(true);
    const { error } = await supabase
      .from('followup_fornecedor')
      .update({
        dc_avaliacao_comprador: avaliacaoComprador,
        dc_observacao_avaliacao: observacao,
        dt_avaliacao_comprador: hojeISO(),
      })
      .eq('cd_follow_forn', follow.cd_follow_forn);
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    registraLog('FollowFornecedor - Avaliacao', follow.cd_follow_forn);
    toast.success('Avaliação registrada.');
    onFechar(true);
  };

  const Campo = ({ label, valor }: { label: string; valor: React.ReactNode }) => (
    <div>
      <Label>{label}</Label>
      <Input value={String(valor ?? '')} disabled />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar(false)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Avaliação Follow-up — {follow.cd_follow_forn}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Campo label="Fornecedor" valor={follow.dc_fornecedor} />
          <Campo label="Canal / Grupo" valor={`${follow.dc_canal ?? ''} / ${follow.dc_grupo ?? ''}`} />
          <Campo label="Griffe" valor={follow.dc_griffe} />
          <Campo label="PI" valor={follow.cd_pedido_fornecedor} />
          <Campo label="Pedido SAP" valor={follow.pedido_sap} />
          <Campo label="Ref Fornecedor" valor={follow.cd_material_fornecedor} />
          <Campo label="Recebimento" valor={formatDate(follow.dt_recebimento_cb_original)} />
          <Campo label="Delivery Original" valor={formatDate(follow.dt_revised_delivery_original)} />
          <Campo label="Delivery Proposta" valor={formatDate(follow.dt_revised_delivery_proposta)} />
          <Campo label="Lead Time Atual" valor={leadAtual} />
          <Campo label="Lead Time Proposta" valor={leadProposta} />
          <Campo label="Status Fornecedor" valor={follow.dc_status_fornecedor} />
          <div className="col-span-2 md:col-span-3">
            <Label>Observação do Fornecedor</Label>
            <Textarea value={follow.dc_observacao_fornecedor ?? ''} disabled />
          </div>
          <div className="col-span-2 md:col-span-2">
            <Label>Avaliação do Comprador</Label>
            <Select
              value={avaliacaoComprador}
              onChange={(e) => setAvaliacaoComprador(e.target.value)}
              disabled={somenteLeitura}
              placeholder=""
              options={OPCOES_AVALIACAO}
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <Label>Observação da Avaliação</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} disabled={somenteLeitura} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)}>Fechar</Button>
          {!somenteLeitura && (
            <Button onClick={salvar} loading={salvando}>Salvar avaliação</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
