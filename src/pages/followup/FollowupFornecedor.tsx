import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { CheckCheck, FileDown, FileUp, PlayCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, fetchAll } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCombos, useCompradores } from '@/services/combos';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import { baixarBlob, gerarArquivoFollowup, type LinhaFollowExport } from '@/lib/followup-excel';
import { prepararExportacaoFollow } from '@/lib/followup-regra';
import { AvaliacaoFollow } from './AvaliacaoFollow';

type StatusFiltro = '' | 'COM_RESPOSTA' | 'SEM_RESPOSTA';

interface LinhaFollow {
  cd_follow_forn: number;
  cd_compra: number;
  dt_inicio_followup: string | null;
  dc_fornecedor: string | null;
  produto: string;
  cd_pedido_fornecedor: string | null;
  cd_material_fornecedor: string | null;
  pedido_sap: string;
  dc_status_fornecedor: string | null;
  dt_revised_delivery_original: string | null;
  dt_revised_delivery_proposta: string | null;
  dc_avaliacao_comprador: string | null;
  dc_numero_bl: string | null;
  dt_novo_recebimento_comprador: string | null;
  dt_novo_delivery_comprador: string | null;
  dc_novo_modal_comprador: string | null;
  dc_grupo: string | null;
  dc_canal: string | null;
  dc_griffe: string | null;
  cd_material_pai: string | null;
}

export default function FollowupFornecedor() {
  const { usuario, podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('followup_fornecedor');
  const qc = useQueryClient();
  const { opcoes } = useCombos();
  const { data: compradores } = useCompradores();

  const [status, setStatus] = useState<StatusFiltro>('SEM_RESPOSTA');
  const [fornecedor, setFornecedor] = useState('');
  const [canal, setCanal] = useState('');
  const [grupo, setGrupo] = useState('');
  const [pi, setPi] = useState('');
  const [materialPai, setMaterialPai] = useState('');
  const [avaliacao, setAvaliacao] = useState<LinhaFollow | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['followups', status],
    queryFn: async () => {
      // followup_fornecedor não tem FK para controle_compras (dados legados órfãos),
      // então o join é feito manualmente em duas consultas
      const seleciona = (inicio: number, fim: number) => {
        let q = supabase
          .from('followup_fornecedor')
          .select('*')
          .order('cd_follow_forn', { ascending: false });
        if (status === 'SEM_RESPOSTA') q = q.is('dt_fim_followup', null);
        if (status === 'COM_RESPOSTA') q = q.not('dt_fim_followup', 'is', null);
        return q.range(inicio, fim);
      };
      // limita a 5000 follow-ups mais recentes para manter a tela leve
      let rows = await fetchAll<any>(seleciona, 5000);
      if (status === 'COM_RESPOSTA') {
        // mantém apenas o último follow respondido de cada compra
        const vistos = new Set<number>();
        rows = rows.filter((r) => {
          if (vistos.has(r.cd_compra)) return false;
          vistos.add(r.cd_compra);
          return true;
        });
      }

      // Busca as compras dos follows em blocos e junta client-side
      const cds = [...new Set(rows.map((r) => r.cd_compra).filter((c) => c > 0))];
      const comprasPorCd = new Map<number, any>();
      for (let i = 0; i < cds.length; i += 300) {
        const { data: bloco, error } = await supabase
          .from('controle_compras')
          .select('cd_compra, dc_fornecedor, dc_grupo, dc_canal, dc_linha, dc_griffe, cd_pedido_fornecedor, cd_material_fornecedor, cd_pedido_sap, cd_material_pai, dc_status')
          .in('cd_compra', cds.slice(i, i + 300))
          .limit(1000);
        if (error) throw error;
        for (const c of bloco ?? []) comprasPorCd.set(c.cd_compra, c);
      }

      rows = rows
        .map((r) => ({ ...r, compra: comprasPorCd.get(r.cd_compra) }))
        .filter((r) => r.compra && r.compra.dc_status !== 'EXCLUIDO');

      return (rows ?? []).map((r: any): LinhaFollow => ({
        ...r,
        dc_fornecedor: r.compra?.dc_fornecedor,
        dc_grupo: r.compra?.dc_grupo,
        dc_canal: r.compra?.dc_canal,
        dc_griffe: r.compra?.dc_griffe,
        cd_pedido_fornecedor: r.compra?.cd_pedido_fornecedor,
        cd_material_fornecedor: r.compra?.cd_material_fornecedor,
        cd_material_pai: r.compra?.cd_material_pai,
        produto: `${r.compra?.dc_grupo ?? ''} ${(r.compra?.dc_canal ?? '').slice(0, 3)} | ${['ESSENTIAL', 'CHILLI BEANS', 'PREMIUM'].includes(r.compra?.dc_linha) ? r.compra?.dc_linha : r.compra?.dc_griffe ?? ''}`,
        pedido_sap: `${r.compra?.cd_pedido_sap ?? ''} - ${r.compra?.cd_material_pai ?? ''}`,
      }));
    },
  });

  const filtrados = useMemo(() => {
    let r = data ?? [];
    if (fornecedor) r = r.filter((x) => x.dc_fornecedor === fornecedor);
    if (canal) r = r.filter((x) => x.dc_canal === canal);
    if (grupo) r = r.filter((x) => x.dc_grupo === grupo);
    if (pi) r = r.filter((x) => (x.cd_pedido_fornecedor ?? '').toLowerCase().includes(pi.toLowerCase()));
    if (materialPai) r = r.filter((x) => (x.cd_material_pai ?? '').toLowerCase().includes(materialPai.toLowerCase()));
    return r;
  }, [data, fornecedor, canal, grupo, pi, materialPai]);

  // Aplica a regra (baixa sistema por chave + geração de novas linhas) sem exportar
  const rotinas = useMutation({
    mutationFn: async () => {
      const r = await prepararExportacaoFollow({
        fornecedor, canal, grupo, pi, materialPai,
      });
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Rotinas: ${r.baixados} baixa(s) sistema, ${r.gerados} follow-up(s) gerado(s).`);
      registraLog('FollowFornecedor - Rotinas', 0, '', `baixas=${r.baixados}; novos=${r.gerados}`);
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['compras_lista'] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const [exportando, setExportando] = useState(false);

  // --- Helper: fecha follows abertos quando houver correspondência no Acompanhamento (embarque encontrado)
  async function baixaPorFUPComex(): Promise<number> {
    const hoje = new Date().toISOString().slice(0, 10);
    // busca follows abertos com cd_compra válido
    const { data: follows, error: eF } = await supabase
      .from('followup_fornecedor')
      .select('cd_follow_forn, cd_compra')
      .is('dt_fim_followup', null)
      .not('cd_compra', 'is', null);
    if (eF) throw eF;
    if (!follows || follows.length === 0) return 0;

    let count = 0;
    // processa em blocos para evitar sobrecarga
    for (let i = 0; i < follows.length; i += 200) {
      const bloco = follows.slice(i, i + 200);
      const cds = bloco.map((f: any) => f.cd_compra).filter(Boolean);
      // busca acompanhamento para esses CDs com embarque preenchido
      const { data: acomps, error: eA } = await supabase
        .from('acompanhamento_importacoes')
        .select('cd_compra, cd_embarque')
        .in('cd_compra', cds)
        .not('cd_embarque', 'is', null)
        .limit(1000);
      if (eA) throw eA;
      const mapA = new Map<number, any>();
      for (const a of acomps ?? []) mapA.set(a.cd_compra, a);

      for (const f of bloco) {
        const a = mapA.get(f.cd_compra);
        if (a) {
          const hojeStr = hoje;
          const atualizacao: Record<string, any> = {
            dt_fim_followup: hojeStr,
            dc_avaliacao_comprador: 'BAIXA SISTEMA',
            dc_observacao_avaliacao: `Encontrado em AcompImportacoes: embarque ${a.cd_embarque}`,
            dt_avaliacao_comprador: hojeStr,
          };
          const { error: eU } = await supabase.from('followup_fornecedor').update(atualizacao).eq('cd_follow_forn', f.cd_follow_forn);
          if (!eU) count++;
        }
      }
    }
    return count;
  }

  // --- Helper: cria follow-ups para compras cujo mês/ano de recebimento é maior que o atual
  //           e que não aparecem no Acompanhamento nem têm follow aberto.
  async function sincronizarChaves(): Promise<number> {
    const hoje = new Date();
    const inicioProximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString().slice(0, 10);

    // busca compras com dt_recebimento >= inicioProximoMes
    const compras: any[] = [];
    let offset = 0;
    while (true) {
      const { data: page, error } = await supabase
        .from('controle_compras')
        .select('cd_compra, cd_pedido_sap, cd_material_pai, dc_fornecedor, dt_recebimento, dt_revised_delivery, dc_modal')
        .gte('dt_recebimento', inicioProximoMes)
        .neq('dc_status', 'EXCLUIDO')
        .order('dt_recebimento')
        .range(offset, offset + 999);
      if (error) throw error;
      compras.push(...(page ?? []));
      if (!page || page.length < 1000) break;
      offset += 1000;
    }
    if (compras.length === 0) return 0;

    let criados = 0;
    for (const c of compras) {
      // verifica se existe Acompanhamento com mesma chave (pedido sap + material pai)
      const { data: ac, error: eAc } = await supabase
        .from('acompanhamento_importacoes')
        .select('id, cd_compra, cd_embarque')
        .eq('cd_pedido_sap', c.cd_pedido_sap)
        .eq('cd_material_pai', c.cd_material_pai)
        .limit(1)
        .maybeSingle();
      if (eAc) throw eAc;
      if (ac) continue; // já existe informação no AcompImportacoes

      // verifica if existe follow aberto para essa compra
      const { data: openF } = await supabase
        .from('followup_fornecedor')
        .select('*')
        .eq('cd_compra', c.cd_compra)
        .is('dt_fim_followup', null)
        .limit(1)
        .maybeSingle();
      if (openF) continue; // já existe follow aguardando resposta -> usar essa linha

      // busca o último follow (com resposta) para copiar resposta se houver
      const { data: lastF } = await supabase
        .from('followup_fornecedor')
        .select('*')
        .eq('cd_compra', c.cd_compra)
        .not('dt_fim_followup', 'is', null)
        .order('cd_follow_forn', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastF) {
        // cria nova linha copiando campos relevantes da última resposta (aplica resposta antiga)
        const payload: Record<string, any> = {
          cd_compra: c.cd_compra,
          dt_revised_delivery_original: lastF.dt_revised_delivery_original ?? lastF.dt_revised_delivery_proposta ?? c.dt_revised_delivery,
          dt_recebimento_cb_original: lastF.dt_recebimento_cb_original ?? c.dt_recebimento,
          dc_modal_original: lastF.dc_modal_original ?? c.dc_modal,
          dt_inicio_followup: new Date().toISOString().slice(0, 10),
          dc_status_fornecedor: lastF.dc_status_fornecedor ?? 'PENDENTE',
          dc_avaliacao_comprador: lastF.dc_avaliacao_comprador ?? 'PENDENTE',
        };
        const { data: created, error: eC } = await supabase.from('followup_fornecedor').insert(payload).select('cd_follow_forn, cd_compra');
        if (eC) throw eC;
        if (created && created.length > 0) criados += created.length;
      } else {
        // cria snapshot básico (sem resposta anterior)
        const payload: Record<string, any> = {
          cd_compra: c.cd_compra,
          dt_revised_delivery_original: c.dt_revised_delivery,
          dt_recebimento_cb_original: c.dt_recebimento,
          dc_modal_original: c.dc_modal,
          dt_inicio_followup: new Date().toISOString().slice(0, 10),
          dc_status_fornecedor: 'PENDENTE',
          dc_avaliacao_comprador: 'PENDENTE',
        };
        const { data: created, error: eC } = await supabase.from('followup_fornecedor').insert(payload).select('cd_follow_forn, cd_compra');
        if (eC) throw eC;
        if (created && created.length > 0) criados += created.length;
      }
    }

    return criados;
  }

  /**
   * Exporta o follow-up do fornecedor selecionado na máscara oficial (senha Plan8):
   * compras não excluídas com Revised Delivery do mês atual até +10 meses.
   * Compras sem follow em aberto ganham um novo follow (snapshot das datas atuais).
   */
  // Core: gera e baixa arquivo para um único fornecedor (reutilizável)
  async function gerarExportParaFornecedor(fornec: string) {
    const hoje = new Date();
    const inicioMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const limite = new Date(hoje.getFullYear(), hoje.getMonth() + 10, 1);
    const fimJanela = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-01`;

    const compras = await fetchAll<any>((inicio, fim) =>
      supabase
        .from('controle_compras')
        .select('cd_compra, dc_fornecedor, cd_pedido_fornecedor, cd_material_fornecedor, cd_pedido_sap, cd_material_pai, dc_grupo, dc_canal, dc_linha, dc_griffe, dt_revised_delivery, dt_recebimento, dc_modal')
        .eq('dc_fornecedor', fornec)
        .neq('dc_status', 'EXCLUIDO')
        .gte('dt_revised_delivery', inicioMes)
        .lt('dt_revised_delivery', fimJanela)
        .order('dt_revised_delivery')
        .range(inicio, fim),
    );
    if (compras.length === 0) return 0;

    // Follows em aberto existentes dessas compras (consulta em blocos de 300 CDs)
    const followPorCompra = new Map<number, any>();
    const cds = compras.map((c) => c.cd_compra);
    for (let i = 0; i < cds.length; i += 300) {
      const { data: bloco, error } = await supabase
        .from('followup_fornecedor')
        .select('cd_follow_forn, cd_compra, dt_revised_delivery_original, dt_recebimento_cb_original, dc_modal_original')
        .is('dt_fim_followup', null)
        .in('cd_compra', cds.slice(i, i + 300))
        .limit(1000);
      if (error) throw error;
      for (const f of bloco ?? []) followPorCompra.set(f.cd_compra, f);
    }

    // Cria follow (snapshot) para compras sem follow em aberto
    const semFollow = compras.filter((c) => !followPorCompra.has(c.cd_compra));
    if (semFollow.length > 0) {
      const { data: criados, error } = await supabase
        .from('followup_fornecedor')
        .insert(
          semFollow.map((c) => ({
            cd_compra: c.cd_compra,
            dt_revised_delivery_original: c.dt_revised_delivery,
            dt_recebimento_cb_original: c.dt_recebimento,
            dc_modal_original: c.dc_modal,
            dt_inicio_followup: new Date().toISOString().slice(0, 10),
            dc_status_fornecedor: 'PENDENTE',
            dc_avaliacao_comprador: 'PENDENTE',
          })),
        )
        .select('cd_follow_forn, cd_compra, dt_revised_delivery_original, dt_recebimento_cb_original, dc_modal_original');
      if (error) throw error;
      for (const f of criados ?? []) followPorCompra.set(f.cd_compra, f);
    }

    const linhas: LinhaFollowExport[] = compras
      .filter((c) => followPorCompra.has(c.cd_compra))
      .map((c) => {
        const f = followPorCompra.get(c.cd_compra)!;
        return {
          cdFollow: f.cd_follow_forn,
          cdCompra: c.cd_compra,
          supplier: c.dc_fornecedor ?? '',
          supplierOrder: c.cd_pedido_fornecedor ?? '',
          supplierReference: c.cd_material_fornecedor ?? '',
          cbOrder: c.cd_pedido_sap ?? '',
          cdReference: c.cd_material_pai ?? '',
          group: `${c.dc_grupo ?? ''} ${c.dc_canal ?? ''}`.trim(),
          collection: `${c.dc_linha ?? ''} | ${c.dc_griffe ?? ''}`,
          deliveryDate: f.dt_revised_delivery_original ?? c.dt_revised_delivery,
          cbArrivalDate: f.dt_recebimento_cb_original ?? c.dt_recebimento,
          modal: f.dc_modal_original ?? c.dc_modal ?? '',
        };
      });

    const blob = await gerarArquivoFollowup(linhas);
    const nome = `Followup_Fornecedor_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} - ${fornec.replace(/[\\/]/g, '')}.xlsx`;
    baixarBlob(blob, nome);
    registraLog('FollowFornecedor - Exportacao', 0, '', `${fornec}: ${linhas.length} linhas`);
    return linhas.length;
  }

  /**
   * Exporta TODOS os fornecedores conforme os filtros da tela (1 arquivo por fornecedor).
   * Aplica a regra por chave (Material Pai + Pedido SAP): baixa sistema dos que já têm
   * info no FUP Comex / Agente de Carga e gera novas linhas para recebimento futuro,
   * exportando apenas as linhas de follow SEM resposta.
   */
  const exportarTodos = async () => {
    setExportando(true);
    try {
      const { baixados, gerados, linhasPorFornecedor } = await prepararExportacaoFollow({
        fornecedor, canal, grupo, pi, materialPai,
      });
      if (linhasPorFornecedor.size === 0) {
        toast.info('Nenhuma linha de follow sem resposta para exportar no filtro atual.');
        return;
      }
      let totalLinhas = 0;
      for (const [forn, linhas] of linhasPorFornecedor) {
        const blob = await gerarArquivoFollowup(linhas);
        const nome = `Followup_Fornecedor_${new Date().toISOString().slice(0, 10).replace(/-/g, '')} - ${forn.replace(/[\\/]/g, '')}.xlsx`;
        baixarBlob(blob, nome);
        totalLinhas += linhas.length;
      }
      registraLog('FollowFornecedor - Exportacao', 0, '', `${linhasPorFornecedor.size} fornecedores, ${totalLinhas} linhas (baixa=${baixados}, gerados=${gerados})`);
      toast.success(
        `${linhasPorFornecedor.size} arquivo(s) gerado(s) — ${totalLinhas} linha(s). Baixa sistema: ${baixados}; gerados: ${gerados}. (senha Plan8)`,
        { duration: 9000 },
      );
      qc.invalidateQueries({ queryKey: ['followups'] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setExportando(false);
    }
  };

  const [importando, setImportando] = useState(false);

  /**
   * Importa o arquivo devolvido pelo fornecedor (aba Orders) e aplica:
   *  - no follow-up: Production Status, Supplier Comments, Revised Delivery proposta,
   *    BL, Status fornecedor, Avaliação/Observação do comprador, Novo Recebimento/
   *    Delivery/Modal, Avaliação Final e datas de avaliação/fim do follow;
   *  - na compra: Revised Delivery (se o Novo Delivery difere do Delivery Date),
   *    Modal (se o Novo Modal difere) e Recebimento (se o Novo Recebimento difere
   *    e a compra ainda está com o recebimento original do arquivo).
   */
  const importarRespostas = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { cellDates: true });
    const aba = wb.SheetNames.includes('Orders') ? 'Orders' : wb.SheetNames[0];
    const linhas = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[aba], { defval: null });
    if (linhas.length === 0) {
      toast.error(`A aba "${aba}" está vazia ou não tem o cabeçalho esperado.`);
      return;
    }
    if (!('CD Follow' in linhas[0])) {
      toast.error(`A aba "${aba}" não tem a coluna "CD Follow" — confira se o arquivo é o exportado pelo SysPlan.`);
      return;
    }
    // datas: fórmulas zeradas viram 1899/1900 no Excel — tratadas como vazio
    const dt = (v: any) => {
      if (v instanceof Date) return v.getFullYear() < 1990 ? null : v.toISOString().slice(0, 10);
      if (v == null || v === 0 || v === '') return null;
      return String(v).slice(0, 10);
    };

    const erros: string[] = [];
    const validas: Record<string, any>[] = [];
    for (const [i, l] of linhas.entries()) {
      const cd = Number(l['CD Follow']);
      if (!cd) continue;
      if (!l['Production Status'] || !dt(l['Revised Delivery Date'])) {
        erros.push(`Linha ${i + 2} (Follow ${cd}): resposta do fornecedor incompleta (Production Status / Revised Delivery)`);
        continue;
      }
      if (
        !l['Avaliação Comprador'] || !dt(l['Novo Recebimento']) || !dt(l['Novo Delivery']) || !l['Novo Modal'] ||
        ['Pendencia fornecedor - Detalhar ação no campo obs', 'Proposta Recusada - detalhar campo observação', 'Avaliação Pendente'].includes(l['Avaliação Final'])
      ) {
        erros.push(`Linha ${i + 2} (Follow ${cd}): avaliação do comprador incompleta (coluna R/S ou Avaliação Final pendente)`);
        continue;
      }
      validas.push(l);
    }
    if (erros.length > 0) {
      toast.error(`Erro importação, campos não preenchidos (${erros.length} linha(s)).`, {
        description: erros.slice(0, 5).join(' | '),
        duration: 10000,
      });
      return;
    }
    let aplicadas = 0;
    let comprasAlteradas = 0;
    for (const l of validas) {
      const cd = Number(l['CD Follow']);
      const cdCompra = Number(l['CD Compra']);
      const { error: e1 } = await supabase
        .from('followup_fornecedor')
        .update({
          dc_status_fornecedor: l['Production Status'],
          dc_observacao_fornecedor: l['Supplier Comments'],
          dt_revised_delivery_proposta: dt(l['Revised Delivery Date']),
          dc_numero_bl: l['BL - bill of lading Number'],
          dc_avaliacao_fornecedor: l['Status fornecedor'],
          dc_avaliacao_comprador: l['Avaliação Comprador'],
          dc_observacao_avaliacao: l['Observação Comprador'],
          dt_novo_recebimento_comprador: dt(l['Novo Recebimento']),
          dt_novo_delivery_comprador: dt(l['Novo Delivery']),
          dc_novo_modal_comprador: l['Novo Modal'],
          dc_avaliacao_final: l['Avaliação Final'],
          dt_avaliacao_comprador: new Date().toISOString().slice(0, 10),
          dt_fim_followup: new Date().toISOString().slice(0, 10),
        })
        .eq('cd_follow_forn', cd);
      if (e1) {
        toast.error(`Follow ${cd}: ${e1.message}`);
        continue;
      }
      // aplica na compra: delivery sempre que difere; modal se difere; recebimento só se ainda era o original
      const { data: compra } = await supabase
        .from('controle_compras')
        .select('dt_recebimento, dt_revised_delivery, dc_modal')
        .eq('cd_compra', cdCompra)
        .maybeSingle();
      if (compra) {
        const upd: Record<string, any> = {};
        const novoDelivery = dt(l['Novo Delivery']);
        const novoModal = l['Novo Modal'];
        const novoRec = dt(l['Novo Recebimento']);
        if (novoDelivery && novoDelivery !== dt(l['Delivery Date'])) upd.dt_revised_delivery = novoDelivery;
        if (novoModal && novoModal !== l['Modal']) upd.dc_modal = novoModal;
        if (novoRec && novoRec !== dt(l['CB Arrival Date']) && compra.dt_recebimento === dt(l['CB Arrival Date'])) {
          upd.dt_recebimento = novoRec;
        }
        if (Object.keys(upd).length > 0) {
          const { error: e2 } = await supabase.from('controle_compras').update(upd).eq('cd_compra', cdCompra);
          if (e2) toast.error(`Compra ${cdCompra}: ${e2.message}`);
          else comprasAlteradas++;
        }
      }
      aplicadas++;
    }
    registraLog('FollowFornecedor - Importacao', 0, '', `${aplicadas} respostas`);
    await supabase.from('importacoes').insert({
      usuario_id: usuario?.id,
      tipo: 'followup_fornecedor',
      nome_arquivo: file.name,
      total_linhas: linhas.length,
      linhas_validas: aplicadas,
      linhas_erro: erros.length,
      status: 'aplicado',
      aplicado_em: new Date().toISOString(),
    });
    toast.success(
      `Importação concluída: ${aplicadas} follow-up(s) atualizados · ${comprasAlteradas} compra(s) alteradas (delivery/modal/recebimento).`,
      { duration: 10000 },
    );
    qc.invalidateQueries({ queryKey: ['followups'] });
    qc.invalidateQueries({ queryKey: ['compras_lista'] });
  };

  const colunas: Coluna<LinhaFollow>[] = [
    { key: 'cd_follow_forn', titulo: 'Follow' },
    { key: 'cd_compra', titulo: 'CD' },
    { key: 'dt_inicio_followup', titulo: 'Início', render: (r) => formatDate(r.dt_inicio_followup) },
    { key: 'dc_fornecedor', titulo: 'Fornecedor' },
    { key: 'produto', titulo: 'Produto' },
    { key: 'cd_pedido_fornecedor', titulo: 'PI' },
    { key: 'cd_material_fornecedor', titulo: 'Ref Fornecedor' },
    { key: 'pedido_sap', titulo: 'Pedido SAP' },
    { key: 'dc_status_fornecedor', titulo: 'Status Fornecedor' },
    { key: 'dt_revised_delivery_original', titulo: 'Delivery Atual', render: (r) => formatDate(r.dt_revised_delivery_original) },
    { key: 'dt_revised_delivery_proposta', titulo: 'Delivery Proposta', render: (r) => formatDate(r.dt_revised_delivery_proposta) },
    { key: 'dc_avaliacao_comprador', titulo: 'Avaliação' },
    { key: 'dc_numero_bl', titulo: 'BL' },
    { key: 'dt_novo_recebimento_comprador', titulo: 'Rec Revisado', render: (r) => formatDate(r.dt_novo_recebimento_comprador) },
    { key: 'dt_novo_delivery_comprador', titulo: 'Delivery Revisado', render: (r) => formatDate(r.dt_novo_delivery_comprador) },
    { key: 'dc_novo_modal_comprador', titulo: 'Modal Revisado' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-up Fornecedor</h1>
          <p className="text-sm text-muted-foreground">Cobrança e avaliação de status junto aos fornecedores</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw /> Atualizar
          </Button>
          {editavel && (
            <>
              <Button variant="secondary" loading={rotinas.isPending} onClick={() => rotinas.mutate()}>
                <PlayCircle /> Gerar necessidade + baixa automática
              </Button>
              <Button variant="outline" loading={exportando} onClick={exportarTodos}>
                <FileDown /> Exportar (todos os fornecedores do filtro)
              </Button>
              <Button variant="outline" loading={exportando} onClick={async () => {
                // Exporta para todos os fornecedores visíveis na lista atual (um arquivo por fornecedor)
                const fornecedores = [...new Set((filtrados ?? []).map((f) => f.dc_fornecedor).filter(Boolean))] as string[];
                if (fornecedores.length === 0) {
                  toast.error('Nada selecionado para exportar — filtre por fornecedor(s) ou dados visíveis na lista.');
                  return;
                }
                setExportando(true);
                try {
                  let total = 0;
                  for (const f of fornecedores) {
                    const c = await gerarExportParaFornecedor(f);
                    total += c;
                  }
                  toast.success(`Exportados ${total} linha(s) em ${fornecedores.length} arquivo(s).`);
                  qc.invalidateQueries({ queryKey: ['followups'] });
                } catch (err: any) {
                  toast.error(err.message ?? String(err));
                } finally {
                  setExportando(false);
                }
              }}>
                <FileDown /> Exportar (visíveis por fornecedor)
              </Button>
              <label>
                <Button variant="outline" loading={importando} onClick={() => document.getElementById('imp-follow')?.click()}>
                  <FileUp /> Importar respostas
                </Button>
                <input
                  id="imp-follow"
                  type="file"
                  accept=".xlsx,.xlsb,.xls,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setImportando(true);
                    try {
                      await importarRespostas(f);
                    } catch (err: any) {
                      // sem isto, uma falha na leitura do arquivo passava em silêncio
                      toast.error(`Falha na importação: ${err.message ?? String(err)}`);
                    } finally {
                      setImportando(false);
                    }
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="w-56">
            <Label>Situação</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFiltro)}>
              <option value="SEM_RESPOSTA">ULTIMO FOLLOW - AGUARD RESPOSTA</option>
              <option value="COM_RESPOSTA">ULTIMO FOLLOW - COM RESPOSTA</option>
              <option value="">TODOS</option>
            </Select>
          </div>
          <div className="w-44">
            <Label>Fornecedor</Label>
            <Select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Todos" options={opcoes('FORNECEDOR')} />
          </div>
          <div className="w-36">
            <Label>Canal</Label>
            <Select value={canal} onChange={(e) => setCanal(e.target.value)} placeholder="Todos" options={opcoes('CANAL')} />
          </div>
          <div className="w-36">
            <Label>Grupo</Label>
            <Select value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Todos" options={[...new Set((compradores ?? []).map((c: any) => c.dc_grupo).filter(Boolean))] as string[]} />
          </div>
          <div className="w-36">
            <Label>PI</Label>
            <SearchInput value={pi} onChange={(e) => setPi(e.target.value)} onClear={() => setPi('')} />
          </div>
          <div className="w-36">
            <Label>Material Pai</Label>
            <SearchInput value={materialPai} onChange={(e) => setMaterialPai(e.target.value)} onClear={() => setMaterialPai('')} />
          </div>
        </CardContent>
      </Card>

      <DataTable
        colunas={colunas}
        dados={filtrados}
        carregando={isLoading}
        rowKey={(r) => r.cd_follow_forn}
        onRowDoubleClick={(r) => setAvaliacao(r)}
        rodape={<span className="ml-2 inline-flex items-center gap-1"><CheckCheck className="h-3 w-3" /> duplo clique para avaliar</span>}
      />

      {avaliacao && (
        <AvaliacaoFollow
          follow={avaliacao}
          somenteLeitura={!editavel}
          onFechar={(mudou) => {
            setAvaliacao(null);
            if (mudou) qc.invalidateQueries({ queryKey: ['followups'] });
          }}
        />
      )}
    </div>
  );
}
