/**
 * Controlador Frontend (Renderer) — Whattz E360
 * Gerencia a interface, leituras do medidor, gráficos em kWh e configurações tarifárias (Maricá / Enel RJ).
 */

const api = window.whattzAPI || {
  async _post(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na requisição');
    return data;
  },
  getState: () => api._post('/api/getState'),
  setActivePeriod: (periodId) => api._post('/api/setActivePeriod', { periodId }),
  upsertReading: (periodId, reading) => api._post('/api/upsertReading', { periodId, reading }),
  deleteReading: (periodId, date) => api._post('/api/deleteReading', { periodId, date }),
  updatePeriodMetadata: (periodId, metadata) => api._post('/api/updatePeriodMetadata', { periodId, metadata }),
  createNewPeriod: (payload) => api._post('/api/createNewPeriod', payload),
  updateTariffConfig: (periodId, config, applyAsGlobalDefault = true) =>
    api._post('/api/updateTariffConfig', { periodId, config, applyAsGlobalDefault }),
  loadSampleData: () => api._post('/api/loadSampleData'),
  exportBackup: async () => {
    const res = await api._post('/api/exportBackup');
    if (res.json) {
      const blob = new Blob([res.json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `whattz-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    }
    return res;
  },
  importBackup: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ imported: false });
        const rawJson = await file.text();
        const res = await api._post('/api/importBackup', { rawJson });
        resolve(res);
      };
      input.click();
    });
  }
};

let appState = null;
let activeView = 'dashboard';
let activeChartMode = 'daily';
let heroChartRenderer = null;
let analyticsChartRenderer = null;

document.addEventListener('DOMContentLoaded', async () => {
  heroChartRenderer = new window.ConsumptionChartRenderer('heroAreaChartCanvas');
  analyticsChartRenderer = new window.ConsumptionChartRenderer('consumptionChartCanvas');
  bindNavigation();
  bindEvents();
  await refreshState();

  window.addEventListener('resize', () => {
    if (!appState) return;
    if (activeView === 'dashboard') {
      heroChartRenderer.renderSmoothAreaChart(appState.charts.daily || []);
    } else if (activeView === 'charts') {
      renderChartsView();
    }
  });
});

async function refreshState() {
  try {
    appState = await api.getState();
    // Se não houver leituras ainda na primeira abertura, carrega os dados de exemplo para exibir as curvas de imediato
    if (appState.activeSummary.dailyBreakdown.length === 0 && appState.periodsList.length === 1) {
      appState = await api.loadSampleData();
    }
    renderAll();
  } catch (err) {
    showToast(`Erro ao carregar dados: ${err.message}`, true);
  }
}

function switchView(viewName) {
  activeView = viewName;

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  document.querySelectorAll('.pill-tab').forEach(p => {
    p.classList.toggle('active', p.dataset.viewJump === viewName);
  });

  document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.remove('hidden');

  if (appState) {
    if (viewName === 'dashboard') {
      heroChartRenderer.renderSmoothAreaChart(appState.charts.daily || []);
    } else if (viewName === 'charts') {
      renderChartsView();
    }
  }
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('.pill-tab').forEach(pill => {
    pill.addEventListener('click', () => switchView(pill.dataset.viewJump));
  });

  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeChartMode = tab.dataset.chartMode;
      renderChartsView();
    });
  });
}

function bindEvents() {
  document.getElementById('periodSelect').addEventListener('change', async (e) => {
    try {
      appState = await api.setActivePeriod(e.target.value);
      renderAll();
      showToast('Período selecionado alterado.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  const chkCutoff = document.getElementById('inputIsCutoff');
  const nextPeriodBox = document.getElementById('nextPeriodOptions');
  chkCutoff.addEventListener('change', () => {
    nextPeriodBox.classList.toggle('hidden', !chkCutoff.checked);
  });

  document.getElementById('readingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const reading = {
        date: document.getElementById('inputReadingDate').value,
        meterValue: Number(document.getElementById('inputMeterValue').value),
        solarInjectedKwh: Number(document.getElementById('inputSolarInjected').value || 0),
        notes: document.getElementById('inputReadingNotes').value,
        isCutoff: document.getElementById('inputIsCutoff').checked,
        closePeriodOnCutoff: document.getElementById('inputIsCutoff').checked,
        startNextPeriod: document.getElementById('inputIsCutoff').checked
          && document.getElementById('inputStartNextPeriod').checked
      };

      appState = await api.upsertReading(appState.activePeriodId, reading);
      renderAll();
      showToast(`Leitura de ${formatDateBR(reading.date)} (${formatNumber(reading.meterValue)} kWh) salva!`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btnResetReadingForm').addEventListener('click', () => {
    setDefaultReadingFormValues();
  });

  document.getElementById('chkShowOnlyRecorded').addEventListener('change', () => {
    renderDailyGrid();
  });

  document.getElementById('cfgIcmsModo').addEventListener('change', (e) => {
    const isManual = e.target.value === 'manual';
    document.getElementById('icmsEscalonadoBox').classList.toggle('hidden', isManual);
    document.getElementById('icmsManualBox').classList.toggle('hidden', !isManual);
  });

  document.getElementById('tariffConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const newCfg = collectTariffConfigFromForm();
      const applyGlobal = document.getElementById('chkApplyGlobalDefault').checked;
      appState = await api.updateTariffConfig(appState.activePeriodId, newCfg, applyGlobal);
      renderAll();
      showToast('Configurações de tarifas, tributos e COSIP Maricá salvas no período!');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btnEditPeriodMeta').addEventListener('click', () => openPeriodModal('edit'));
  document.getElementById('btnNewPeriod').addEventListener('click', () => openPeriodModal('create'));
  document.getElementById('btnClosePeriodModal').addEventListener('click', closePeriodModal);
  document.getElementById('btnCancelPeriodModal').addEventListener('click', closePeriodModal);

  document.getElementById('periodMetaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const mode = document.getElementById('modalPeriodMode').value;
      const payload = {
        name: document.getElementById('modalPeriodName').value,
        startDate: document.getElementById('modalStartDate').value,
        expectedCutoffDate: document.getElementById('modalCutoffDate').value,
        dueDate: document.getElementById('modalDueDate').value,
        initialMeterValue: document.getElementById('modalInitialMeter').value
      };

      if (mode === 'create') {
        appState = await api.createNewPeriod(payload);
        showToast('Novo ciclo/período de faturamento criado!');
      } else {
        appState = await api.updatePeriodMetadata(appState.activePeriodId, payload);
        showToast('Datas e leitura base do período atualizadas!');
      }
      closePeriodModal();
      renderAll();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btnLoadSample').addEventListener('click', async () => {
    try {
      appState = await api.loadSampleData();
      renderAll();
      showToast('Dados de exemplo carregados (Maricá / Enel RJ)!');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btnExportBackup').addEventListener('click', async () => {
    try {
      const res = await api.exportBackup();
      if (res && res.exported) showToast('Backup JSON exportado com sucesso!');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btnImportBackup').addEventListener('click', async () => {
    try {
      const res = await api.importBackup();
      if (res && res.imported && res.state) {
        appState = res.state;
        renderAll();
        showToast('Backup importado com sucesso!');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function renderAll() {
  if (!appState) return;
  renderTopControls();
  renderFiveKpisAndWidgets();
  renderDailyGrid();
  populateSettingsForm();

  if (activeView === 'dashboard') {
    heroChartRenderer.renderSmoothAreaChart(appState.charts.daily || []);
  } else if (activeView === 'charts') {
    renderChartsView();
  }
}

function renderTopControls() {
  const { periodsList, activePeriod, activeSummary, storageFilePath } = appState;
  const select = document.getElementById('periodSelect');
  select.innerHTML = '';

  periodsList.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${formatNumber(p.consumoAcumuladoKwh)} kWh`;
    if (p.id === activePeriod.id) opt.selected = true;
    select.appendChild(opt);
  });

  const statusBadge = document.getElementById('periodStatusBadge');
  if (activeSummary.isClosed) {
    statusBadge.textContent = `Fechado no Corte (${formatDateBR(activeSummary.cutoffDate || activePeriod.expectedCutoffDate)})`;
    statusBadge.className = 'badge-pill status-closed';
  } else {
    statusBadge.textContent = 'Ciclo em Andamento';
    statusBadge.className = 'badge-pill status-open';
  }

  document.getElementById('storagePathLabel').textContent = storageFilePath || 'whattz-data.json';
  document.getElementById('topFlagBadge').textContent = activeSummary.faturaAtual.bandeira.nome.replace('Bandeira ', '');
  document.getElementById('topStartDate').textContent = formatDateBR(activePeriod.startDate);
  document.getElementById('topCutoffDate').textContent = formatDateBR(activeSummary.cutoffDate || activePeriod.expectedCutoffDate);
  document.getElementById('topDueDate').textContent = formatDateBR(activePeriod.dueDate);
}

function renderFiveKpisAndWidgets() {
  const { activeSummary, dailyGrid } = appState;
  const fatura = activeSummary.faturaAtual;
  const projetada = activeSummary.faturaProjetada;

  // 5 Cards KPI Superiores
  document.getElementById('kpiAccumulatedKwh').textContent = formatNumber(activeSummary.consumoAcumuladoKwh);
  document.getElementById('kpiBaseMeter').textContent = `${formatNumber(activeSummary.baseMeterValue)} kWh`;

  document.getElementById('kpiLatestMeter').textContent = formatNumber(activeSummary.latestMeterValue);
  document.getElementById('kpiAvgDailyKwh').textContent = `${formatNumber(activeSummary.mediaDiariaKwh)} kWh/dia`;
  document.getElementById('kpiDaysElapsed').textContent = activeSummary.diasDecorridos;

  document.getElementById('kpiCurrentCostBRL').textContent = formatCurrency(fatura.valorTotalFatura);
  document.getElementById('kpiEffectiveRate').textContent = `${formatCurrency(fatura.tarifasUnitarias.tarifaEfetivaComImpostos)}/kWh`;

  document.getElementById('kpiProjectedCostBRL').textContent = formatCurrency(projetada.valorTotalFatura);
  document.getElementById('kpiProjectedKwh').textContent = `${formatNumber(activeSummary.consumoProjetadoCorteKwh)} kWh`;

  const totalImpostosECosip = fatura.tributosPorDentro.valorTotalTributos + fatura.cosipMarica.valor;
  document.getElementById('kpiTaxesAndCosipBRL').textContent = formatCurrency(totalImpostosECosip);
  document.getElementById('kpiIcmsBandTag').textContent =
    `ICMS RJ ${fatura.tributosPorDentro.totalEstadualPercent}% | COSIP ${formatCurrency(fatura.cosipMarica.valor)}`;

  // Card Central Inferior: Heatmap do Ciclo + Mini Barras
  document.getElementById('badgeCurrentKwh').textContent = `${formatNumber(activeSummary.consumoAcumuladoKwh)} kWh`;
  document.getElementById('badgeProjectedKwh').textContent = `${formatNumber(activeSummary.consumoProjetadoCorteKwh)} kWh`;

  const heatmapContainer = document.getElementById('periodHeatmapGrid');
  heatmapContainer.innerHTML = '';
  const recordedDeltas = dailyGrid.filter(d => d.hasReading).map(d => Number(d.deltaKwh) || 0);
  const maxDelta = Math.max(...recordedDeltas, 1);

  dailyGrid.slice(0, 35).forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    if (day.isCutoff) cell.classList.add('cutoff-cell');

    const dayNum = day.date.slice(8, 10) + '/' + day.date.slice(5, 7);
    if (!day.hasReading) {
      cell.style.backgroundColor = '#f1f5f9';
      cell.style.color = '#94a3b8';
      cell.title = `${formatDateBR(day.date)} — Sem leitura (Clique para registrar)`;
      cell.innerHTML = `<span>${dayNum}</span>`;
    } else {
      const ratio = Math.min(1, Math.max(0.15, (Number(day.deltaKwh) || 0) / maxDelta));
      cell.style.backgroundColor = `rgba(59, 110, 76, ${ratio.toFixed(2)})`;
      cell.style.color = ratio > 0.52 ? '#ffffff' : '#1e293b';
      cell.title = `${formatDateBR(day.date)}: +${formatNumber(day.deltaKwh)} kWh (Medidor: ${formatNumber(day.meterValue)} kWh)`;
      cell.innerHTML = `<span>${dayNum}</span>`;
    }

    cell.addEventListener('click', () => loadDayIntoForm(day.date));
    heatmapContainer.appendChild(cell);
  });

  // Mini barras comparativas dos últimos 7 dias registrados
  const miniBarsContainer = document.getElementById('miniDailyBars');
  miniBarsContainer.innerHTML = '';
  const recentDays = (activeSummary.dailyBreakdown || []).slice(-7);
  const maxRecent = Math.max(...recentDays.map(d => d.deltaKwh), 1);

  recentDays.forEach((d, idx) => {
    const hPct = Math.max(8, Math.round((d.deltaKwh / maxRecent) * 48));
    const col = document.createElement('div');
    col.className = 'mini-bar-col';
    col.innerHTML = `
      <span class="mini-bar-val">${d.deltaKwh.toFixed(1)}</span>
      <div class="mini-bar-fill" style="height:${hPct}px; background:${idx % 2 === 0 ? '#3b6e4c' : '#8fb198'}"></div>
      <span class="mini-bar-lbl">${d.date.slice(8, 10)}/${d.date.slice(5, 7)}</span>
    `;
    miniBarsContainer.appendChild(col);
  });

  // Card Direito Inferior: Barras Horizontais da Composição da Fatura
  document.getElementById('invoiceCalcModeBadge').textContent = activeSummary.isClosed ? 'Fechado no Corte' : 'Até o Momento';

  const trib = fatura.tributosPorDentro;
  const valTusd = fatura.energiaBase.custoTusd;
  const valTe = fatura.energiaBase.custoTe;
  const valIcms = trib.valorIcms + trib.valorFecp;
  const valFed = trib.valorPis + trib.valorCofins;
  const valCosip = fatura.cosipMarica.valor;
  const valFlag = fatura.energiaBase.custoBandeira;
  const valExtras = fatura.eventuais.totalEventuais;

  const maxPart = Math.max(valTusd, valTe, valIcms, valFed, valCosip, valFlag, valExtras, 1);
  const pct = (v) => `${Math.min(100, Math.max(3, Math.round((v / maxPart) * 100)))}%`;

  document.getElementById('hbarTusd').style.width = pct(valTusd);
  document.getElementById('bdTusdValue').textContent = formatCurrency(valTusd);

  document.getElementById('hbarTe').style.width = pct(valTe);
  document.getElementById('bdTeValue').textContent = formatCurrency(valTe);

  document.getElementById('hbarIcms').style.width = pct(valIcms);
  document.getElementById('bdIcmsTotalValue').textContent = formatCurrency(valIcms);

  document.getElementById('hbarFed').style.width = pct(valFed);
  document.getElementById('bdFedTotalValue').textContent = formatCurrency(valFed);

  document.getElementById('hbarCosip').style.width = pct(valCosip);
  document.getElementById('bdCosipValue').textContent = formatCurrency(valCosip);

  document.getElementById('hbarFlag').style.width = pct(valFlag);
  document.getElementById('bdFlagValue').textContent = formatCurrency(valFlag);

  document.getElementById('hbarExtras').style.width = pct(valExtras);
  document.getElementById('bdExtrasValue').textContent = formatCurrency(valExtras);

  document.getElementById('bdTaxDetail').textContent =
    `Alíquota por dentro: ${trib.somaAliquotasPercent.toFixed(2)}% (Divisor ${trib.divisorPorDentro.toFixed(4)})`;
  document.getElementById('bdTotalValue').textContent = formatCurrency(fatura.valorTotalFatura);

  const dateInput = document.getElementById('inputReadingDate');
  if (!dateInput.value) {
    setDefaultReadingFormValues();
  }
}

function loadDayIntoForm(dateStr) {
  if (!appState) return;
  const dayObj = appState.dailyGrid.find(d => d.date === dateStr);
  if (!dayObj) return;

  switchView('dashboard');
  document.getElementById('inputReadingDate').value = dayObj.date;
  document.getElementById('inputMeterValue').value = dayObj.hasReading
    ? dayObj.meterValue
    : (appState.activeSummary.latestMeterValue || '');
  document.getElementById('inputSolarInjected').value = dayObj.solarInjectedKwh || 0;
  document.getElementById('inputReadingNotes').value = dayObj.notes || '';
  document.getElementById('inputIsCutoff').checked = Boolean(dayObj.isCutoff || dayObj.date === appState.activePeriod.expectedCutoffDate);
  document.getElementById('nextPeriodOptions').classList.toggle('hidden', !document.getElementById('inputIsCutoff').checked);

  const meterInput = document.getElementById('inputMeterValue');
  meterInput.focus();
  meterInput.select();
  showToast(`Dia ${formatDateBR(dayObj.date)} carregado no formulário de leitura.`);
}

function setDefaultReadingFormValues() {
  if (!appState) return;
  const today = new Date().toISOString().slice(0, 10);
  const { activePeriod, activeSummary } = appState;

  let defaultDate = today;
  if (today < activePeriod.startDate || today > activePeriod.expectedCutoffDate) {
    defaultDate = activePeriod.expectedCutoffDate;
  }

  document.getElementById('inputReadingDate').value = defaultDate;
  document.getElementById('inputMeterValue').value = activeSummary.latestMeterValue > 0
    ? activeSummary.latestMeterValue
    : '';
  document.getElementById('inputSolarInjected').value = '0';
  document.getElementById('inputReadingNotes').value = '';
  document.getElementById('inputIsCutoff').checked = false;
  document.getElementById('inputStartNextPeriod').checked = false;
  document.getElementById('nextPeriodOptions').classList.add('hidden');
}

function renderDailyGrid() {
  const { dailyGrid } = appState;
  const onlyRecorded = document.getElementById('chkShowOnlyRecorded').checked;
  const tbody = document.getElementById('dailyGridBody');
  tbody.innerHTML = '';

  const rows = onlyRecorded ? dailyGrid.filter(d => d.hasReading) : dailyGrid;

  rows.forEach(day => {
    const tr = document.createElement('tr');
    if (!day.hasReading) tr.classList.add('row-unrecorded');
    if (day.isCutoff) tr.classList.add('row-cutoff');

    let statusHtml = `<span class="day-pill pending">Pendente</span>`;
    if (day.isCutoff) {
      statusHtml = `<span class="day-pill cutoff">✂️ DIA DO CORTE</span>`;
    } else if (day.hasReading) {
      statusHtml = `<span class="day-pill recorded">✓ Registrado</span>`;
    } else if (day.isExpectedCutoff) {
      statusHtml = `<span class="day-pill cutoff">Corte Previsto</span>`;
    }

    const meterStr = day.hasReading ? `<strong>${formatNumber(day.meterValue)} kWh</strong>` : '—';
    const deltaStr = day.hasReading ? `+${formatNumber(day.deltaKwh)} kWh` : '—';
    const accStr = day.hasReading ? `${formatNumber(day.accumulatedKwh)} kWh` : '—';
    const costStr = day.hasReading ? formatCurrency(day.estimatedDailyCostBRL) : '—';
    const notesStr = day.notes
      ? escapeHtml(day.notes)
      : (day.solarInjectedKwh > 0 ? `☀️ Injetado: ${formatNumber(day.solarInjectedKwh)} kWh` : '—');

    tr.innerHTML = `
      <td><strong>${formatDateBR(day.date)}</strong></td>
      <td>${statusHtml}</td>
      <td>${meterStr}</td>
      <td>${deltaStr}</td>
      <td>${accStr}</td>
      <td>${costStr}</td>
      <td>${notesStr}</td>
      <td class="text-right">
        <button type="button" class="btn-light btn-xs btn-edit-day" data-date="${day.date}">
          ${day.hasReading ? '✏️ Editar' : '➕ Registrar'}
        </button>
        ${day.hasReading ? `<button type="button" class="btn-light btn-xs btn-del-day" data-date="${day.date}" title="Remover leitura">🗑️</button>` : ''}
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit-day').forEach(btn => {
    btn.addEventListener('click', () => loadDayIntoForm(btn.dataset.date));
  });

  tbody.querySelectorAll('.btn-del-day').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        appState = await api.deleteReading(appState.activePeriodId, btn.dataset.date);
        renderAll();
        showToast(`Leitura de ${formatDateBR(btn.dataset.date)} removida.`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

function renderChartsView() {
  if (!appState || !analyticsChartRenderer) return;
  const series = appState.charts[activeChartMode] || [];
  analyticsChartRenderer.render(series, activeChartMode);

  const values = series.map(s => Number(s.kwh) || 0);
  const nonZero = values.filter(v => v > 0);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = values.length > 0 ? total / values.length : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = nonZero.length > 0 ? Math.min(...nonZero) : 0;

  document.getElementById('chartStatTotal').textContent = `${formatNumber(total)} kWh`;
  document.getElementById('chartStatAvg').textContent = `${formatNumber(avg)} kWh`;
  document.getElementById('chartStatMax').textContent = `${formatNumber(max)} kWh`;
  document.getElementById('chartStatMin').textContent = `${formatNumber(min)} kWh`;

  const tbody = document.getElementById('chartDataTableBody');
  tbody.innerHTML = '';

  series.forEach(item => {
    const tr = document.createElement('tr');
    let extra = '';
    if (activeChartMode === 'daily') {
      extra = `Medidor: ${formatNumber(item.meterValue)} kWh | Custo est.: ${formatCurrency(item.costBRL)} ${item.isCutoff ? '• ✂️ Dia do Corte' : ''}`;
    } else if (activeChartMode === 'weekly') {
      extra = `${item.daysCount} leituras na semana`;
    } else if (activeChartMode === 'monthly') {
      extra = `Fatura calculada: ${formatCurrency(item.totalBRL)} (${item.isClosed ? 'Fechado' : 'Em aberto'})`;
    } else if (activeChartMode === 'annual') {
      extra = `${item.periodsCount} ciclos no ano | Total R$: ${formatCurrency(item.totalBRL)}`;
    }

    tr.innerHTML = `
      <td><strong>${escapeHtml(item.fullDate ? formatDateBR(item.fullDate) : item.label)}</strong></td>
      <td><strong>${formatNumber(item.kwh)} kWh</strong></td>
      <td>${extra}</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateSettingsForm() {
  if (!appState) return;
  const period = appState.activePeriod;
  const cfg = period.config || appState.globalConfig;

  document.getElementById('settingsPeriodName').textContent = period.name;
  document.getElementById('cfgClasse').value = cfg.classe || 'Residencial B1';
  document.getElementById('cfgModalidade').value = cfg.modalidade || 'Convencional';
  document.getElementById('cfgTipoLigacao').value = cfg.tipoLigacao || 'Bifásico';
  document.getElementById('cfgAplicarMinimo').value = String(cfg.aplicarCustoDisponibilidadeNoFechamento !== false);
  document.getElementById('cfgTe').value = cfg.te;
  document.getElementById('cfgTusd').value = cfg.tusd;
  document.getElementById('cfgDiaCortePadrao').value = cfg.diaCortePadrao || 15;
  document.getElementById('cfgDiaVencimentoPadrao').value = cfg.diaVencimentoPadrao || 25;

  document.getElementById('cfgBandeiraAtiva').value = cfg.bandeiraAtiva || 'verde';
  const b = cfg.bandeiras || {};
  document.getElementById('cfgBandVerde').value = b.verde ? b.verde.valorPorkWh : 0;
  document.getElementById('cfgBandAmarela').value = b.amarela ? b.amarela.valorPorkWh : 0.01885;
  document.getElementById('cfgBandVermelha1').value = b.vermelha1 ? b.vermelha1.valorPorkWh : 0.04463;
  document.getElementById('cfgBandVermelha2').value = b.vermelha2 ? b.vermelha2.valorPorkWh : 0.07877;

  document.getElementById('cfgPis').value = cfg.pisPercent;
  document.getElementById('cfgCofins').value = cfg.cofinsPercent;
  document.getElementById('cfgIcmsModo').value = cfg.icmsModo || 'escalonado_rj';

  const isManual = cfg.icmsModo === 'manual';
  document.getElementById('icmsEscalonadoBox').classList.toggle('hidden', isManual);
  document.getElementById('icmsManualBox').classList.toggle('hidden', !isManual);

  const faixasIcms = cfg.faixasIcmsRj || {};
  document.getElementById('cfgIcmsReduzida').value = faixasIcms.aliquotaReduzidaPercent ?? 18.0;
  document.getElementById('cfgIcmsCheia').value = faixasIcms.aliquotaCheiaIcmsPercent ?? 20.0;
  document.getElementById('cfgFecpCheia').value = faixasIcms.aliquotaCheiaFecpPercent ?? 4.0;
  document.getElementById('cfgIcmsManual').value = cfg.icmsManualPercent ?? 18.0;
  document.getElementById('cfgFecpManual').value = cfg.fecpManualPercent ?? 0.0;

  document.getElementById('cfgCosipModo').value = cfg.cosipModo || 'tabela_marica';
  document.getElementById('cfgCosipValorFixo').value = cfg.cosipValorFixo ?? 28.50;

  const cosipContainer = document.getElementById('cosipFaixasContainer');
  cosipContainer.innerHTML = '';
  const tabelaCosip = Array.isArray(cfg.tabelaCosipMarica) ? cfg.tabelaCosipMarica : [];
  tabelaCosip.forEach((faixa, idx) => {
    const div = document.createElement('div');
    div.className = 'cosip-faixa-item';
    div.innerHTML = `
      <span>${escapeHtml(faixa.descricao)}</span>
      <div>
        R$ <input type="number" step="0.01" min="0" class="cosip-faixa-input" data-idx="${idx}" data-ate="${faixa.ateKwh}" data-desc="${escapeHtml(faixa.descricao)}" value="${Number(faixa.valor).toFixed(2)}" />
      </div>
    `;
    cosipContainer.appendChild(div);
  });

  document.getElementById('cfgPossuiSolar').checked = Boolean(cfg.possuiGeracaoSolar);
  document.getElementById('cfgSolarInjetada').value = cfg.energiaInjetadaKwh ?? 0;
  document.getElementById('cfgSolarCreditos').value = cfg.creditosAcumuladosKwh ?? 0;
  document.getElementById('cfgSolarFioB').value = cfg.percentualFioBTusd ?? 30.0;

  document.getElementById('cfgDiasAtraso').value = cfg.diasAtraso ?? 0;
  document.getElementById('cfgMultaPercent').value = cfg.multaAtrasoPercent ?? 2.0;
  document.getElementById('cfgJurosMensal').value = cfg.jurosMoraMensalPercent ?? 1.0;
  document.getElementById('cfgCorrecaoMonetaria').value = cfg.correcaoMonetariaValor ?? 0;
  document.getElementById('cfgTaxasExtras').value = cfg.taxasExtrasValor ?? 0;

  document.getElementById('cfgGrupoAAtivo').checked = Boolean(cfg.grupoAAtivo);
  document.getElementById('cfgDemandaContratada').value = cfg.demandaContratadaKw ?? 0;
  document.getElementById('cfgDemandaMedida').value = cfg.demandaMedidaKw ?? 0;
  document.getElementById('cfgTarifaDemanda').value = cfg.tarifaDemandaPorKw ?? 32.5;
  document.getElementById('cfgReativaExcedente').value = cfg.energiaReativaExcedenteValor ?? 0;
}

function collectTariffConfigFromForm() {
  const bandVerde = Number(document.getElementById('cfgBandVerde').value) || 0;
  const bandAmarela = Number(document.getElementById('cfgBandAmarela').value) || 0;
  const bandVerm1 = Number(document.getElementById('cfgBandVermelha1').value) || 0;
  const bandVerm2 = Number(document.getElementById('cfgBandVermelha2').value) || 0;

  const tabelaCosipMarica = [];
  document.querySelectorAll('.cosip-faixa-input').forEach(inp => {
    tabelaCosipMarica.push({
      ateKwh: Number(inp.dataset.ate),
      descricao: inp.dataset.desc,
      valor: Number(inp.value) || 0
    });
  });

  return {
    classe: document.getElementById('cfgClasse').value,
    modalidade: document.getElementById('cfgModalidade').value,
    tipoLigacao: document.getElementById('cfgTipoLigacao').value,
    aplicarCustoDisponibilidadeNoFechamento: document.getElementById('cfgAplicarMinimo').value === 'true',
    te: Number(document.getElementById('cfgTe').value) || 0,
    tusd: Number(document.getElementById('cfgTusd').value) || 0,
    diaCortePadrao: Number(document.getElementById('cfgDiaCortePadrao').value) || 15,
    diaVencimentoPadrao: Number(document.getElementById('cfgDiaVencimentoPadrao').value) || 25,

    bandeiraAtiva: document.getElementById('cfgBandeiraAtiva').value,
    bandeiras: {
      verde: { nome: 'Bandeira Verde', valorPorkWh: bandVerde, valorPor100kWh: bandVerde * 100 },
      amarela: { nome: 'Bandeira Amarela', valorPorkWh: bandAmarela, valorPor100kWh: bandAmarela * 100 },
      vermelha1: { nome: 'Bandeira Vermelha - Patamar 1', valorPorkWh: bandVerm1, valorPor100kWh: bandVerm1 * 100 },
      vermelha2: { nome: 'Bandeira Vermelha - Patamar 2', valorPorkWh: bandVerm2, valorPor100kWh: bandVerm2 * 100 }
    },

    pisPercent: Number(document.getElementById('cfgPis').value) || 0,
    cofinsPercent: Number(document.getElementById('cfgCofins').value) || 0,
    icmsModo: document.getElementById('cfgIcmsModo').value,
    icmsManualPercent: Number(document.getElementById('cfgIcmsManual').value) || 0,
    fecpManualPercent: Number(document.getElementById('cfgFecpManual').value) || 0,
    faixasIcmsRj: {
      isentoAteKwh: 50,
      reduzidoAteKwh: 300,
      aliquotaReduzidaPercent: Number(document.getElementById('cfgIcmsReduzida').value) || 18,
      aliquotaCheiaIcmsPercent: Number(document.getElementById('cfgIcmsCheia').value) || 20,
      aliquotaCheiaFecpPercent: Number(document.getElementById('cfgFecpCheia').value) || 4
    },

    cosipModo: document.getElementById('cfgCosipModo').value,
    cosipValorFixo: Number(document.getElementById('cfgCosipValorFixo').value) || 0,
    tabelaCosipMarica,

    possuiGeracaoSolar: document.getElementById('cfgPossuiSolar').checked,
    energiaInjetadaKwh: Number(document.getElementById('cfgSolarInjetada').value) || 0,
    creditosAcumuladosKwh: Number(document.getElementById('cfgSolarCreditos').value) || 0,
    percentualFioBTusd: Number(document.getElementById('cfgSolarFioB').value) || 30,

    diasAtraso: Number(document.getElementById('cfgDiasAtraso').value) || 0,
    multaAtrasoPercent: Number(document.getElementById('cfgMultaPercent').value) || 2,
    jurosMoraMensalPercent: Number(document.getElementById('cfgJurosMensal').value) || 1,
    correcaoMonetariaValor: Number(document.getElementById('cfgCorrecaoMonetaria').value) || 0,
    taxasExtrasValor: Number(document.getElementById('cfgTaxasExtras').value) || 0,

    grupoAAtivo: document.getElementById('cfgGrupoAAtivo').checked,
    demandaContratadaKw: Number(document.getElementById('cfgDemandaContratada').value) || 0,
    demandaMedidaKw: Number(document.getElementById('cfgDemandaMedida').value) || 0,
    tarifaDemandaPorKw: Number(document.getElementById('cfgTarifaDemanda').value) || 0,
    energiaReativaExcedenteValor: Number(document.getElementById('cfgReativaExcedente').value) || 0
  };
}

function openPeriodModal(mode) {
  if (!appState) return;
  const modal = document.getElementById('periodModal');
  document.getElementById('modalPeriodMode').value = mode;

  if (mode === 'edit') {
    const p = appState.activePeriod;
    document.getElementById('periodModalTitle').textContent = `Editar Ciclo: ${p.name}`;
    document.getElementById('modalPeriodName').value = p.name;
    document.getElementById('modalStartDate').value = p.startDate;
    document.getElementById('modalCutoffDate').value = p.expectedCutoffDate;
    document.getElementById('modalDueDate').value = p.dueDate;
    document.getElementById('modalInitialMeter').value = p.initialMeterValue !== null && p.initialMeterValue !== undefined
      ? p.initialMeterValue
      : '';
  } else {
    document.getElementById('periodModalTitle').textContent = 'Criar Novo Período / Ciclo de Faturamento';
    document.getElementById('modalPeriodName').value = '';
    document.getElementById('modalStartDate').value = '';
    document.getElementById('modalCutoffDate').value = '';
    document.getElementById('modalDueDate').value = '';
    document.getElementById('modalInitialMeter').value = appState.activeSummary.latestMeterValue || '';
  }

  modal.classList.remove('hidden');
}

function closePeriodModal() {
  document.getElementById('periodModal').classList.add('hidden');
}

function formatNumber(val) {
  return Number(val || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCurrency(val) {
  return Number(val || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatDateBR(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '--/--/----';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toastNotification');
  toast.textContent = message;
  toast.style.backgroundColor = isError ? '#80314c' : '#29384c';
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3800);
}
