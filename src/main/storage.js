/**
 * Motor de Armazenamento Baseado em Arquivo Local JSON (Sem Banco de Dados Externo)
 *
 * Recursos:
 * - Escrita atômica (.tmp -> rename) + backup automático (.bak)
 * - Mantém histórico completo de períodos/ciclos com snapshot das tarifas (cálculo retroativo)
 * - Geração automática do grid de todos os dias do período vigente
 * - Agregação de dados para gráficos (Diário, Semanal, Mensal, Anual em kWh)
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_TARIFF_CONFIG, calculatePeriodSummary } = require('./calculator');

class FileStorage {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.filePath = path.join(storageDir, 'whattz-data.json');
    this.backupPath = path.join(storageDir, 'whattz-data.json.bak');
    this.data = null;
    this._ensureLoaded();
  }

  _ensureLoaded() {
    if (this.data) return;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
      } catch (err) {
        // Tenta restaurar do backup se o arquivo principal estiver corrompido
        if (fs.existsSync(this.backupPath)) {
          const rawBak = fs.readFileSync(this.backupPath, 'utf-8');
          this.data = JSON.parse(rawBak);
        }
      }
    }

    if (!this.data || !Array.isArray(this.data.periods) || this.data.periods.length === 0) {
      this.data = this._createInitialData();
      this.save();
    } else {
      // Consolida eventuais períodos duplicados do mesmo Mês/Ano (ex: dois "Dezembro/2026")
      const changed = this._deduplicatePeriodsByMonthYear();
      if (changed) {
        this.save();
      }
    }
  }

  /**
   * Retorna a chave única Mês/Ano (ex: "2026-12") de um período com base no nome ("Dezembro/2026")
   * ou na data de corte prevista (expectedCutoffDate).
   */
  _getPeriodMonthYearKey(periodOrObj) {
    const mesesMap = {
      janeiro: '01', fevereiro: '02', 'março': '03', marco: '03', abril: '04',
      maio: '05', junho: '06', julho: '07', agosto: '08',
      setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
    };
    const nameStr = String(periodOrObj.name || '').trim().toLowerCase();
    const matchName = nameStr.match(/^([a-zç]+)\s*\/\s*(\d{4})$/i);
    if (matchName) {
      const m = mesesMap[matchName[1]];
      if (m) return `${matchName[2]}-${m}`;
    }

    const refDate = periodOrObj.expectedCutoffDate || periodOrObj.cutoffDate || periodOrObj.startDate || '';
    if (/^\d{4}-\d{2}/.test(refDate)) {
      return refDate.slice(0, 7);
    }
    return nameStr || String(periodOrObj.id || '');
  }

  /**
   * Garante que não existam dois períodos do mesmo Mês/Ano no arquivo de dados,
   * mesclando leituras caso tenham sido criados duplicados por acidente.
   */
  _deduplicatePeriodsByMonthYear() {
    if (!this.data || !Array.isArray(this.data.periods) || this.data.periods.length <= 1) {
      return false;
    }

    const byKey = new Map();
    let hadDuplicates = false;

    for (const p of this.data.periods) {
      const key = this._getPeriodMonthYearKey(p);
      if (!byKey.has(key)) {
        byKey.set(key, p);
      } else {
        hadDuplicates = true;
        const existing = byKey.get(key);
        // Se um dos períodos duplicados era o período ativo ou foi editado manualmente por último,
        // prioriza o período ativo do usuário em vez de misturar com dados de exemplo antigos
        const preferSecond = (this.data.activePeriodId === p.id) || (existing.id === 'period-2026-12' && p.id !== 'period-2026-12');
        const winner = preferSecond ? p : existing;
        byKey.set(key, winner);
        if (this.data.activePeriodId === existing.id || this.data.activePeriodId === p.id) {
          this.data.activePeriodId = winner.id;
        }
      }
    }

    if (hadDuplicates) {
      this.data.periods = Array.from(byKey.values());
    }
    return hadDuplicates;
  }

  _createInitialData() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-indexed

    const diaCorte = DEFAULT_TARIFF_CONFIG.diaCortePadrao || 15;
    const diaVenc = DEFAULT_TARIFF_CONFIG.diaVencimentoPadrao || 25;

    // Define o ciclo vigente baseado no dia de corte
    let startDateObj;
    let cutoffDateObj;
    let dueDateObj;

    if (today.getDate() > diaCorte) {
      startDateObj = new Date(Date.UTC(year, month, diaCorte + 1));
      cutoffDateObj = new Date(Date.UTC(year, month + 1, diaCorte));
      dueDateObj = new Date(Date.UTC(year, month + 1, diaVenc));
    } else {
      startDateObj = new Date(Date.UTC(year, month - 1, diaCorte + 1));
      cutoffDateObj = new Date(Date.UTC(year, month, diaCorte));
      dueDateObj = new Date(Date.UTC(year, month, diaVenc));
    }

    const startDate = formatDateUTC(startDateObj);
    const expectedCutoffDate = formatDateUTC(cutoffDateObj);
    const dueDate = formatDateUTC(dueDateObj);
    const periodName = formatPeriodLabel(cutoffDateObj);

    const periodId = `period-${cutoffDateObj.getUTCFullYear()}-${String(cutoffDateObj.getUTCMonth() + 1).padStart(2, '0')}`;

    return {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      globalConfig: JSON.parse(JSON.stringify(DEFAULT_TARIFF_CONFIG)),
      activePeriodId: periodId,
      periods: [
        {
          id: periodId,
          name: periodName,
          startDate,
          expectedCutoffDate,
          dueDate,
          initialMeterValue: null,
          isClosed: false,
          cutoffDate: null,
          config: JSON.parse(JSON.stringify(DEFAULT_TARIFF_CONFIG)),
          readings: []
        }
      ]
    };
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    const json = JSON.stringify(this.data, null, 2);
    const tmpPath = `${this.filePath}.tmp`;

    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, this.backupPath);
      } catch (_) {
        // Ignora erro de cópia de backup
      }
    }

    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  getPeriodById(periodId) {
    const id = periodId || this.data.activePeriodId;
    return this.data.periods.find(p => p.id === id) || this.data.periods[this.data.periods.length - 1];
  }

  setActivePeriod(periodId) {
    const period = this.data.periods.find(p => p.id === periodId);
    if (!period) throw new Error('Período não encontrado.');
    this.data.activePeriodId = period.id;
    this.save();
    return this.getFullState();
  }

  /**
   * Registra ou edita a leitura de um dia no medidor.
   * Se `isCutoff` for true, marca o dia como dia do corte do período e opcionalmente cria o próximo período.
   */
  upsertReading(periodId, readingInput) {
    const period = this.getPeriodById(periodId);
    if (!period) throw new Error('Período não encontrado.');

    const date = String(readingInput.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Data inválida. Use o formato AAAA-MM-DD.');
    }

    const meterValue = Number(readingInput.meterValue);
    if (Number.isNaN(meterValue) || meterValue < 0) {
      throw new Error('O valor do medidor (kWh) deve ser um número válido maior ou igual a zero.');
    }

    const isCutoff = Boolean(readingInput.isCutoff);
    const solarInjectedKwh = Math.max(0, Number(readingInput.solarInjectedKwh || 0));
    const notes = String(readingInput.notes || '').trim();

    // Se marcou este dia como o Dia do Corte, desmarca qualquer outro dia de corte neste mesmo período
    if (isCutoff) {
      period.readings.forEach(r => {
        if (r.date !== date) r.isCutoff = false;
      });
      period.cutoffDate = date;
      period.expectedCutoffDate = date;
      period.isClosed = Boolean(readingInput.closePeriodOnCutoff);
    } else if (period.cutoffDate === date) {
      period.cutoffDate = null;
      period.isClosed = false;
    }

    const existingIdx = period.readings.findIndex(r => r.date === date);
    const entry = {
      date,
      meterValue,
      isCutoff,
      solarInjectedKwh,
      notes,
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      period.readings[existingIdx] = entry;
    } else {
      period.readings.push(entry);
    }

    period.readings.sort((a, b) => a.date.localeCompare(b.date));

    // Expande startDate / expectedCutoffDate se a data inserida estiver fora do intervalo original
    if (date < period.startDate) {
      period.startDate = date;
    }
    if (date > period.expectedCutoffDate && !period.cutoffDate) {
      period.expectedCutoffDate = date;
    }

    // Se o usuário pediu para encerrar o período no dia do corte e abrir o próximo ciclo
    if (isCutoff && readingInput.startNextPeriod) {
      this._createNextPeriodFromCutoff(period, date, meterValue);
    }

    this.save();
    return this.getFullState();
  }

  deleteReading(periodId, date) {
    const period = this.getPeriodById(periodId);
    if (!period) throw new Error('Período não encontrado.');

    period.readings = period.readings.filter(r => r.date !== date);
    if (period.cutoffDate === date) {
      period.cutoffDate = null;
      period.isClosed = false;
    }

    this.save();
    return this.getFullState();
  }

  /**
   * Atualiza metadados do período (leitura inicial do medidor, datas de início/corte/vencimento, nome).
   */
  updatePeriodMetadata(periodId, meta) {
    const period = this.getPeriodById(periodId);
    if (!period) throw new Error('Período não encontrado.');

    const candidateName = meta.name !== undefined
      ? (String(meta.name).trim() || period.name)
      : (meta.expectedCutoffDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.expectedCutoffDate)
          ? formatPeriodLabel(new Date(`${meta.expectedCutoffDate}T00:00:00Z`))
          : period.name);
    const candidateCutoff = (meta.expectedCutoffDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(meta.expectedCutoffDate))
      ? meta.expectedCutoffDate
      : period.expectedCutoffDate;

    // Verifica se a alteração de nome ou data de corte conflita com outro período do mesmo Mês/Ano
    const candidateKey = this._getPeriodMonthYearKey({ name: candidateName, expectedCutoffDate: candidateCutoff });
    const conflict = this.data.periods.find(p => p.id !== period.id && this._getPeriodMonthYearKey(p) === candidateKey);
    if (conflict) {
      throw new Error(`Já existe um período cadastrado para este mês/ano (${conflict.name}). Não é permitido ter dois períodos do mesmo mês no mesmo ano.`);
    }

    period.name = candidateName;
    if (meta.startDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(meta.startDate)) {
      period.startDate = meta.startDate;
    }
    period.expectedCutoffDate = candidateCutoff;
    // Se a data do corte foi alterada para outro mês, sincroniza period.id para manter consistência
    const oldId = period.id;
    const newSyncId = `period-${candidateKey}`;
    if (oldId !== newSyncId && !this.data.periods.some(p => p.id === newSyncId)) {
      period.id = newSyncId;
      if (this.data.activePeriodId === oldId) {
        this.data.activePeriodId = newSyncId;
      }
    }
    if (meta.dueDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(meta.dueDate)) {
      period.dueDate = meta.dueDate;
    }
    if (meta.initialMeterValue !== undefined) {
      period.initialMeterValue = (meta.initialMeterValue === '' || meta.initialMeterValue === null)
        ? null
        : Number(meta.initialMeterValue);
    }
    if (meta.isClosed !== undefined) {
      period.isClosed = Boolean(meta.isClosed);
    }

    this.save();
    return this.getFullState();
  }

  /**
   * Exclui um período/ciclo de faturamento.
   * Caso o usuário apague o único período existente, um período limpo padrão é recriado automaticamente.
   */
  deletePeriod(periodId) {
    const targetId = periodId || this.data.activePeriodId;
    const idx = this.data.periods.findIndex(p => p.id === targetId);
    if (idx === -1) {
      throw new Error('Período não encontrado para exclusão.');
    }

    this.data.periods.splice(idx, 1);

    if (this.data.periods.length === 0) {
      const fresh = this._createInitialData();
      this.data.periods = fresh.periods;
      this.data.activePeriodId = fresh.activePeriodId;
    } else if (this.data.activePeriodId === targetId) {
      const nextActive = this.data.periods[Math.min(idx, this.data.periods.length - 1)];
      this.data.activePeriodId = nextActive.id;
    }

    this.save();
    return this.getFullState();
  }

  /**
   * Cria um novo período/ciclo manualmente ou a partir do fechamento do ciclo anterior.
   * Impede a criação de dois períodos para o mesmo mês e ano.
   */
  createNewPeriod(payload = {}) {
    const currentPeriod = this.getPeriodById(this.data.activePeriodId);
    const currentSummary = currentPeriod ? calculatePeriodSummary(currentPeriod) : null;

    const startDate = payload.startDate || addDaysUTC(currentPeriod.expectedCutoffDate, 1);
    const expectedCutoffDate = payload.expectedCutoffDate || addDaysUTC(startDate, 29);
    const dueDate = payload.dueDate || addDaysUTC(expectedCutoffDate, 10);
    const initialMeterValue = payload.initialMeterValue !== undefined && payload.initialMeterValue !== ''
      ? Number(payload.initialMeterValue)
      : (currentSummary ? currentSummary.latestMeterValue : null);

    const cutoffDateObj = new Date(`${expectedCutoffDate}T00:00:00Z`);
    const name = payload.name || formatPeriodLabel(cutoffDateObj);

    const candidateKey = this._getPeriodMonthYearKey({ name, expectedCutoffDate });
    const existingSameMonth = this.data.periods.find(p => this._getPeriodMonthYearKey(p) === candidateKey);
    if (existingSameMonth) {
      throw new Error(`Já existe o período "${existingSameMonth.name}" cadastrado. Não é permitido criar dois períodos para o mesmo mês/ano.`);
    }

    const id = `period-${candidateKey}`;

    const newPeriod = {
      id,
      name,
      startDate,
      expectedCutoffDate,
      dueDate,
      initialMeterValue,
      isClosed: false,
      cutoffDate: null,
      config: JSON.parse(JSON.stringify(this.data.globalConfig || DEFAULT_TARIFF_CONFIG)),
      readings: []
    };

    this.data.periods.push(newPeriod);
    this.data.activePeriodId = id;
    this.save();
    return this.getFullState();
  }

  _createNextPeriodFromCutoff(closedPeriod, cutoffDateStr, cutoffMeterValue) {
    closedPeriod.isClosed = true;
    closedPeriod.cutoffDate = cutoffDateStr;
    closedPeriod.expectedCutoffDate = cutoffDateStr;

    const nextStartDate = addDaysUTC(cutoffDateStr, 1);
    const cutoffObj = new Date(`${cutoffDateStr}T00:00:00Z`);
    const nextCutoffObj = new Date(Date.UTC(
      cutoffObj.getUTCFullYear(),
      cutoffObj.getUTCMonth() + 1,
      cutoffObj.getUTCDate()
    ));
    const nextExpectedCutoff = formatDateUTC(nextCutoffObj);
    const nextName = formatPeriodLabel(nextCutoffObj);
    const nextKey = this._getPeriodMonthYearKey({ name: nextName, expectedCutoffDate: nextExpectedCutoff });

    // Se já existir um período para o próximo mês/ano, apenas atualiza a leitura base dele e o torna ativo (não duplica!)
    const existingNext = this.data.periods.find(p => p.id !== closedPeriod.id && this._getPeriodMonthYearKey(p) === nextKey);
    if (existingNext) {
      existingNext.initialMeterValue = cutoffMeterValue;
      existingNext.startDate = nextStartDate;
      this.data.activePeriodId = existingNext.id;
      return;
    }

    const diaVenc = (closedPeriod.config && closedPeriod.config.diaVencimentoPadrao) || 25;
    const nextDueObj = new Date(Date.UTC(
      nextCutoffObj.getUTCFullYear(),
      nextCutoffObj.getUTCMonth(),
      diaVenc
    ));
    if (nextDueObj <= nextCutoffObj) {
      nextDueObj.setUTCMonth(nextDueObj.getUTCMonth() + 1);
    }

    const nextId = `period-${nextKey}`;
    const nextPeriod = {
      id: nextId,
      name: nextName,
      startDate: nextStartDate,
      expectedCutoffDate: nextExpectedCutoff,
      dueDate: formatDateUTC(nextDueObj),
      initialMeterValue: cutoffMeterValue,
      isClosed: false,
      cutoffDate: null,
      config: JSON.parse(JSON.stringify(closedPeriod.config || this.data.globalConfig)),
      readings: []
    };

    this.data.periods.push(nextPeriod);
    this.data.activePeriodId = nextId;
  }

  /**
   * Salva as configurações tarifárias do período selecionado (mantendo histórico para cálculo retroativo)
   * e opcionalmente atualiza o padrão global para futuros períodos.
   */
  updateTariffConfig(periodId, newConfig, applyAsGlobalDefault = true) {
    const period = this.getPeriodById(periodId);
    if (!period) throw new Error('Período não encontrado.');

    const merged = {
      ...DEFAULT_TARIFF_CONFIG,
      ...(period.config || {}),
      ...newConfig,
      bandeiras: {
        ...DEFAULT_TARIFF_CONFIG.bandeiras,
        ...((period.config && period.config.bandeiras) || {}),
        ...((newConfig && newConfig.bandeiras) || {})
      },
      faixasIcmsRj: {
        ...DEFAULT_TARIFF_CONFIG.faixasIcmsRj,
        ...((period.config && period.config.faixasIcmsRj) || {}),
        ...((newConfig && newConfig.faixasIcmsRj) || {})
      }
    };

    if (Array.isArray(newConfig.tabelaCosipMarica)) {
      merged.tabelaCosipMarica = newConfig.tabelaCosipMarica;
    }

    period.config = JSON.parse(JSON.stringify(merged));

    if (applyAsGlobalDefault) {
      this.data.globalConfig = JSON.parse(JSON.stringify(merged));
    }

    this.save();
    return this.getFullState();
  }

  /**
   * Constrói o Grid completo de todos os dias do período vigente (incluindo dias ainda sem leitura),
   * permitindo visualizar e editar qualquer dia esquecido ou marcado errado.
   */
  buildPeriodDailyGrid(period, summary) {
    const breakdownMap = new Map();
    (summary.dailyBreakdown || []).forEach(item => {
      breakdownMap.set(item.date, item);
    });

    const startStr = period.startDate;
    const endStr = period.cutoffDate || period.expectedCutoffDate;
    const days = listDatesInRange(startStr, endStr);

    // Garante que qualquer leitura fora do range padrão também apareça no grid
    (summary.dailyBreakdown || []).forEach(item => {
      if (!days.includes(item.date)) {
        days.push(item.date);
      }
    });
    days.sort();

    const todayStr = formatDateUTC(new Date());

    return days.map(dateStr => {
      const recorded = breakdownMap.get(dateStr);
      return {
        date: dateStr,
        hasReading: Boolean(recorded),
        isToday: dateStr === todayStr,
        isFuture: dateStr > todayStr,
        isExpectedCutoff: dateStr === period.expectedCutoffDate,
        meterValue: recorded ? recorded.meterValue : null,
        previousMeterValue: recorded ? recorded.previousMeterValue : null,
        deltaKwh: recorded ? recorded.deltaKwh : null,
        avgDailyKwh: recorded ? recorded.avgDailyKwh : null,
        accumulatedKwh: recorded ? recorded.accumulatedKwh : null,
        estimatedDailyCostBRL: recorded ? recorded.estimatedDailyCostBRL : null,
        isCutoff: recorded ? recorded.isCutoff : false,
        solarInjectedKwh: recorded ? recorded.solarInjectedKwh : 0,
        notes: recorded ? recorded.notes : ''
      };
    });
  }

  /**
   * Gera as séries de dados para a página de Gráficos (Diário, Semanal, Mensal, Anual em kWh).
   */
  buildChartAnalytics(activePeriod, activeSummary) {
    // Coleta todas as leituras processadas de todos os períodos
    const allPeriodsSummaries = this.data.periods.map(p => ({
      period: p,
      summary: calculatePeriodSummary(p)
    }));

    // 1. Gráfico Diário (kWh de cada dia do período selecionado)
    const dailySeries = (activeSummary.dailyBreakdown || []).map(item => ({
      label: formatDayMonth(item.date),
      fullDate: item.date,
      kwh: item.deltaKwh,
      meterValue: item.meterValue,
      costBRL: item.estimatedDailyCostBRL,
      isCutoff: item.isCutoff
    }));

    // 2. Gráfico Semanal (4 semanas de 7 dias do período selecionado)
    const activeDailyItems = [...(activeSummary.dailyBreakdown || [])].sort((a, b) => a.date.localeCompare(b.date));
    const periodStart = activePeriod.startDate;
    const periodEnd = activePeriod.cutoffDate || activePeriod.expectedCutoffDate;
    const weeklyMap = new Map();

    // Inicializa as semanas do ciclo vigente para exibir toda a estrutura semanal do período
    if (periodStart && periodEnd && periodStart <= periodEnd) {
      let wStart = periodStart;
      let wIdx = 0;
      while (wStart <= periodEnd && wIdx < 6) {
        let wEnd = addDaysUTC(wStart, 6);
        if (wEnd > periodEnd) wEnd = periodEnd;
        const key = `W${String(wIdx + 1).padStart(2, '0')}`;
        weeklyMap.set(key, {
          key,
          label: `Sem ${wIdx + 1} (${formatDayMonth(wStart)}-${formatDayMonth(wEnd)})`,
          kwh: 0,
          daysCount: 0,
          lastMeterValue: null
        });
        wStart = addDaysUTC(wEnd, 1);
        wIdx++;
      }
    }

    activeDailyItems.forEach(item => {
      const weekInfo = getPeriodWeekRangeLabel(item.date, periodStart, periodEnd);
      const curr = weeklyMap.get(weekInfo.key) || {
        key: weekInfo.key,
        label: weekInfo.label,
        kwh: 0,
        daysCount: 0,
        lastMeterValue: null
      };
      curr.kwh = round2(curr.kwh + item.deltaKwh);
      curr.daysCount += 1;
      curr.lastMeterValue = item.meterValue;
      weeklyMap.set(weekInfo.key, curr);
    });
    const weeklySeries = Array.from(weeklyMap.values());

    // 3. Gráfico Mensal (consumo em kWh por período/mês de faturamento)
    const monthlySeries = allPeriodsSummaries.map(({ period, summary }) => ({
      periodId: period.id,
      label: period.name,
      kwh: summary.consumoAcumuladoKwh,
      projectedKwh: summary.consumoProjetadoCorteKwh,
      totalBRL: summary.faturaAtual.valorTotalFatura,
      isClosed: summary.isClosed
    }));

    // 4. Gráfico Anual (consumo total em kWh por ano)
    const annualMap = new Map();
    allPeriodsSummaries.forEach(({ period, summary }) => {
      const year = (period.expectedCutoffDate || period.startDate || '').slice(0, 4) || String(new Date().getFullYear());
      const curr = annualMap.get(year) || {
        label: year,
        kwh: 0,
        totalBRL: 0,
        periodsCount: 0
      };
      curr.kwh = round2(curr.kwh + summary.consumoAcumuladoKwh);
      curr.totalBRL = round2(curr.totalBRL + summary.faturaAtual.valorTotalFatura);
      curr.periodsCount += 1;
      annualMap.set(year, curr);
    });
    const annualSeries = Array.from(annualMap.values()).sort((a, b) => a.label.localeCompare(b.label));

    return {
      daily: dailySeries,
      weekly: weeklySeries,
      monthly: monthlySeries,
      annual: annualSeries
    };
  }

  /**
   * Carrega dados de exemplo realistas para Maricá (RJ) caso o usuário deseje testar ou visualizar gráficos preenchidos.
   */
  loadSampleData() {
    const sample = this._createInitialData();
    const activePeriod = sample.periods[0];
    activePeriod.initialMeterValue = 14250.0;

    // Adiciona um período anterior fechado para histórico retroativo
    const prevStart = addDaysUTC(activePeriod.startDate, -30);
    const prevCutoff = addDaysUTC(activePeriod.startDate, -1);
    const prevDue = addDaysUTC(prevCutoff, 10);
    const prevConfig = JSON.parse(JSON.stringify(DEFAULT_TARIFF_CONFIG));
    prevConfig.bandeiraAtiva = 'amarela';

    const prevReadings = [];
    let meter = 13980.0;
    const prevDays = listDatesInRange(prevStart, prevCutoff);
    prevDays.forEach((d, idx) => {
      const dailyUse = 7.5 + ((idx % 5) * 1.1);
      meter = round2(meter + dailyUse);
      prevReadings.push({
        date: d,
        meterValue: meter,
        isCutoff: idx === prevDays.length - 1,
        solarInjectedKwh: 0,
        notes: idx === prevDays.length - 1 ? 'Fechamento de ciclo Enel RJ' : ''
      });
    });

    const prevPeriod = {
      id: `period-${prevCutoff}`,
      name: formatPeriodLabel(new Date(`${prevCutoff}T00:00:00Z`)),
      startDate: prevStart,
      expectedCutoffDate: prevCutoff,
      dueDate: prevDue,
      initialMeterValue: 13980.0,
      isClosed: true,
      cutoffDate: prevCutoff,
      config: prevConfig,
      readings: prevReadings
    };

    // Ajusta leitura inicial do período atual para bater com o corte anterior
    activePeriod.initialMeterValue = meter;
    const currDays = listDatesInRange(activePeriod.startDate, activePeriod.expectedCutoffDate);
    const daysToPopulate = Math.min(14, currDays.length);
    for (let i = 0; i < daysToPopulate; i++) {
      const dailyUse = 8.2 + ((i % 4) * 1.35);
      meter = round2(meter + dailyUse);
      activePeriod.readings.push({
        date: currDays[i],
        meterValue: meter,
        isCutoff: false,
        solarInjectedKwh: 0,
        notes: i === 0 ? 'Início do período atual' : ''
      });
    }

    sample.periods = [prevPeriod, activePeriod];
    sample.activePeriodId = activePeriod.id;
    this.data = sample;
    this.save();
    return this.getFullState();
  }

  exportBackupJson() {
    return JSON.stringify(this.data, null, 2);
  }

  importBackupJson(rawJson) {
    const parsed = JSON.parse(rawJson);
    if (!parsed || !Array.isArray(parsed.periods) || parsed.periods.length === 0) {
      throw new Error('Arquivo de backup inválido: estrutura de períodos ausente.');
    }
    this.data = parsed;
    this.save();
    return this.getFullState();
  }

  getFullState() {
    const activePeriod = this.getPeriodById(this.data.activePeriodId);
    const activeSummary = calculatePeriodSummary(activePeriod);
    const dailyGrid = this.buildPeriodDailyGrid(activePeriod, activeSummary);
    const charts = this.buildChartAnalytics(activePeriod, activeSummary);

    const periodsList = this.data.periods.map(p => {
      const s = calculatePeriodSummary(p);
      return {
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        expectedCutoffDate: p.expectedCutoffDate,
        dueDate: p.dueDate,
        isClosed: s.isClosed,
        consumoAcumuladoKwh: s.consumoAcumuladoKwh,
        valorTotalFatura: s.faturaAtual.valorTotalFatura,
        bandeiraNome: s.faturaAtual.bandeira.nome
      };
    });

    return {
      storageFilePath: this.filePath,
      updatedAt: this.data.updatedAt,
      activePeriodId: activePeriod.id,
      activePeriod,
      activeSummary,
      dailyGrid,
      charts,
      periodsList,
      globalConfig: this.data.globalConfig
    };
  }
}

function formatDateUTC(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

function listDatesInRange(startStr, endStr) {
  const result = [];
  if (!startStr || !endStr || startStr > endStr) return result;
  let curr = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  let guard = 0;
  while (curr <= end && guard < 400) {
    result.push(formatDateUTC(curr));
    curr.setUTCDate(curr.getUTCDate() + 1);
    guard++;
  }
  return result;
}

function formatPeriodLabel(dateObj) {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return `${meses[dateObj.getUTCMonth()]}/${dateObj.getUTCFullYear()}`;
}

function formatDayMonth(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function getIsoWeekLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const year = d.getUTCFullYear();
  return {
    key: `${year}-W${String(weekNo).padStart(2, '0')}`,
    label: `Sem ${String(weekNo).padStart(2, '0')}/${String(year).slice(-2)}`
  };
}

/**
 * Agrupa as leituras do período em semanas de 7 dias a partir da data inicial do período
 * (ex: "Sem 1 (14/11 a 20/11)"), garantindo que o gráfico semanal reflita exatamente o período selecionado.
 */
function getPeriodWeekRangeLabel(dateStr, periodStartStr, periodEndStr) {
  const startBase = periodStartStr && periodStartStr <= dateStr ? periodStartStr : dateStr;
  const startObj = new Date(`${startBase}T00:00:00Z`);
  const currObj = new Date(`${dateStr}T00:00:00Z`);
  const diffDaysCount = Math.max(0, Math.floor((currObj - startObj) / 86400000));
  const weekIndex = Math.floor(diffDaysCount / 7);

  const weekStartStr = addDaysUTC(startBase, weekIndex * 7);
  let weekEndStr = addDaysUTC(weekStartStr, 6);
  if (periodEndStr && weekEndStr > periodEndStr) {
    weekEndStr = periodEndStr;
  }

  return {
    key: `W${String(weekIndex + 1).padStart(2, '0')}`,
    label: `Sem ${weekIndex + 1} (${formatDayMonth(weekStartStr)}-${formatDayMonth(weekEndStr)})`
  };
}

function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  FileStorage
};
