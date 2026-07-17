import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Coluna } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { lerPlanilha } from '@/lib/exportar';
import { formatDateTime } from '@/lib/utils';

/**
 * Importações administrativas: atualizam os snapshots das bases externas
 * (SAP BW, cadastro de materiais, bases de PDV) que no Access eram links ODBC/rede.
 */
interface ImportDef {
  id: string;
  nome: string;
  descricao: string;
  tabela: string;
  limparAntes: boolean;
  chaveDelete?: string;
  mapear: (linha: Record<string, any>) => Record<string, any> | null;
}

const dt = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const s = (v: any) => (v == null ? null : String(v));

const IMPORTACOES: ImportDef[] = [
  {
    id: 'sap_bw',
    nome: 'Extrator SAP BW (pedidos)',
    descricao: 'Colunas: COMP_CODE, OI_EBELN, OI_EBELP, MATERIAL, NET_PO_VAL, TTLQTY, /BIC/CA_MODAL...',
    tabela: 'ext_sap_pedido_bw',
    limparAntes: true,
    chaveDelete: 'oi_ebeln',
    mapear: (l) => {
      if (!l['OI_EBELN'] || !l['MATERIAL']) return null;
      return {
        comp_code: s(l['COMP_CODE']) ?? '1000',
        oi_ebeln: s(l['OI_EBELN']),
        oi_ebelp: s(l['OI_EBELP']) ?? '0',
        material: s(l['MATERIAL']),
        txt_material: s(l['TXT_MATERIAL']),
        vendor: s(l['VENDOR']),
        net_po_val: Number(l['NET_PO_VAL']) || 0,
        ttlqty: Number(l['TTLQTY']) || 0,
        ca_modal: s(l['/BIC/CA_MODAL'] ?? l['CA_MODAL']),
        order_curr: s(l['ORDER_CURR']),
        erdat: s(l['ERDAT']),
        dsdel_date: s(l['DSDEL_DATE']),
        doctype: s(l['DOCTYPE']),
      };
    },
  },
  {
    id: 'cadastro_material',
    nome: 'Cadastro de Materiais',
    descricao: 'Colunas: CD_Material, CD_MaterialPai, Grupo2, DC_Cor_LenteSolar, DC_Cor_Armacao',
    tabela: 'cadastro_material',
    limparAntes: true,
    chaveDelete: 'cd_material',
    mapear: (l) => {
      const cd = s(l['CD_Material'] ?? l['cd_material'] ?? l['Material']);
      if (!cd) return null;
      return {
        cd_material: cd,
        cd_material_pai: s(l['CD_MaterialPai'] ?? l['cd_material_pai']) ?? cd.slice(0, 8),
        grupo2: s(l['Grupo2'] ?? l['grupo2']),
        dc_cor_lente_solar: s(l['DC_Cor_LenteSolar']),
        dc_cor_armacao: s(l['DC_Cor_Armacao']),
      };
    },
  },
  {
    id: 'cadastro_material_pai',
    nome: 'Cadastro de Materiais Pai',
    descricao: 'Colunas: CD_MaterialPai, DC_Grupo, Grupo2',
    tabela: 'cadastro_material_pai',
    limparAntes: true,
    chaveDelete: 'cd_material_pai',
    mapear: (l) => {
      const cd = s(l['CD_MaterialPai'] ?? l['cd_material_pai']);
      if (!cd) return null;
      return { cd_material_pai: cd, dc_grupo: s(l['DC_Grupo'] ?? l['Grupo']), grupo2: s(l['Grupo2']) };
    },
  },
  {
    id: 'fup_comex',
    nome: 'Base FUP Comex (PRM_FUP_COMEX)',
    descricao:
      'Modelo padrão do FUP: Embarque, Nº do Pedido, Referência, Entrega na origem, ETD/ETA (previsão e real), Entrada CB, Qtde. Desembarcada, Vl. Total Pedido, Status. Substitui toda a base a cada importação.',
    tabela: 'ext_fup_comex',
    limparAntes: true,
    chaveDelete: 'id',
    mapear: (l) => {
      if (!s(l['Nº do Pedido']) || !s(l['Referência'])) return null;
      return {
        cd_sequencia_embarque: s(l['Nº Sequência do Embarque']),
        cd_embarque: s(l['Embarque']),
        cd_pedido_sap: s(l['Nº do Pedido']),
        cd_material: s(l['Material']),
        cd_material_pai: s(l['Referência']),
        dt_entrega_origem: dt(l['Entrega na origem']),
        dt_previsao_embarque: dt(l['Previsão de embarque ETD']),
        dt_embarque_real: dt(l['Embarque ETD']),
        dt_previsao_atraque: dt(l['Previsão de chegada VIX ETA']),
        dt_atraque_real: dt(l['Chegada VIX ETA']),
        dt_chegada_cb: dt(l['Entrada CB']) ?? dt(l['Dt. Recebimento']),
        nr_quantidade: Number(l['Qtde. Desembarcada']) || 0,
        // "Qty de Pedido" marca a 1ª linha do pedido — evita somar o total repetido
        nr_fob_total: Number(l['Qty de Pedido']) === 1 ? Number(l['Vl. Total Pedido']) || 0 : 0,
        dc_status_comex: s(l['Status']),
      };
    },
  },
  {
    id: 'pdv_lojas',
    nome: 'PDV - Cadastro de Lojas',
    descricao: 'Colunas: CD_SAP, DC_Loja, DC_Canal, DC_GrupoLoja, DC_Franqueado, DC_UF, DC_Estado, DC_Cidade, DC_Bairro',
    tabela: 'pdv_cadastro_loja',
    limparAntes: true,
    chaveDelete: 'cd_sap',
    mapear: (l) => {
      const cd = s(l['CD_SAP'] ?? l['cd_sap']);
      if (!cd) return null;
      return {
        cd_sap: cd, dc_loja: s(l['DC_Loja']), dc_canal: s(l['DC_Canal']),
        dc_grupo_loja: s(l['DC_GrupoLoja']), dc_franqueado: s(l['DC_Franqueado']),
        dc_uf: s(l['DC_UF']), dc_estado: s(l['DC_Estado']), dc_cidade: s(l['DC_Cidade']), dc_bairro: s(l['DC_Bairro']),
      };
    },
  },
  {
    id: 'pdv_base',
    nome: 'PDV - Base Cadastro (movimentos)',
    descricao: 'Colunas: CD_SAP, DT_InicioVar, DT_FimVar, DT_InicioAtac, DT_FimAtac, DT_InicioDev, DT_FimDev, UltimoMovimento',
    tabela: 'pdv_base_cadastro',
    limparAntes: true,
    chaveDelete: 'cd_sap',
    mapear: (l) => {
      const cd = s(l['CD_SAP'] ?? l['cd_sap']);
      if (!cd) return null;
      return {
        cd_sap: cd,
        dt_inicio_var: dt(l['DT_InicioVar']), dt_fim_var: dt(l['DT_FimVar']),
        dt_inicio_atac: dt(l['DT_InicioAtac']), dt_fim_atac: dt(l['DT_FimAtac']),
        dt_inicio_dev: dt(l['DT_InicioDev']), dt_fim_dev: dt(l['DT_FimDev']),
        ultimo_movimento: dt(l['UltimoMovimento']),
      };
    },
  },
];

export default function AdminImportacoes() {
  const { usuario, registraLog } = useAuth();
  const qc = useQueryClient();
  const [importando, setImportando] = useState<string | null>(null);

  const { data: historico, isLoading } = useQuery({
    queryKey: ['importacoes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('importacoes')
        .select('*, usuario:usuarios(nome)')
        .order('criado_em', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
  });

  const importar = async (def: ImportDef, file: File) => {
    setImportando(def.id);
    try {
      const linhas = await lerPlanilha(file);
      const registros = linhas.map(def.mapear).filter(Boolean) as Record<string, any>[];
      if (registros.length === 0) throw new Error('Nenhuma linha válida — confira o layout das colunas.');
      if (def.limparAntes) {
        const { error } = await supabase.from(def.tabela).delete().not(def.chaveDelete!, 'is', null);
        if (error) throw error;
      }
      for (let i = 0; i < registros.length; i += 1000) {
        const { error } = await supabase.from(def.tabela).insert(registros.slice(i, i + 1000));
        if (error) throw error;
      }
      registraLog(`Admin - Importacao ${def.nome}`, 0, '', `${registros.length} linhas`);
      await supabase.from('importacoes').insert({
        usuario_id: usuario?.id, tipo: def.id, nome_arquivo: file.name,
        total_linhas: linhas.length, linhas_validas: registros.length,
        linhas_erro: linhas.length - registros.length, status: 'aplicado',
        aplicado_em: new Date().toISOString(),
      });
      toast.success(`${def.nome}: ${registros.length} linha(s) importada(s).`);
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setImportando(null);
    }
  };

  const colunas: Coluna<any>[] = [
    { key: 'criado_em', titulo: 'Data', render: (r) => formatDateTime(r.criado_em) },
    { key: 'tipo', titulo: 'Tipo' },
    { key: 'nome_arquivo', titulo: 'Arquivo' },
    { key: 'total_linhas', titulo: 'Linhas' },
    { key: 'linhas_validas', titulo: 'Válidas' },
    { key: 'linhas_erro', titulo: 'Erros' },
    {
      key: 'status', titulo: 'Status',
      render: (r) => <Badge variant={r.status === 'aplicado' ? 'success' : 'secondary'}>{r.status}</Badge>,
    },
    { key: 'usuario', titulo: 'Usuário', render: (r) => r.usuario?.nome ?? '' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importações</h1>
        <p className="text-sm text-muted-foreground">
          Atualização das bases externas (substitui os vínculos ODBC/rede do Access) e histórico de importações
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {IMPORTACOES.map((def) => (
          <Card key={def.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{def.nome}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              <p className="text-xs text-muted-foreground">{def.descricao}</p>
              <Button
                size="sm"
                variant="secondary"
                loading={importando === def.id}
                onClick={() => document.getElementById(`imp-${def.id}`)?.click()}
              >
                <FileUp /> Importar Excel/CSV
              </Button>
              <input
                id={`imp-${def.id}`} type="file" accept=".xlsx,.xlsb,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(def, f); e.target.value = ''; }}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Histórico</CardTitle></CardHeader>
        <CardContent className="p-3">
          <DataTable colunas={colunas} dados={historico ?? []} carregando={isLoading} rowKey={(r) => r.id} busca={false} paginacao={20} altura="400px" />
        </CardContent>
      </Card>
    </div>
  );
}
