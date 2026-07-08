import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Save, SearchCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { GRUPO_GERAL, useCombos, useEssentials, useGrupos } from '@/services/combos';
import { parsePI, extrairFotoPI, traduzCoresPI, type DadosPI } from '@/lib/pi-parser';
import { validaCompra } from '@/lib/regras';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { formatDate, formatNumber, hojeISO } from '@/lib/utils';
import type { Compra } from '@/types';

interface CorLinha {
  numero: string;
  pt: { lente: string; armacao: string; acabArmacao: string; haste: string; acabHaste: string };
  ing: { lente: string; armacao: string; acabArmacao: string; haste: string; acabHaste: string };
  qtde: number;
  fob: number;
}

export default function CadastroPI() {
  const { usuario, podeEditar, registraLog } = useAuth();
  const editavel = podeEditar('cadastro_pi');
  const { data: grupos } = useGrupos();
  const { opcoes } = useCombos();
  const { data: essentials } = useEssentials();

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pi, setPi] = useState<DadosPI | null>(null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [cores, setCores] = useState<CorLinha[]>([]);
  const [compra, setCompra] = useState<Partial<Compra> | null>(null);
  const [cdBusca, setCdBusca] = useState('');
  const [piExistente, setPiExistente] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: dicionarioCores } = useQuery({
    queryKey: ['prm_cor_pi'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_cor_pi').select('*').order('ordem_pesquisa');
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: deparaCampos } = useQuery({
    queryKey: ['prm_depara_campos_pi'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prm_depara_campos_pi').select('*');
      if (error) throw error;
      return data as any[];
    },
  });

  const cdGrupo = useMemo(
    () => grupos?.find((g) => g.dc_grupo === compra?.dc_grupo)?.cd_grupo ?? GRUPO_GERAL,
    [grupos, compra?.dc_grupo],
  );

  const dePara = (tipo: string, valor: string, grupo: number = cdGrupo): string =>
    (deparaCampos ?? []).find(
      (d) => d.dc_tipo_combo === tipo && d.cd_grupo === grupo && (d.info_de ?? '').toUpperCase() === (valor ?? '').toUpperCase(),
    )?.info_para ?? '';

  const processarArquivo = async (file: File) => {
    setArquivo(file);
    const buffer = await file.arrayBuffer();
    let dados: DadosPI;
    try {
      dados = parsePI(buffer);
    } catch (e) {
      toast.error(`Erro ao ler a PI: ${e}`);
      return;
    }
    setPi(dados);

    const blob = await extrairFotoPI(buffer);
    setFoto(blob);
    setFotoUrl(blob ? URL.createObjectURL(blob) : null);

    // Traduz cores EN -> PT
    setCores(
      dados.cores.map((c) => {
        const t = traduzCoresPI(c, dicionarioCores ?? []);
        return {
          numero: c.numero,
          pt: { lente: t.lensPT, armacao: t.framePT, acabArmacao: t.acabFramePT, haste: t.templePT, acabHaste: t.acabTemplePT },
          ing: { lente: c.lensColor, armacao: c.frameColor, acabArmacao: c.frameDescription, haste: c.templeColor, acabHaste: c.templeDescription },
          qtde: c.qtde,
          fob: c.fob,
        };
      }),
    );

    // PI já cadastrada?
    if (dados.cdPI) {
      const { data: dup } = await supabase
        .from('controle_compras')
        .select('cd_compra')
        .eq('cd_pedido_fornecedor', dados.cdPI)
        .neq('dc_status', 'EXCLUIDO')
        .order('cd_compra', { ascending: false })
        .limit(1)
        .maybeSingle();
      setPiExistente(dup?.cd_compra ?? null);
    } else {
      setPiExistente(null);
    }

    if (dados.cdSysplan > 0) {
      await buscarCompra(dados.cdSysplan, dados);
    } else {
      setCompra(null);
      toast.info('PI sem "Sysplan number" — pesquise a compra pelo CD.');
    }
  };

  const buscarCompra = async (cd: number, dados?: DadosPI) => {
    const { data: c, error } = await supabase
      .from('controle_compras')
      .select('*')
      .eq('cd_compra', cd)
      .maybeSingle();
    if (error || !c) {
      toast.error('CD Sysplan inválido!');
      return;
    }
    const d = dados ?? pi;
    const grupoNum = grupos?.find((g) => g.dc_grupo === c.dc_grupo)?.cd_grupo ?? GRUPO_GERAL;
    setCompra({
      ...(c as Compra),
      // dados vindos da PI substituem os atuais
      cd_pedido_fornecedor: d?.cdPI || c.cd_pedido_fornecedor,
      cd_material_fornecedor: d?.refFornecedor || c.cd_material_fornecedor,
      nr_quantidade: d?.qtdTotal || c.nr_quantidade,
      nr_total_fob: d?.fobTotal || c.nr_total_fob,
      nr_fob_negociado: d && d.qtdTotal > 0 && d.fobTotal > 0 ? d.fobTotal / d.qtdTotal : c.nr_fob_negociado,
      dt_delivery: d?.deliveryDate ?? c.dt_delivery,
      dt_revised_delivery: d?.deliveryDate ?? c.dt_revised_delivery,
      dc_medidas: d?.size || c.dc_medidas,
      dc_fornecedor: (d && dePara('FORNECEDOR', d.fornecedor, GRUPO_GERAL)) || c.dc_fornecedor,
      dc_material1: (d && dePara('MATERIAL 1', d.frame1, grupoNum)) || c.dc_material1,
      dc_material2:
        (d && dePara('MATERIAL 2', grupoNum === 3 || grupoNum === 5 ? d.lens : d.temple1, grupoNum)) || c.dc_material2,
      dc_atributo1: (d && dePara('ATRIBUTO 1', d.atributo1, grupoNum)) || c.dc_atributo1,
      dc_atributo2: (d && dePara('ATRIBUTO 2', d.atributo2, grupoNum)) || c.dc_atributo2,
      dc_info1: (d && dePara('INFO 1', d.hinge, grupoNum)) || c.dc_info1,
      dc_info2: (d && dePara('INFO 2', d.nosePad, grupoNum)) || c.dc_info2,
      dc_info4: (d && dePara('INFO 4', d.cliponType, grupoNum)) || c.dc_info4,
    });
  };

  const set = (campo: keyof Compra, valor: unknown) =>
    setCompra((f) => (f ? { ...f, [campo]: valor } : f));

  const salvar = async () => {
    if (!compra?.cd_compra) {
      toast.error('CD Sysplan não preenchido');
      return;
    }
    const leadTime =
      compra.dt_recebimento && compra.dt_revised_delivery
        ? (new Date(compra.dt_recebimento).getTime() - new Date(compra.dt_revised_delivery).getTime()) / 86_400_000
        : 0;
    const erros = validaCompra({ ...compra, nr_lead_time: leadTime || 1 });
    if (!compra.dt_delivery) erros.push('Delivery date não preenchido');
    if (!compra.dt_recebimento) erros.push('Data de recebimento não preenchida');
    if (!compra.cd_pedido_fornecedor) erros.push('Pedido Fornecedor (PI) não preenchido');
    if (!compra.cd_material_fornecedor) erros.push('Referência Fornecedor não preenchida');
    if (erros.length > 0) {
      toast.error(erros[0]);
      return;
    }
    if (!confirm('Deseja salvar?')) return;
    setSalvando(true);
    try {
      const payload: Record<string, any> = { ...compra };
      delete payload.cd_compra;
      delete payload.criado_em;
      delete payload.atualizado_em;
      const { error } = await supabase
        .from('controle_compras')
        .update(payload)
        .eq('cd_compra', compra.cd_compra);
      if (error) throw error;

      // Storage: arquivo da PI e foto do produto
      const nomeBase = `${usuario?.nome ?? 'user'} - ${hojeISO().replace(/-/g, '')} - ${arquivo?.name ?? 'pi.xlsx'}`;
      let pathArquivo: string | null = null;
      let pathFoto: string | null = null;
      if (arquivo) {
        pathArquivo = `pi/${compra.cd_pedido_fornecedor}/${nomeBase}`;
        await supabase.storage.from('arquivos-pi').upload(pathArquivo, arquivo, { upsert: true });
      }
      if (foto && compra.cd_material_fornecedor) {
        pathFoto = `${compra.cd_material_fornecedor}.jpg`;
        await supabase.storage.from('fotos-produto').upload(pathFoto, foto, { upsert: true, contentType: foto.type });
      }

      // Histórico em pasta_pi + cores
      const registroPI: Record<string, any> = {
        dc_nome_arquivo: nomeBase,
        dc_status_movimentacao: 'Carregada Sysplan',
        cd_sysplan: compra.cd_compra,
        cd_pi: compra.cd_pedido_fornecedor,
        dt_delivery_date: compra.dt_delivery,
        cd_ref_fornecedor: compra.cd_material_fornecedor,
        dc_fornecedor: compra.dc_fornecedor,
        nr_qtd_total: compra.nr_quantidade,
        nr_fob_total: compra.nr_total_fob,
        dc_size: pi?.size,
        dc_possui_foto: foto ? 'Sim' : 'Nao',
        storage_path_arquivo: pathArquivo,
        storage_path_foto: pathFoto,
        importado_por: usuario?.id,
      };
      await supabase.from('pasta_pi').upsert(registroPI, { onConflict: 'dc_nome_arquivo' });
      if (cores.length > 0) {
        const linhasCores = cores.flatMap((c) => [
          {
            dc_nome_arquivo: nomeBase, dc_numero_cor: c.numero, dc_idioma: 'PORTUGUES',
            dc_cor_lente: c.pt.lente, dc_cor_armacao: c.pt.armacao, dc_acabamento_armacao: c.pt.acabArmacao,
            dc_cor_haste: c.pt.haste, dc_acabamento_haste: c.pt.acabHaste, nr_qtde: c.qtde, nr_fob: c.fob,
          },
          {
            dc_nome_arquivo: nomeBase, dc_numero_cor: c.numero, dc_idioma: 'INGLES',
            dc_cor_lente: c.ing.lente, dc_cor_armacao: c.ing.armacao, dc_acabamento_armacao: c.ing.acabArmacao,
            dc_cor_haste: c.ing.haste, dc_acabamento_haste: c.ing.acabHaste, nr_qtde: c.qtde, nr_fob: c.fob,
          },
        ]);
        await supabase.from('pi_cores').insert(linhasCores);
      }
      registraLog('EdicaoCompra - IMPORT PI', compra.cd_compra, '', arquivo?.name ?? '');
      toast.success('Alterações salvas com sucesso!');
      limpar();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSalvando(false);
    }
  };

  const limpar = () => {
    setArquivo(null);
    setPi(null);
    setFoto(null);
    setFotoUrl(null);
    setCores([]);
    setCompra(null);
    setCdBusca('');
    setPiExistente(null);
  };

  const atualizaCor = (idx: number, idioma: 'pt' | 'ing', campo: string, valor: string) => {
    setCores((cs) => {
      const n = [...cs];
      (n[idx][idioma] as any)[campo] = valor;
      return n;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cadastro de PI</h1>
          <p className="text-sm text-muted-foreground">Importação de Proforma Invoice do fornecedor</p>
        </div>
        <div className="flex gap-2">
          {editavel && (
            <>
              <Button onClick={() => document.getElementById('arq-pi')?.click()}>
                <FileUp /> Importar PI (Excel)
              </Button>
              <input
                id="arq-pi" type="file" accept=".xlsx,.xlsm,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processarArquivo(f); e.target.value = ''; }}
              />
            </>
          )}
          <Button variant="outline" onClick={limpar}><X /> Limpar tela</Button>
        </div>
      </div>

      {arquivo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Arquivo: <Badge variant="secondary">{arquivo.name}</Badge>
          {piExistente && (
            <Badge variant="destructive">PI já vinculada ao CD {piExistente}</Badge>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base">
              Vincular à compra
              <div className="flex items-center gap-1">
                <Input
                  className="h-8 w-32"
                  placeholder="CD Sysplan"
                  value={compra?.cd_compra ?? cdBusca}
                  onChange={(e) => setCdBusca(e.target.value.replace(/\D/g, ''))}
                  disabled={!!compra}
                />
                {!compra && (
                  <Button size="sm" variant="outline" onClick={() => cdBusca && buscarCompra(Number(cdBusca))}>
                    <SearchCheck /> Buscar
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!compra ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Importe uma PI ou informe o CD Sysplan da compra em aberto para vincular.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div><Label>Canal</Label><Select value={compra.dc_canal ?? ''} onChange={(e) => set('dc_canal', e.target.value)} placeholder="" options={opcoes('CANAL')} /></div>
                <div><Label>Grupo</Label><Input value={compra.dc_grupo ?? ''} disabled /></div>
                <div><Label>SubGrupo</Label><Select value={compra.dc_subgrupo ?? ''} onChange={(e) => set('dc_subgrupo', e.target.value)} placeholder="" options={opcoes('SUB GRUPO', cdGrupo)} /></div>
                <div><Label>Status</Label><Select value={compra.dc_status ?? ''} onChange={(e) => set('dc_status', e.target.value)} placeholder="" options={opcoes('STATUS')} /></div>
                <div><Label>PI</Label><Input value={compra.cd_pedido_fornecedor ?? ''} onChange={(e) => set('cd_pedido_fornecedor', e.target.value)} /></div>
                <div><Label>Ref Fornecedor</Label><Input value={compra.cd_material_fornecedor ?? ''} onChange={(e) => set('cd_material_fornecedor', e.target.value)} /></div>
                <div><Label>Fornecedor</Label><Select value={compra.dc_fornecedor ?? ''} onChange={(e) => set('dc_fornecedor', e.target.value)} placeholder="" options={opcoes('FORNECEDOR')} /></div>
                <div><Label>Modal</Label><Select value={compra.dc_modal ?? ''} onChange={(e) => set('dc_modal', e.target.value)} placeholder="" options={opcoes('MODAL', cdGrupo)} /></div>
                <div><Label>Quantidade</Label><Input type="number" value={compra.nr_quantidade ?? 0} onChange={(e) => set('nr_quantidade', Number(e.target.value))} /></div>
                <div>
                  <Label>Total FOB</Label>
                  <Input
                    type="number" step="0.01" value={compra.nr_total_fob ?? 0}
                    onChange={(e) => {
                      const total = Number(e.target.value);
                      setCompra((f) => f ? ({
                        ...f, nr_total_fob: total,
                        nr_fob_negociado: total > 0 && (f.nr_quantidade ?? 0) > 0 ? total / (f.nr_quantidade ?? 1) : f.nr_fob_negociado,
                      }) : f);
                    }}
                  />
                </div>
                <div><Label>FOB Médio</Label><Input value={formatNumber(compra.nr_fob_negociado ?? 0)} disabled /></div>
                <div><Label>Preço Varejo</Label><Input type="number" step="0.01" value={compra.nr_preco_varejo ?? 0} onChange={(e) => set('nr_preco_varejo', Number(e.target.value))} /></div>
                <div><Label>Delivery (PI)</Label><Input type="date" value={compra.dt_delivery ?? ''} onChange={(e) => { set('dt_delivery', e.target.value || null); set('dt_revised_delivery', e.target.value || null); }} /></div>
                <div><Label>Recebimento</Label><Input type="date" value={compra.dt_recebimento ?? ''} onChange={(e) => set('dt_recebimento', e.target.value || null)} /></div>
                <div><Label>Material Pai</Label><Input value={compra.cd_material_pai ?? ''} onChange={(e) => set('cd_material_pai', e.target.value)} /></div>
                <div><Label>Pedido SAP</Label><Input value={compra.cd_pedido_sap ?? ''} onChange={(e) => set('cd_pedido_sap', e.target.value)} /></div>
                <div><Label>Material 1</Label><Select value={compra.dc_material1 ?? ''} onChange={(e) => set('dc_material1', e.target.value)} placeholder="" options={opcoes('MATERIAL 1', cdGrupo)} /></div>
                <div><Label>Material 2</Label><Select value={compra.dc_material2 ?? ''} onChange={(e) => set('dc_material2', e.target.value)} placeholder="" options={opcoes('MATERIAL 2', cdGrupo)} /></div>
                <div><Label>Atributo 1</Label><Select value={compra.dc_atributo1 ?? ''} onChange={(e) => set('dc_atributo1', e.target.value)} placeholder="" options={opcoes('ATRIBUTO 1', cdGrupo)} /></div>
                <div><Label>Atributo 2</Label><Select value={compra.dc_atributo2 ?? ''} onChange={(e) => set('dc_atributo2', e.target.value)} placeholder="" options={opcoes('ATRIBUTO 2', cdGrupo)} /></div>
                <div><Label>Medidas</Label><Input value={compra.dc_medidas ?? ''} onChange={(e) => set('dc_medidas', e.target.value)} /></div>
                <div><Label>Linha</Label><Select value={compra.dc_linha ?? ''} onChange={(e) => set('dc_linha', e.target.value)} placeholder="" options={opcoes('LINHA')} /></div>
                <div><Label>Griffe</Label><Select value={compra.dc_griffe ?? ''} onChange={(e) => set('dc_griffe', e.target.value)} placeholder="" options={opcoes('GRIFFE')} /></div>
                <div>
                  <Label>Essential</Label>
                  <Select
                    value={String(compra.cd_essential ?? '')}
                    onChange={(e) => set('cd_essential', Number(e.target.value) || 0)}
                    disabled={compra.dc_linha !== 'ESSENTIAL'}
                    placeholder=""
                  >
                    {(essentials ?? []).map((es: any) => (
                      <option key={es.cd_essential} value={es.cd_essential}>{es.cd_essential} - {es.dc_essential}</option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <Label>Observação</Label>
                  <Textarea value={compra.dc_observacao ?? ''} onChange={(e) => set('dc_observacao', e.target.value)} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Dados da PI / Foto</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {fotoUrl ? (
              <img src={fotoUrl} alt="Foto do produto" className="w-full rounded-md border object-contain" style={{ maxHeight: 200 }} />
            ) : (
              <div className="flex h-32 items-center justify-center rounded-md border text-muted-foreground">Sem foto</div>
            )}
            {pi && (
              <div className="space-y-1 text-muted-foreground">
                <p>PI: <b className="text-foreground">{pi.cdPI || '—'}</b></p>
                <p>Fornecedor: <b className="text-foreground">{pi.fornecedor || '—'}</b></p>
                <p>Ref: <b className="text-foreground">{pi.refFornecedor || '—'}</b></p>
                <p>Delivery: <b className="text-foreground">{formatDate(pi.deliveryDate)}</b></p>
                <p>Qtde: <b className="text-foreground">{formatNumber(pi.qtdTotal, 0)}</b> · FOB Total: <b className="text-foreground">{formatNumber(pi.fobTotal)}</b></p>
                <p>Reorder: <b className="text-foreground">{pi.reorder || '—'}</b> · Last Model: <b className="text-foreground">{pi.lastModel || '—'}</b></p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {cores.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cores da PI (tradução automática — edite se necessário)</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-1">Cor</th><th className="p-1">Lente (PT)</th><th className="p-1">Armação (PT)</th>
                  <th className="p-1">Acab. Armação (PT)</th><th className="p-1">Haste (PT)</th><th className="p-1">Acab. Haste (PT)</th>
                  <th className="p-1">Qtde</th><th className="p-1">FOB</th>
                </tr>
              </thead>
              <tbody>
                {cores.map((c, i) => (
                  <tr key={c.numero} className="border-b">
                    <td className="p-1 font-medium">{c.numero}</td>
                    {(['lente', 'armacao', 'acabArmacao', 'haste', 'acabHaste'] as const).map((campo) => (
                      <td key={campo} className="p-1">
                        <Input
                          className="h-7 text-xs"
                          value={(c.pt as any)[campo]}
                          onChange={(e) => atualizaCor(i, 'pt', campo, e.target.value)}
                          title={`Inglês: ${(c.ing as any)[campo] || '—'}`}
                        />
                      </td>
                    ))}
                    <td className="p-1 w-16">{formatNumber(c.qtde, 0)}</td>
                    <td className="p-1 w-16">{formatNumber(c.fob)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-muted-foreground">
              Total cores: {formatNumber(cores.reduce((s, c) => s + c.qtde, 0), 0)} un ·{' '}
              {formatNumber(cores.reduce((s, c) => s + c.qtde * c.fob, 0))} FOB
            </p>
          </CardContent>
        </Card>
      )}

      {editavel && compra && (
        <div className="flex justify-end">
          <Button size="lg" onClick={salvar} loading={salvando}>
            <Save /> Salvar PI na compra {compra.cd_compra}
          </Button>
        </div>
      )}
    </div>
  );
}
