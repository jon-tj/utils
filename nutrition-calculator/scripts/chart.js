// Canvas rendering of the daily blood-glucose trace.

import {
    BASELINE_MG_DL,
    buildGlucoseEvents,
    sampleGlucose,
    summarizeEventsByMeal,
} from './glucose.js';

export function drawGlucoseChart(canvas, plannedMeals) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const events = buildGlucoseEvents(plannedMeals);
    const samples = sampleGlucose(events, 5);
    const mealSummary = summarizeEventsByMeal(events);

    const yMin = 70;
    const yMax = Math.max(160, Math.ceil(Math.max(...samples.map(s => s.g)) / 10) * 10 + 10);

    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.font = '12px sans-serif';

    const xOfMin = t => pad.left + (t / (24 * 60)) * plotW;
    const yOfMgDl = g => pad.top + (1 - (g - yMin) / (yMax - yMin)) * plotH;

    // Gridlines & y labels every 20 mg/dL.
    ctx.strokeStyle = '#eee';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = Math.ceil(yMin / 20) * 20; g <= yMax; g += 20) {
        const y = yOfMgDl(g);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
        ctx.fillText(String(g), pad.left - 6, y);
    }

    // X-axis (hours) labels every 3h.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h <= 24; h += 3) {
        const x = xOfMin(h * 60);
        ctx.strokeStyle = '#eee';
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
        ctx.fillText(`${h}:00`, x, pad.top + plotH + 6);
    }

    // Axes.
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(W - pad.right, pad.top + plotH);
    ctx.stroke();

    // Baseline line.
    ctx.strokeStyle = '#bbb';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, yOfMgDl(BASELINE_MG_DL));
    ctx.lineTo(W - pad.right, yOfMgDl(BASELINE_MG_DL));
    ctx.stroke();
    ctx.setLineDash([]);

    // Glucose curve.
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((s, i) => {
        const x = xOfMin(s.t);
        const y = yOfMgDl(s.g);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;

    // Meal markers.
    ctx.fillStyle = '#2980b9';
    ctx.strokeStyle = '#2980b9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const ev of mealSummary) {
        const x = xOfMin(ev.time);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(`${ev.label} (GL ${ev.GL.toFixed(1)})`, x, pad.top - 4);
    }

    // Axis titles.
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Time of day', pad.left + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText('Blood glucose (mg/dL)', 0, 0);
    ctx.restore();
}
