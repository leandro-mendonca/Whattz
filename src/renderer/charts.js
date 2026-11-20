/**
 * Motor de Gráficos — Whattz E360
 *
 * Renderiza:
 * 1. Gráfico de Evolução Diária do Período (Consumo em kWh e Custo Estimado em R$)
 * 2. Gráficos de Consumo em kWh (Diário, Semanal, Mensal, Anual)
 */

class ConsumptionChartRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
  }

  /**
   * Renderiza o gráfico de evolução diária com 2 eixos Y (kWh à esquerda e R$ à direita)
   */
  renderSmoothAreaChart(dailySeries = []) {
    if (!this.canvas || !this.ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(620, rect.width || 1000);
    const height = Math.max(230, rect.height || 260);

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    // Fundo branco
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (!dailySeries || dailySeries.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nenhuma leitura registrada no período. Registre leituras ou clique em "Dados Exemplo" na barra lateral.', width / 2, height / 2);
      ctx.restore();
      return;
    }

    const padLeft = 58;
    const padRight = 58;
    const padTop = 20;
    const padBottom = 36;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const kwhValues = dailySeries.map(d => Number(d.kwh) || 0);
    const costValues = dailySeries.map(d => Number(d.costBRL) || 0);
    const avgKwh = kwhValues.reduce((a, b) => a + b, 0) / Math.max(1, kwhValues.length);

    const maxKwh = Math.max(...kwhValues, avgKwh, 1);
    const yMaxKwh = Math.ceil(maxKwh * 1.2);

    const maxCost = Math.max(...costValues, 1);
    const yMaxCost = Math.ceil(maxCost * 1.25);

    // Linhas horizontais de grade
    const steps = 4;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps;
      const y = padTop + plotHeight - (ratio * plotHeight);

      ctx.strokeStyle = '#e2e8f0';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Eixo Y esquerdo (Consumo kWh)
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'right';
      ctx.fillText(`${(yMaxKwh * ratio).toFixed(1)}`, padLeft - 8, y);

      // Eixo Y direito (Custo R$)
      ctx.fillStyle = '#80314c';
      ctx.textAlign = 'left';
      ctx.fillText(`R$ ${(yMaxCost * ratio).toFixed(0)}`, width - padRight + 8, y);
    }

    // Rótulos verticais dos eixos
    ctx.save();
    ctx.translate(14, padTop + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#1e293b';
    ctx.font = '600 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Consumo (kWh)', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(width - 10, padTop + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#80314c';
    ctx.font = '600 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Custo Diário (R$)', 0, 0);
    ctx.restore();

    const n = dailySeries.length;
    const getX = (idx) => n === 1
      ? padLeft + plotWidth / 2
      : padLeft + (idx / (n - 1)) * plotWidth;
    const getYKwh = (val) => padTop + plotHeight - ((Math.max(0, val) / yMaxKwh) * plotHeight);
    const getYCost = (val) => padTop + plotHeight - ((Math.max(0, val) / yMaxCost) * plotHeight);

    // 1. Curva de Referência / Geração Solar (kWh)
    const limePoints = dailySeries.map((d, idx) => {
      const solarOrRef = Number(d.solarInjectedKwh) > 0
        ? Number(d.solarInjectedKwh)
        : avgKwh * (0.85 + 0.25 * Math.sin(idx * 0.9));
      return { x: getX(idx), y: getYKwh(solarOrRef) };
    });
    drawSmoothArea(ctx, limePoints, padTop + plotHeight, 'rgba(197, 214, 71, 0.28)', '#c5d647', 2);

    // 2. Curva Principal — Consumo Diário (kWh)
    const forestPoints = dailySeries.map((d, idx) => ({
      x: getX(idx),
      y: getYKwh(d.kwh),
      kwh: d.kwh,
      isCutoff: d.isCutoff
    }));
    drawSmoothArea(ctx, forestPoints, padTop + plotHeight, 'rgba(59, 110, 76, 0.22)', '#3b6e4c', 2.4);

    // 3. Curva de Custo Diário Estimado (R$)
    const burgundyPoints = dailySeries.map((d, idx) => ({
      x: getX(idx),
      y: getYCost(d.costBRL)
    }));
    drawSmoothLine(ctx, burgundyPoints, '#80314c', 2);

    // Pontos e Rótulos do Eixo X
    const labelStep = n > 16 ? Math.ceil(n / 10) : 1;
    forestPoints.forEach((pt, idx) => {
      if (pt.isCutoff) {
        ctx.fillStyle = '#80314c';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#3b6e4c';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (idx % labelStep === 0 || idx === n - 1) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(dailySeries[idx].label, pt.x, padTop + plotHeight + 18);
      }
    });

    ctx.restore();
  }

  /**
   * Renderiza o gráfico da página de Analytics (Diário, Semanal, Mensal, Anual em kWh)
   */
  render(series = [], mode = 'daily') {
    if (mode === 'daily') {
      return this.renderSmoothAreaChart(series);
    }

    if (!this.canvas || !this.ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(600, rect.width || 960);
    const height = Math.max(300, rect.height || 340);

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (!series || series.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nenhuma leitura registrada para exibir neste gráfico.', width / 2, height / 2);
      ctx.restore();
      return;
    }

    const padLeft = 66;
    const padRight = 28;
    const padTop = 32;
    const padBottom = 46;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const values = series.map(item => Number(item.kwh) || 0);
    const maxVal = Math.max(...values, 1);
    const yMax = Math.ceil(maxVal * 1.18);

    const gridSteps = 5;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridSteps; i++) {
      const ratio = i / gridSteps;
      const y = padTop + plotHeight - (ratio * plotHeight);
      const val = (yMax * ratio).toFixed(1);

      ctx.strokeStyle = '#e2e8f0';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#64748b';
      ctx.fillText(`${val} kWh`, padLeft - 10, y);
    }

    // Barras de consumo em kWh
    const count = series.length;
    const slotWidth = plotWidth / count;
    const barWidth = Math.min(44, Math.max(12, slotWidth * 0.52));

    series.forEach((item, index) => {
      const kwh = Number(item.kwh) || 0;
      const barHeight = (kwh / yMax) * plotHeight;
      const x = padLeft + (index * slotWidth) + ((slotWidth - barWidth) / 2);
      const y = padTop + plotHeight - barHeight;

      ctx.fillStyle = index % 2 === 0 ? '#3b6e4c' : '#8fb198';
      ctx.fillRect(x, y, barWidth, Math.max(2, barHeight));

      ctx.fillStyle = '#334155';
      ctx.font = '600 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${kwh.toFixed(1)} kWh`, x + (barWidth / 2), y - 8);

      ctx.fillStyle = '#64748b';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillText(String(item.label || ''), x + (barWidth / 2), padTop + plotHeight + 18);
    });

    ctx.restore();
  }
}

function drawSmoothArea(ctx, points, baselineY, fillColor, strokeColor, lineWidth) {
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, baselineY);
  ctx.lineTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    ctx.bezierCurveTo(midX, curr.y, midX, next.y, next.x, next.y);
  }

  ctx.lineTo(points[points.length - 1].x, baselineY);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  drawSmoothLine(ctx, points, strokeColor, lineWidth);
  ctx.restore();
}

function drawSmoothLine(ctx, points, strokeColor, lineWidth) {
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    ctx.bezierCurveTo(midX, curr.y, midX, next.y, next.x, next.y);
  }

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

window.ConsumptionChartRenderer = ConsumptionChartRenderer;
