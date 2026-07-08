/**
 * Regras de negócio portadas do VBA do SysPlan (Módulo1).
 * As mesmas regras existem em SQL (fn_tamanho_produto, fn_calc_margem) —
 * aqui são usadas para feedback imediato nos formulários.
 */

export function defineTamanhoProduto(grupo: string, medidas: string, sexo: string): string {
  if (['OCULOS', 'MULTI', 'VISTA'].includes(grupo)) {
    const partes = (medidas ?? '').replace(/#/g, '-').replace(/ /g, '-').split('-');
    const lente = parseFloat(partes[0] ?? '0') || 0;
    const ponte = parseFloat(partes[1] ?? '0') || 0;
    const lentePonte = lente < 1 || ponte < 1 || ponte > 40 ? 0 : lente + ponte;
    if (lentePonte > 0) {
      if (lentePonte <= 68) return 'P';
      if (lentePonte <= 73) return 'M';
      if (lentePonte <= 76) return 'G';
      return 'GG';
    }
    return 'N/I';
  }
  if (['RELOGIO', 'RELOGIOS', 'SMART WATCH'].includes(grupo)) {
    const medida = parseFloat(medidas) || 0;
    if (sexo === 'MASCULINO' || sexo === 'UNISSEX') {
      if (medida <= 1) return 'N/I';
      if (medida <= 36) return 'PPP';
      if (medida <= 40) return 'PP';
      if (medida <= 43) return 'P';
      if (medida <= 47) return 'M';
      if (medida <= 51) return 'G';
      return 'GG';
    }
    if (sexo === 'FEMININO') {
      if (medida <= 1) return 'N/I';
      if (medida <= 28) return 'PPP';
      if (medida <= 32) return 'PP';
      if (medida <= 36) return 'P';
      if (medida <= 40) return 'M';
      if (medida <= 43) return 'G';
      return 'GG';
    }
    return 'N/I';
  }
  return '';
}

export interface ParametroCusto {
  nr_dolar: number;
  nr_fator_imp: number;
  nr_markup: number;
  nr_valor_agregado: number;
}

export function calcMargem(fob: number, pvVarejo: number, p: ParametroCusto | null): number | null {
  if (!p || !p.nr_markup) return null;
  const atacado = pvVarejo / p.nr_markup - p.nr_valor_agregado;
  if (!atacado) return null;
  const custo = fob * p.nr_fator_imp * p.nr_dolar;
  return 1 - custo / atacado;
}

export function calcLeadTime(recebimento: string | null, revisedDelivery: string | null): number | null {
  if (!recebimento || !revisedDelivery) return null;
  const r = new Date(recebimento).getTime();
  const d = new Date(revisedDelivery).getTime();
  if (isNaN(r) || isNaN(d)) return null;
  return Math.round((r - d) / 86_400_000);
}

/** Labels dos campos Info por grupo (Campos_Info do VBA) */
export function labelsInfo(grupo: string): string[] {
  if (['VISTA', 'OCULOS', 'KIDS', 'TEEN'].includes(grupo)) {
    return ['Spring Hinge', 'Nose Pad', 'Info 3', 'Info 4', 'Info 5', 'Info 6', 'Info 7'];
  }
  if (grupo === 'MULTI') {
    return ['Spring Hinge', 'Nose Pad', 'Numero Clip on', 'Tipo Clip on', 'Info 5', 'Info 6', 'Info 7'];
  }
  if (grupo === 'RELOGIOS' || grupo === 'RELOGIO') {
    return ['Tipo Pulseira', 'Tipo Dial', 'Numero Dial', 'Tipo Visor', 'Numero CB', 'Numero Maquina', 'Codigo Maquina'];
  }
  return ['Info 1', 'Info 2', 'Info 3', 'Info 4', 'Info 5', 'Info 6', 'Info 7'];
}

/** Validação do formulário de compra (Cmd_Salvar do VBA) */
export function validaCompra(c: {
  dc_canal?: string | null;
  dc_grupo_planejamento?: string | null;
  dc_linha?: string | null;
  dc_griffe?: string | null;
  nr_fob_negociado?: number | null;
  nr_quantidade?: number | null;
  nr_preco_varejo?: number | null;
  dc_modal?: string | null;
  nr_lead_time?: number | null;
  cd_essential?: number | null;
}): string[] {
  const erros: string[] = [];
  const vazio = (v?: string | null) => !v || v === 'N/I';
  if (vazio(c.dc_canal)) erros.push('Canal não preenchido');
  if (vazio(c.dc_grupo_planejamento)) erros.push('Grupo Planejamento não preenchido');
  if (vazio(c.dc_linha)) erros.push('Linha não preenchida');
  if (vazio(c.dc_griffe)) erros.push('Griffe não preenchida');
  if (!c.nr_fob_negociado || c.nr_fob_negociado <= 0) erros.push('Fob Negociado não preenchido');
  if (!c.nr_quantidade || c.nr_quantidade <= 0) erros.push('Quantidade não preenchida');
  if (!c.nr_preco_varejo || c.nr_preco_varejo <= 0) erros.push('Preço Varejo não preenchido');
  if (vazio(c.dc_modal)) erros.push('Modal não preenchido');
  if (!c.nr_lead_time || c.nr_lead_time <= 0) erros.push('Lead Time não preenchido');
  if (c.dc_linha === 'ESSENTIAL' && !c.cd_essential) erros.push('Codigo Essential não preenchido');
  return erros;
}
