/**
 * Motor de Cálculo de Fatura de Energia Elétrica - Maricá (RJ) / Enel Distribuição Rio
 *
 * Implementa os 5 blocos documentados no agent.md e a fórmula oficial de Calculo.png:
 *
 * Valor Total = [ (Consumo_kWh * (TE + TUSD + Bandeira)) / (1 - (PIS + COFINS + ICMS_RJ)) ] + COSIP_Marica + Eventuais
 */

const DEFAULT_TARIFF_CONFIG = {
  // Identificação do perfil
  uf: 'RJ',
  municipio: 'Maricá',
  distribuidora: 'Enel Distribuição Rio',
  classe: 'Residencial B1', // Residencial B1, Residencial Baixa Renda, Comercial, Industrial, Rural
  modalidade: 'Convencional', // Convencional, Tarifa Branca, Grupo A (Alta Tensão)
  tipoLigacao: 'Bifásico', // Monofásico (30 kWh), Bifásico (50 kWh), Trifásico (100 kWh)
  aplicarCustoDisponibilidadeNoFechamento: true,

  // Calendário da conta
  diaCortePadrao: 15,
  diaVencimentoPadrao: 25,

  // 1. Consumo e Tarifas Base (R$/kWh - ANEEL / Enel RJ)
  te: 0.34582,   // Tarifa de Energia (R$/kWh sem impostos)
  tusd: 0.52841, // Tarifa de Uso do Sistema de Distribuição (R$/kWh sem impostos)

  // Tarifa Branca (multiplicadores ou valores específicos caso modalidade === 'Tarifa Branca')
  tarifaBrancaPonta: 1.48210,
  tarifaBrancaIntermediaria: 0.96420,
  tarifaBrancaForaPonta: 0.72150,

  // 2. Bandeiras Tarifárias (R$ por kWh consumido - ANEEL)
  bandeiraAtiva: 'verde', // verde, amarela, vermelha1, vermelha2
  bandeiras: {
    verde: { nome: 'Bandeira Verde', valorPor100kWh: 0.00, valorPorkWh: 0.00000 },
    amarela: { nome: 'Bandeira Amarela', valorPor100kWh: 1.885, valorPorkWh: 0.01885 },
    vermelha1: { nome: 'Bandeira Vermelha - Patamar 1', valorPor100kWh: 4.463, valorPorkWh: 0.04463 },
    vermelha2: { nome: 'Bandeira Vermelha - Patamar 2', valorPor100kWh: 7.877, valorPorkWh: 0.07877 }
  },

  // 3. Tributos Federais e Estaduais ("Cálculo Por Dentro" - em %)
  pisPercent: 1.08,    // % PIS
  cofinsPercent: 4.98, // % COFINS
  icmsModo: 'escalonado_rj', // 'escalonado_rj' (automático conforme faixa RJ) ou 'manual'
  icmsManualPercent: 18.0,   // usado quando icmsModo === 'manual'
  fecpManualPercent: 0.0,    // usado quando icmsModo === 'manual'

  // Regras escalonadas RJ (ICMS + FECP):
  // Até 50 kWh: Isento (0%)
  // De 51 a 300 kWh: 18% ICMS + 0% FECP = 18%
  // Acima de 300 kWh: 20% ICMS + 4% FECP = 24%
  faixasIcmsRj: {
    isentoAteKwh: 50,
    reduzidoAteKwh: 300,
    aliquotaReduzidaPercent: 18.0,
    aliquotaCheiaIcmsPercent: 20.0,
    aliquotaCheiaFecpPercent: 4.0
  },

  // 4. Contribuição Municipal (COSIP - Maricá - Lei Municipal nº 2.039-G/2002)
  cosipModo: 'tabela_marica', // 'tabela_marica' ou 'fixo'
  cosipValorFixo: 28.50,
  cosipIsentoBaixaRenda: true,
  tabelaCosipMarica: [
    { ateKwh: 50, valor: 0.00, descricao: 'Até 50 kWh (Isento)' },
    { ateKwh: 100, valor: 9.80, descricao: 'De 51 a 100 kWh' },
    { ateKwh: 150, valor: 16.40, descricao: 'De 101 a 150 kWh' },
    { ateKwh: 200, valor: 23.90, descricao: 'De 151 a 200 kWh' },
    { ateKwh: 300, valor: 32.50, descricao: 'De 201 a 300 kWh' },
    { ateKwh: 500, valor: 46.80, descricao: 'De 301 a 500 kWh' },
    { ateKwh: 999999, valor: 64.20, descricao: 'Acima de 500 kWh' }
  ],

  // 5. Parâmetros Específicos e Eventuais
  // 5.1 Geração Distribuída (Energia Solar / Lei 14.300)
  possuiGeracaoSolar: false,
  energiaInjetadaKwh: 0,
  creditosAcumuladosKwh: 0,
  percentualFioBTusd: 30.0, // Regra de transição Lei 14.300 (% do Fio B não compensado)

  // 5.2 Encargos por Atraso e Serviços Eventuais
  diasAtraso: 0,
  multaAtrasoPercent: 2.0,     // Limitada a 2%
  jurosMoraMensalPercent: 1.0, // 1% ao mês pro rata die (0.0333% ao dia)
  correcaoMonetariaValor: 0.0,
  taxasExtrasValor: 0.0,       // Religação, 2ª via, parcelamentos, outros
  descricaoEventuais: '',

  // 5.3 Alta Tensão (Grupo A)
  grupoAAtivo: false,
  demandaContratadaKw: 0,
  demandaMedidaKw: 0,
  tarifaDemandaPorKw: 32.50,
  energiaReativaExcedenteValor: 0.0
};

/**
 * Retorna a franquia mínima (Custo de Disponibilidade em kWh) conforme tipo de ligação.
 */
function getCustoDisponibilidadeKwh(tipoLigacao) {
  const norm = String(tipoLigacao || '').toLowerCase();
  if (norm.includes('mono')) return 30;
  if (norm.includes('tri')) return 100;
  return 50; // Bifásico padrão
}

/**
 * Determina a alíquota de ICMS + FECP do Estado do Rio de Janeiro conforme o consumo em kWh.
 */
function resolveIcmsRjPercent(consumoKwh, config) {
  const cfg = { ...DEFAULT_TARIFF_CONFIG, ...config };

  if (cfg.icmsModo === 'manual') {
    const icms = Number(cfg.icmsManualPercent) || 0;
    const fecp = Number(cfg.fecpManualPercent) || 0;
    return {
      icmsPercent: icms,
      fecpPercent: fecp,
      totalEstadualPercent: icms + fecp,
      faixaDescricao: `Manual (${(icms + fecp).toFixed(2)}%)`
    };
  }

  const faixas = cfg.faixasIcmsRj || DEFAULT_TARIFF_CONFIG.faixasIcmsRj;
  const kwh = Math.max(0, Number(consumoKwh) || 0);

  if (kwh <= faixas.isentoAteKwh) {
    return {
      icmsPercent: 0,
      fecpPercent: 0,
      totalEstadualPercent: 0,
      faixaDescricao: `Até ${faixas.isentoAteKwh} kWh (Isento - 0%)`
    };
  }

  if (kwh <= faixas.reduzidoAteKwh) {
    const red = Number(faixas.aliquotaReduzidaPercent) || 18;
    return {
      icmsPercent: red,
      fecpPercent: 0,
      totalEstadualPercent: red,
      faixaDescricao: `De ${faixas.isentoAteKwh + 1} a ${faixas.reduzidoAteKwh} kWh (${red.toFixed(1)}% s/ FECP)`
    };
  }

  const icmsCheio = Number(faixas.aliquotaCheiaIcmsPercent) || 20;
  const fecpCheio = Number(faixas.aliquotaCheiaFecpPercent) || 4;
  return {
    icmsPercent: icmsCheio,
    fecpPercent: fecpCheio,
    totalEstadualPercent: icmsCheio + fecpCheio,
    faixaDescricao: `Acima de ${faixas.reduzidoAteKwh} kWh (${icmsCheio}% ICMS + ${fecpCheio}% FECP = ${(icmsCheio + fecpCheio).toFixed(1)}%)`
  };
}

/**
 * Determina o valor da COSIP Maricá conforme consumo e classe.
 */
function resolveCosipMarica(consumoKwh, config) {
  const cfg = { ...DEFAULT_TARIFF_CONFIG, ...config };
  const kwh = Math.max(0, Number(consumoKwh) || 0);

  if (cfg.classe === 'Residencial Baixa Renda' && cfg.cosipIsentoBaixaRenda) {
    return {
      valor: 0,
      descricao: 'Isento (Residencial Baixa Renda - Legislação Municipal Maricá)'
    };
  }

  if (cfg.cosipModo === 'fixo') {
    const val = Math.max(0, Number(cfg.cosipValorFixo) || 0);
    return {
      valor: val,
      descricao: 'Valor Fixo Configurado'
    };
  }

  const tabela = Array.isArray(cfg.tabelaCosipMarica) && cfg.tabelaCosipMarica.length > 0
    ? cfg.tabelaCosipMarica
    : DEFAULT_TARIFF_CONFIG.tabelaCosipMarica;

  for (const faixa of tabela) {
    if (kwh <= Number(faixa.ateKwh)) {
      return {
        valor: Number(faixa.valor) || 0,
        descricao: faixa.descricao || `Até ${faixa.ateKwh} kWh`
      };
    }
  }

  const ultima = tabela[tabela.length - 1];
  return {
    valor: Number(ultima.valor) || 0,
    descricao: ultima.descricao || 'Faixa Superior'
  };
}

/**
 * Obtém o valor em R$/kWh da bandeira tarifária selecionada.
 */
function resolveBandeiraTarifaria(config) {
  const cfg = { ...DEFAULT_TARIFF_CONFIG, ...config };
  const chave = cfg.bandeiraAtiva || 'verde';
  const bandeiras = {
    ...DEFAULT_TARIFF_CONFIG.bandeiras,
    ...(cfg.bandeiras || {})
  };
  const selecionada = bandeiras[chave] || bandeiras.verde;

  // Se o usuário editou valorPor100kWh, sincronizamos valorPorkWh
  let valorPorkWh = Number(selecionada.valorPorkWh);
  if (Number.isNaN(valorPorkWh) && selecionada.valorPor100kWh !== undefined) {
    valorPorkWh = Number(selecionada.valorPor100kWh) / 100;
  }

  return {
    codigo: chave,
    nome: selecionada.nome || 'Bandeira Verde',
    valorPorkWh: Math.max(0, valorPorkWh || 0),
    valorPor100kWh: Math.max(0, (valorPorkWh || 0) * 100)
  };
}

/**
 * Calcula a fatura completa para um determinado consumo em kWh e configuração do período.
 *
 * Fórmula:
 * Valor Total = [ (Consumo (kWh) * (TE + TUSD + Bandeira)) / (1 - (PIS + COFINS + ICMS_RJ)) ] + COSIP_Marica + Eventuais
 *
 * @param {number} consumoMedidoKwh Consumo medido em kWh
 * @param {object} config Configurações tarifárias do período
 * @param {object} options Opções extras (ex: { aplicarMinimoDisponibilidade: false, energiaInjetadaExtraKwh: 0 })
 */
function calculateInvoice(consumoMedidoKwh, config = {}, options = {}) {
  const cfg = { ...DEFAULT_TARIFF_CONFIG, ...config };
  const consumoRealKwh = Math.max(0, Number(consumoMedidoKwh) || 0);

  // 1. Custo de Disponibilidade (Taxa Mínima: 30 / 50 / 100 kWh)
  const minimoDisponibilidadeKwh = getCustoDisponibilidadeKwh(cfg.tipoLigacao);
  const aplicarMinimo = options.aplicarMinimoDisponibilidade !== undefined
    ? Boolean(options.aplicarMinimoDisponibilidade)
    : false;

  // Quando aplicarMinimo está ativo, o consumo faturado começa no mínimo de disponibilidade
  // (30/50/100 kWh) desde o início do período (mesmo com 0 kWh medidos) e cresce em tempo real
  // assim que o consumo acumulado ultrapassa o limite mínimo.
  let consumoFaturadoKwh = aplicarMinimo
    ? Math.max(consumoRealKwh, minimoDisponibilidadeKwh)
    : consumoRealKwh;

  // Desconto social Baixa Renda (quando aplicável e selecionado)
  let fatorClasse = 1.0;
  if (cfg.classe === 'Residencial Baixa Renda') {
    // Desconto médio ponderado da Tarifa Social ANEEL até 220 kWh
    if (consumoFaturadoKwh <= 30) fatorClasse = 0.35;
    else if (consumoFaturadoKwh <= 100) fatorClasse = 0.60;
    else if (consumoFaturadoKwh <= 220) fatorClasse = 0.90;
  }

  // Tarifas TE e TUSD
  const teUnitario = (Number(cfg.te) || 0) * fatorClasse;
  const tusdUnitario = (Number(cfg.tusd) || 0) * fatorClasse;

  // 2. Bandeira Tarifária
  const bandeira = resolveBandeiraTarifaria(cfg);
  const bandeiraUnitario = bandeira.valorPorkWh;

  // 3. Geração Distribuída (Solar / Lei 14.300)
  let kwhCompensadoSolar = 0;
  let descontoSolarBase = 0;
  const injetadaTotalKwh = (cfg.possuiGeracaoSolar ? (Number(cfg.energiaInjetadaKwh) || 0) + (Number(cfg.creditosAcumuladosKwh) || 0) : 0)
    + (Number(options.energiaInjetadaExtraKwh) || 0);

  if (cfg.possuiGeracaoSolar && injetadaTotalKwh > 0) {
    const limiteCompensavel = Math.max(0, consumoFaturadoKwh - minimoDisponibilidadeKwh);
    kwhCompensadoSolar = Math.min(limiteCompensavel, injetadaTotalKwh);
    const percentualFioB = Math.min(100, Math.max(0, Number(cfg.percentualFioBTusd) || 0)) / 100;
    // Energia compensada abate 100% da TE + Bandeira e (1 - percentualFioB) da TUSD
    const tarifaCompensadaPorKwh = teUnitario + bandeiraUnitario + (tusdUnitario * (1 - percentualFioB));
    descontoSolarBase = kwhCompensadoSolar * tarifaCompensadaPorKwh;
  }

  // Custo Base (Sem Tributos)
  const custoTeBase = consumoFaturadoKwh * teUnitario;
  const custoTusdBase = consumoFaturadoKwh * tusdUnitario;
  const custoBandeiraBase = consumoFaturadoKwh * bandeiraUnitario;
  const tarifaUnitariaBaseSoma = teUnitario + tusdUnitario + bandeiraUnitario;

  const subtotalEnergiaBase = Math.max(0, (consumoFaturadoKwh * tarifaUnitariaBaseSoma) - descontoSolarBase);

  // 4. Tributos "Por Dentro" (PIS + COFINS + ICMS_RJ)
  const pisPercent = Math.max(0, Number(cfg.pisPercent) || 0);
  const cofinsPercent = Math.max(0, Number(cfg.cofinsPercent) || 0);
  const icmsInfo = resolveIcmsRjPercent(consumoFaturadoKwh, cfg);

  const somaAliquotasPercent = pisPercent + cofinsPercent + icmsInfo.totalEstadualPercent;
  // Proteção matemática caso o usuário digite alíquotas >= 95%
  const aliquotaTotalDecimal = Math.min(0.95, Math.max(0, somaAliquotasPercent / 100));
  const divisorPorDentro = 1 - aliquotaTotalDecimal;

  // Aplicação exata da fórmula de Calculo.png:
  // Bloco Energia Tributada = [ Consumo * (TE + TUSD + Bandeira) ] / [ 1 - (PIS + COFINS + ICMS_RJ) ]
  const valorEnergiaComTributos = subtotalEnergiaBase / divisorPorDentro;
  const valorTotalTributosPorDentro = valorEnergiaComTributos - subtotalEnergiaBase;

  // Parcela individual de cada tributo por dentro
  const valorPis = valorEnergiaComTributos * (pisPercent / 100);
  const valorCofins = valorEnergiaComTributos * (cofinsPercent / 100);
  const valorIcms = valorEnergiaComTributos * (icmsInfo.icmsPercent / 100);
  const valorFecp = valorEnergiaComTributos * (icmsInfo.fecpPercent / 100);

  const tarifaEfetivaPorKwh = tarifaUnitariaBaseSoma / divisorPorDentro;

  // 5. COSIP Maricá
  const cosipInfo = resolveCosipMarica(consumoFaturadoKwh, cfg);
  const valorCosip = (consumoFaturadoKwh === 0 && !aplicarMinimo) ? 0 : cosipInfo.valor;

  // 6. Parâmetros Específicos e Eventuais
  // 6.1 Alta Tensão (Grupo A)
  let valorGrupoADemanda = 0;
  if (cfg.grupoAAtivo) {
    const demandaContratada = Math.max(0, Number(cfg.demandaContratadaKw) || 0);
    const demandaMedida = Math.max(0, Number(cfg.demandaMedidaKw) || 0);
    const tarifaDemanda = Math.max(0, Number(cfg.tarifaDemandaPorKw) || 0);
    const demandaFaturada = Math.max(demandaContratada, demandaMedida);
    // Ultrapassagem (> 5% da contratada paga tarifa adicional)
    const excedenteKw = demandaMedida > demandaContratada * 1.05
      ? demandaMedida - demandaContratada
      : 0;
    const reativa = Math.max(0, Number(cfg.energiaReativaExcedenteValor) || 0);
    valorGrupoADemanda = (demandaFaturada * tarifaDemanda) + (excedenteKw * tarifaDemanda * 2) + reativa;
  }

  // 6.2 Encargos por atraso e taxas extras
  const taxasExtras = Math.max(0, Number(cfg.taxasExtrasValor) || 0);
  const correcaoMonetaria = Math.max(0, Number(cfg.correcaoMonetariaValor) || 0);
  const baseAntesAtraso = valorEnergiaComTributos + valorCosip + valorGrupoADemanda + taxasExtras;

  const diasAtraso = Math.max(0, parseInt(cfg.diasAtraso, 10) || 0);
  let valorMulta = 0;
  let valorJurosMora = 0;
  if (diasAtraso > 0 && baseAntesAtraso > 0) {
    const multaPct = Math.min(2.0, Math.max(0, Number(cfg.multaAtrasoPercent) || 0));
    const jurosMensalPct = Math.max(0, Number(cfg.jurosMoraMensalPercent) || 0);
    valorMulta = baseAntesAtraso * (multaPct / 100);
    valorJurosMora = baseAntesAtraso * ((jurosMensalPct / 100) * (diasAtraso / 30));
  }

  const valorEventuaisTotal = valorGrupoADemanda + taxasExtras + correcaoMonetaria + valorMulta + valorJurosMora;

  // Valor Total da Fatura
  const valorTotalFatura = valorEnergiaComTributos + valorCosip + valorEventuaisTotal;

  return {
    consumoRealKwh: round2(consumoRealKwh),
    consumoFaturadoKwh: round2(consumoFaturadoKwh),
    minimoDisponibilidadeKwh,
    aplicouCustoDisponibilidade: consumoFaturadoKwh > consumoRealKwh,

    tarifasUnitarias: {
      te: round5(teUnitario),
      tusd: round5(tusdUnitario),
      bandeira: round5(bandeiraUnitario),
      somaBase: round5(tarifaUnitariaBaseSoma),
      tarifaEfetivaComImpostos: round5(tarifaEfetivaPorKwh)
    },

    bandeira: {
      codigo: bandeira.codigo,
      nome: bandeira.nome,
      valorPorkWh: round5(bandeira.valorPorkWh),
      valorPor100kWh: round2(bandeira.valorPor100kWh),
      custoBase: round2(custoBandeiraBase)
    },

    energiaBase: {
      custoTe: round2(custoTeBase),
      custoTusd: round2(custoTusdBase),
      custoBandeira: round2(custoBandeiraBase),
      kwhCompensadoSolar: round2(kwhCompensadoSolar),
      descontoSolarBase: round2(descontoSolarBase),
      subtotalSemTributos: round2(subtotalEnergiaBase)
    },

    tributosPorDentro: {
      pisPercent: round2(pisPercent),
      cofinsPercent: round2(cofinsPercent),
      icmsPercent: round2(icmsInfo.icmsPercent),
      fecpPercent: round2(icmsInfo.fecpPercent),
      totalEstadualPercent: round2(icmsInfo.totalEstadualPercent),
      faixaIcmsDescricao: icmsInfo.faixaDescricao,
      somaAliquotasPercent: round2(somaAliquotasPercent),
      divisorPorDentro: round5(divisorPorDentro),
      valorPis: round2(valorPis),
      valorCofins: round2(valorCofins),
      valorIcms: round2(valorIcms),
      valorFecp: round2(valorFecp),
      valorTotalTributos: round2(valorTotalTributosPorDentro)
    },

    blocoEnergiaTributada: round2(valorEnergiaComTributos),

    cosipMarica: {
      valor: round2(valorCosip),
      descricao: cosipInfo.descricao
    },

    eventuais: {
      valorGrupoADemanda: round2(valorGrupoADemanda),
      taxasExtras: round2(taxasExtras),
      correcaoMonetaria: round2(correcaoMonetaria),
      diasAtraso,
      valorMulta: round2(valorMulta),
      valorJurosMora: round2(valorJurosMora),
      totalEventuais: round2(valorEventuaisTotal),
      descricao: cfg.descricaoEventuais || ''
    },

    valorTotalFatura: round2(valorTotalFatura)
  };
}

/**
 * Calcula o resumo completo de um período/ciclo de faturamento a partir de suas leituras diárias.
 *
 * Cada período possui:
 * - leituraInicialMedidor (kWh no início do ciclo / corte anterior)
 * - leituras: lista de registros { date: 'YYYY-MM-DD', meterValue: number, isCutoff: boolean, solarInjectedKwh?: number, notes?: string }
 * - config: snapshot das tarifas do período
 */
function calculatePeriodSummary(period) {
  const cfg = { ...DEFAULT_TARIFF_CONFIG, ...(period.config || {}) };
  const sortedReadings = [...(period.readings || [])]
    .filter(r => r && r.date && r.meterValue !== null && r.meterValue !== undefined && r.meterValue !== '')
    .map(r => ({
      ...r,
      meterValue: Number(r.meterValue),
      solarInjectedKwh: Number(r.solarInjectedKwh || 0),
      isCutoff: Boolean(r.isCutoff)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Determina a leitura base do período:
  // Se period.initialMeterValue foi definido, usa ele; caso contrário usa a primeira leitura do período.
  const hasExplicitInitial = period.initialMeterValue !== null
    && period.initialMeterValue !== undefined
    && period.initialMeterValue !== ''
    && !Number.isNaN(Number(period.initialMeterValue));

  const baseMeterValue = hasExplicitInitial
    ? Number(period.initialMeterValue)
    : (sortedReadings.length > 0 ? sortedReadings[0].meterValue : 0);

  // Calcula a diferença dia a dia (consumo diário entre leituras consecutivas)
  let previousMeter = baseMeterValue;
  let previousDate = period.startDate || (sortedReadings[0] ? sortedReadings[0].date : null);
  const dailyBreakdown = [];
  let totalSolarInjectedReadings = 0;
  let cutoffReading = null;

  sortedReadings.forEach((reading, idx) => {
    let deltaKwh = 0;
    if (idx === 0 && !hasExplicitInitial) {
      deltaKwh = 0; // Primeira marcação serve de referência inicial quando não há leitura anterior
    } else {
      deltaKwh = Math.max(0, reading.meterValue - previousMeter);
    }

    const daysElapsed = previousDate ? Math.max(1, diffDays(previousDate, reading.date)) : 1;
    const avgDailyInInterval = deltaKwh / daysElapsed;

    totalSolarInjectedReadings += reading.solarInjectedKwh;
    const accumulatedKwh = Math.max(0, reading.meterValue - baseMeterValue);

    const dailyItem = {
      date: reading.date,
      meterValue: round2(reading.meterValue),
      previousMeterValue: round2(previousMeter),
      deltaKwh: round2(deltaKwh),
      daysSincePreviousReading: daysElapsed,
      avgDailyKwh: round2(avgDailyInInterval),
      accumulatedKwh: round2(accumulatedKwh),
      isCutoff: reading.isCutoff,
      solarInjectedKwh: round2(reading.solarInjectedKwh),
      notes: reading.notes || ''
    };

    if (reading.isCutoff) {
      cutoffReading = dailyItem;
    }

    dailyBreakdown.push(dailyItem);
    previousMeter = reading.meterValue;
    previousDate = reading.date;
  });

  const latestReading = dailyBreakdown.length > 0 ? dailyBreakdown[dailyBreakdown.length - 1] : null;
  // Se houver um dia marcado como Dia de Corte, o consumo oficial do fechamento vai até o Dia de Corte
  const effectiveEndReading = cutoffReading || latestReading;
  const consumoAcumuladoKwh = effectiveEndReading ? effectiveEndReading.accumulatedKwh : 0;

  // Quantidade de dias decorridos no período
  let diasDecorridos = 0;
  if (dailyBreakdown.length > 0) {
    const firstDate = period.startDate || dailyBreakdown[0].date;
    const lastDate = effectiveEndReading.date;
    diasDecorridos = Math.max(1, diffDays(firstDate, lastDate) || dailyBreakdown.length);
  }

  const mediaDiariaKwh = diasDecorridos > 0 ? consumoAcumuladoKwh / diasDecorridos : 0;

  // Projeção para o fechamento (30 dias padrão do ciclo ou até a data prevista de corte)
  let diasTotaisCiclo = 30;
  if (period.startDate && period.expectedCutoffDate) {
    diasTotaisCiclo = Math.max(1, diffDays(period.startDate, period.expectedCutoffDate));
  }
  const consumoProjetadoCorteKwh = cutoffReading
    ? consumoAcumuladoKwh
    : Math.max(consumoAcumuladoKwh, mediaDiariaKwh * diasTotaisCiclo);

  // Cálculo da fatura em tempo real: aplica o valor mínimo (Custo de Disponibilidade) desde o início do período
  // e atualiza em tempo real conforme as leituras do medidor ultrapassam a franquia mínima.
  const isClosedAtCutoff = Boolean(cutoffReading) || Boolean(period.isClosed);
  const aplicarMinimoTempoReal = cfg.aplicarCustoDisponibilidadeNoFechamento !== false;

  const faturaAtual = calculateInvoice(consumoAcumuladoKwh, cfg, {
    aplicarMinimoDisponibilidade: aplicarMinimoTempoReal,
    energiaInjetadaExtraKwh: totalSolarInjectedReadings
  });

  // Cálculo da fatura projetada no dia do corte/vencimento
  const faturaProjetada = calculateInvoice(consumoProjetadoCorteKwh, cfg, {
    aplicarMinimoDisponibilidade: aplicarMinimoTempoReal,
    energiaInjetadaExtraKwh: totalSolarInjectedReadings
  });

  // Preenche o custo estimado de cada leitura diária usando a tarifa efetiva com impostos do período
  const tarifaEfetiva = faturaAtual.tarifasUnitarias.tarifaEfetivaComImpostos;
  dailyBreakdown.forEach(item => {
    item.estimatedDailyCostBRL = round2(item.deltaKwh * tarifaEfetiva);
  });

  return {
    periodId: period.id,
    periodName: period.name,
    startDate: period.startDate,
    expectedCutoffDate: period.expectedCutoffDate,
    dueDate: period.dueDate,
    isClosed: isClosedAtCutoff,
    cutoffDate: cutoffReading ? cutoffReading.date : (period.cutoffDate || null),
    baseMeterValue: round2(baseMeterValue),
    latestMeterValue: latestReading ? latestReading.meterValue : round2(baseMeterValue),
    cutoffMeterValue: cutoffReading ? cutoffReading.meterValue : null,
    consumoAcumuladoKwh: round2(consumoAcumuladoKwh),
    diasDecorridos,
    diasTotaisCiclo,
    mediaDiariaKwh: round2(mediaDiariaKwh),
    consumoProjetadoCorteKwh: round2(consumoProjetadoCorteKwh),
    faturaAtual,
    faturaProjetada,
    dailyBreakdown
  };
}

function diffDays(dateStrA, dateStrB) {
  const a = new Date(`${dateStrA}T00:00:00Z`);
  const b = new Date(`${dateStrB}T00:00:00Z`);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function round5(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100000) / 100000;
}

module.exports = {
  DEFAULT_TARIFF_CONFIG,
  getCustoDisponibilidadeKwh,
  resolveIcmsRjPercent,
  resolveCosipMarica,
  resolveBandeiraTarifaria,
  calculateInvoice,
  calculatePeriodSummary
};
