/**
 * Suite de Testes Automatizados — Motor de Cálculo Maricá / Enel RJ e Persistência em Arquivos
 * Pode ser executado com `node test/calculator.test.js`
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DEFAULT_TARIFF_CONFIG,
  calculateInvoice,
  calculatePeriodSummary,
  resolveIcmsRjPercent,
  resolveCosipMarica
} = require('../src/main/calculator');
const { FileStorage } = require('../src/main/storage');

console.log('Iniciando testes do motor de cálculo Whattz (Maricá / Enel RJ)...');

// 1. Teste de Escalonamento ICMS + FECP do Rio de Janeiro
{
  const faixaIsenta = resolveIcmsRjPercent(45, DEFAULT_TARIFF_CONFIG);
  assert.strictEqual(faixaIsenta.totalEstadualPercent, 0, 'Até 50 kWh deve ser isento de ICMS RJ');

  const faixaReduzida = resolveIcmsRjPercent(220, DEFAULT_TARIFF_CONFIG);
  assert.strictEqual(faixaReduzida.icmsPercent, 18, 'De 51 a 300 kWh deve ter 18% de ICMS RJ');
  assert.strictEqual(faixaReduzida.fecpPercent, 0, 'De 51 a 300 kWh não deve ter adicional FECP');

  const faixaCheia = resolveIcmsRjPercent(350, DEFAULT_TARIFF_CONFIG);
  assert.strictEqual(faixaCheia.icmsPercent, 20, 'Acima de 300 kWh deve ter 20% de ICMS RJ');
  assert.strictEqual(faixaCheia.fecpPercent, 4, 'Acima de 300 kWh deve ter 4% de FECP RJ');
  assert.strictEqual(faixaCheia.totalEstadualPercent, 24, 'Acima de 300 kWh total estadual deve ser 24%');
}

// 2. Teste Exato da Fórmula de Calculo.png
// Valor Total = [ Consumo * (TE + TUSD + Bandeira) / (1 - (PIS + COFINS + ICMS_RJ)) ] + COSIP_Marica + Eventuais
{
  const cfg = {
    ...DEFAULT_TARIFF_CONFIG,
    te: 0.35,
    tusd: 0.55,
    bandeiraAtiva: 'amarela',
    bandeiras: {
      ...DEFAULT_TARIFF_CONFIG.bandeiras,
      amarela: { nome: 'Bandeira Amarela', valorPorkWh: 0.02, valorPor100kWh: 2.0 }
    },
    pisPercent: 1.0,
    cofinsPercent: 5.0,
    icmsModo: 'escalonado_rj',
    cosipModo: 'fixo',
    cosipValorFixo: 25.00,
    taxasExtrasValor: 5.00
  };

  // Consumo = 200 kWh -> ICMS RJ = 18% (entre 51 e 300 kWh)
  // Soma tarifas unitárias = 0.35 + 0.55 + 0.02 = 0.92 R$/kWh
  // Numerador = 200 * 0.92 = 184.00
  // Denominador = 1 - (0.01 + 0.05 + 0.18) = 1 - 0.24 = 0.76
  // Bloco Energia Tributada = 184.00 / 0.76 = 242.10526 -> R$ 242.11
  // Total = 242.10526 + 25.00 (COSIP) + 5.00 (Eventuais) = R$ 272.11
  const res = calculateInvoice(200, cfg);
  assert.strictEqual(res.blocoEnergiaTributada, 242.11);
  assert.strictEqual(res.cosipMarica.valor, 25.00);
  assert.strictEqual(res.eventuais.totalEventuais, 5.00);
  assert.strictEqual(res.valorTotalFatura, 272.11);
}

// 3. Teste de Diferença de Leituras Diárias e Marcação de Dia do Corte
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whattz-test-'));
  const storage = new FileStorage(tmpDir);
  const state0 = storage.getFullState();
  const periodId = state0.activePeriodId;

  storage.updatePeriodMetadata(periodId, {
    startDate: '2026-11-01',
    expectedCutoffDate: '2026-11-30',
    initialMeterValue: 1000
  });

  storage.upsertReading(periodId, { date: '2026-11-01', meterValue: 1010, isCutoff: false });
  storage.upsertReading(periodId, { date: '2026-11-02', meterValue: 1025, isCutoff: false });
  const stateAfter = storage.upsertReading(periodId, { date: '2026-11-03', meterValue: 1040, isCutoff: true });

  assert.strictEqual(stateAfter.activeSummary.consumoAcumuladoKwh, 40, 'Diferença entre 1040 e base 1000 deve ser 40 kWh');
  assert.strictEqual(stateAfter.activeSummary.isClosed, true, 'Marcar dia do corte deve fechar o cálculo oficial no corte');
  assert.strictEqual(stateAfter.activeSummary.dailyBreakdown.length, 3);
  assert.strictEqual(stateAfter.activeSummary.dailyBreakdown[1].deltaKwh, 15, 'Diferença entre dia 01 (1010) e dia 02 (1025) deve ser 15 kWh');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('✅ Todos os testes passaram com sucesso!');
