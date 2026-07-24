/* ==========================================================================
   Limn – Report Generation, HTML Export, RRC Overlay, Probe
   Extracted from app.js for modularity
   ========================================================================== */

import { getCDSEToken } from './auth.js';
import { INDICES } from './indices.js';
import { getScriptContent } from './map.js?v=78';
import { showToast } from './ui.js?v=78';
import { fetchValidSentinelDates } from './sentinel-catalog.js';

const SH_WMS_URL = 'https://sh.dataspace.copernicus.eu/ogc/wms/959ea2c5-5892-4b36-82b3-76e6bdb93c8a';

function parseServiceError(text) {
    if (!text) return '';
    try {
        const data = JSON.parse(text);
        return data.description || data.message || data.error || '';
    } catch (_) {
        const cdataMatch = text.match(/<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>/);
        if (cdataMatch) return cdataMatch[1].replace(/\s+/g, ' ').trim();
        return text.replace(/\s+/g, ' ').trim().slice(0, 240);
    }
}

function publishSentinelHubError(status, body) {
    const detail = parseServiceError(body);
    const eventDetail = {
        status,
        detail,
        message: detail ? `Sentinel Hub request failed HTTP ${status}: ${detail}` : `Sentinel Hub request failed HTTP ${status}.`,
        isQuotaExhausted: /insufficient processing units|additional credits|requests available/i.test(detail)
    };
    window.sentinelHubLastError = eventDetail;
    window.dispatchEvent(new CustomEvent('sentinelhuberror', { detail: eventDetail }));
}

// Helper: Build clean WMS params for offline HTML export (bypasses Leaflet object serialization)
function buildHTMLWMSParams(timeStr, isDiff) {
    const scriptContent = getScriptContent(window.CONFIG, window.state.activeIndex, isDiff, false, window.state);
    const wmsLayer = window.state.activeIndex === 's1_sar' ? 'SENTINEL1-GRD' : (window.CONFIG.SH_WMS_LAYER || 'AGRICULTURE');
    return {
        service: 'WMS',
        request: 'GetMap',
        version: '1.3.0',
        layers: wmsLayer,
        format: 'image/png',
        transparent: true,
        time: timeStr,
        maxcc: 20,
        evalscript: btoa(unescape(encodeURIComponent(scriptContent)))
    };
}

// ── HTML REPORT EXPORT ────────────────────────────
export async function downloadHTMLReport() {
    const btn = document.getElementById('btn-print-report');
    if (btn) {
        btn.innerText = "Building Offline Report... Please Wait";
        btn.disabled = true;
    }

    try {
        const runDate = document.getElementById('report-date-run').innerText;
        const aoiBounds = document.getElementById('report-aoi-bounds').innerText;
        const indexName = document.getElementById('report-index-name').innerText;
        const mathLogic = document.getElementById('report-math').innerHTML;
        const infoText = document.getElementById('report-info').innerText;
        const timeText = document.getElementById('report-time').innerText;

        let isCompare = window.state.mode === 'compare';
        const activeCfg = INDICES[window.state.activeIndex] || {};

        const bounds = window.aoiDrawnItem.getBounds();
        const bboxStr = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

        // Helpers for fetching WMS as Base64 for offline embedding
        const fetchAsBase64 = async (url) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) return null;
                const blob = await resp.blob();
                return new Promise((res) => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (e) {
                console.warn("Failed to fetch map overlay for offline export", e);
                return null;
            }
        };

        const wmsLayerParam = window.state.activeIndex === 's1_sar' ? 'SENTINEL1-GRD' : (window.CONFIG.SH_WMS_LAYER || 'AGRICULTURE');
        const safeB64 = (str) => btoa(unescape(encodeURIComponent(str)));

        let b64TcBg = window.state.activeIndex === 's1_sar' ? safeB64(getScriptContent(window.CONFIG, 's1_sar', false, false, window.state)) : safeB64(getScriptContent(window.CONFIG, 'tc', false, false, window.state));

        const getWmsUrl = (timeRangeStr, evalB64, transparent) => {
            return `${SH_WMS_URL}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${wmsLayerParam}&FORMAT=image/png&TRANSPARENT=${transparent}&VERSION=1.3.0&TIME=${timeRangeStr}&MAXCC=60&WIDTH=600&HEIGHT=400&CRS=CRS:84&BBOX=${bboxStr}&EVALSCRIPT=${encodeURIComponent(evalB64)}`;
        };

        let mapHtml = "";

        // Grab metrics data
        let mMaxD = document.getElementById('metric-max-date') ? document.getElementById('metric-max-date').innerText : '--';
        let mMaxV = document.getElementById('metric-max-val') ? document.getElementById('metric-max-val').innerText : '--';
        let mAvgD = document.getElementById('metric-avg-dates') ? document.getElementById('metric-avg-dates').innerText : '--';
        let mAvgV = document.getElementById('metric-avg-val') ? document.getElementById('metric-avg-val').innerText : '--';
        let mLeak = document.getElementById('metric-leak-start') ? document.getElementById('metric-leak-start').innerText : '--';

        let metricsHtml = `
            <div style="margin-top: 20px; padding: 15px; background: #1a1a1a; border-radius: 6px; border: 1px solid #333;">
                <h4 style="margin: 0 0 10px 0; color: #33AAFF; font-size: 14px; text-transform: uppercase;">Key Metrics</h4>
                <table style="width: 100%; font-size: 13px; color: #ddd; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 5px 0;"><strong>Max Single Date:</strong></td>
                        <td style="padding: 5px 0;">${mMaxD} (<span style="color: #F0501E; font-family: monospace;">${mMaxV}</span>)</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0;"><strong>Highest 5-Scene Avg:</strong></td>
                        <td style="padding: 5px 0;">${mAvgD} (<span style="color: #F0501E; font-family: monospace;">${mAvgV}</span>)</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0; vertical-align: top;"><strong>Likely Leak Start:</strong></td>
                        <td style="padding: 5px 0; color: #33AAFF; font-family: monospace;">${mLeak}</td>
                    </tr>
                </table>
            </div>
        `;

        if (isCompare) {
            let rd1 = document.getElementById('date-t1').value;
            let rd2 = document.getElementById('date-t2').value;
            if (rd1 > rd2) { const tmp = rd1; rd1 = rd2; rd2 = tmp; }

            let getPStr = (dStr) => {
                let dPrior = new Date(dStr); dPrior.setUTCDate(dPrior.getUTCDate() - 20);
                return dPrior.toISOString().split('T')[0];
            };

            const t1BgB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd1)}/${rd1}`, b64TcBg, false));
            const t1IdxB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd1)}/${rd1}`, safeB64(getScriptContent(window.CONFIG, window.state.activeIndex, false, false, window.state)), true));

            const t2BgB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd2)}/${rd2}`, b64TcBg, false));
            const t2IdxB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd2)}/${rd2}`, safeB64(getScriptContent(window.CONFIG, window.state.activeIndex, false, false, window.state)), true));

            // The diff logic uses the true time-range syntax for the evalscript
            const diffB64Math = safeB64(getScriptContent(window.CONFIG, window.state.activeIndex, true, false, window.state));
            const diffIdxB64 = await fetchAsBase64(getWmsUrl(`${rd1}/${rd2}`, diffB64Math, true));

            const stackImgs = (bg, fg, label) => `
                <div style="position: relative; width: 100%; height: 260px; background: #000; border-radius: 6px; overflow: hidden; border: 1px solid #333;">
                    ${bg ? `<img src="${bg}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;" />` : ''}
                    ${fg ? `<img src="${fg}" style="position: absolute; width: 100%; height: 100%; object-fit: cover; mix-blend-mode: normal;" />` : ''}
                    <div style="position: absolute; bottom: 10px; right: 10px; background: rgba(0,0,0,0.7); padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; color: #fff;">${label}</div>
                </div>
            `;

            mapHtml = `
            <h3>Side-by-Side Analysis (T1 vs T2)</h3>
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <div style="flex: 1;">${stackImgs(t1BgB64, t1IdxB64, `T1: ${rd1}`)}</div>
                <div style="flex: 1;">${stackImgs(t2BgB64, t2IdxB64, `T2: ${rd2}`)}</div>
            </div>
            <h3 style="color: #F0501E; margin-top: 30px;">Difference Heatmap (\u0394 T1 \u2192 T2)</h3>
            <p style="font-size: 13px; color: #bbb; margin-top: -10px; margin-bottom: 15px;">
                <strong style="color: #FF3333;">Red</strong> = ${activeCfg.diffLabels ? activeCfg.diffLabels[0] : 'Decrease'} &nbsp;|&nbsp; 
                <strong style="color: #33AAFF;">Blue</strong> = ${activeCfg.diffLabels ? activeCfg.diffLabels[1] : 'Increase'}
            </p>
            ${stackImgs(t2BgB64, diffIdxB64, 'Delta Extent')}
            `;
        } else {
            let rd = window.ALL_DATES[window.state.monthIndex].value;
            let getPStr = (dStr) => {
                let dPrior = new Date(dStr); dPrior.setUTCDate(dPrior.getUTCDate() - 20);
                return dPrior.toISOString().split('T')[0];
            };
            const sBgB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd)}/${rd}`, b64TcBg, false));
            const sIdxB64 = await fetchAsBase64(getWmsUrl(`${getPStr(rd)}/${rd}`, safeB64(getScriptContent(window.CONFIG, window.state.activeIndex, false, false, window.state)), true));

            mapHtml = `
            <h3>Area of Interest (AOI)</h3>
            <div style="position: relative; width: 100%; height: 350px; background: #000; border-radius: 6px; overflow: hidden; border: 1px solid #333;">
                ${sBgB64 ? `<img src="${sBgB64}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;" />` : ''}
                ${sIdxB64 ? `<img src="${sIdxB64}" style="position: absolute; width: 100%; height: 100%; object-fit: cover; mix-blend-mode: normal;" />` : ''}
            </div>
            `;
        }

        let gifHtml = "";
        const diffBtn = document.getElementById('btn-download-gif-diff');
        const idxBtn = document.getElementById('btn-download-gif-index');

        // Note: the gifshot encoder creates a 'data:' URI and places it directly in the 'href'
        if (diffBtn && diffBtn.href && diffBtn.href.startsWith('data:image/gif')) {
            gifHtml += `
            <div style="margin-top: 30px; text-align: center;">
                <h3 style="color: #F0501E;">Difference Heatmap (GIF)</h3>
                <img src="${diffBtn.href}" style="max-width: 100%; border-radius: 6px; border: 1px solid #333;" />
            </div>`;
        }

        if (idxBtn && idxBtn.href && idxBtn.href.startsWith('data:image/gif')) {
            gifHtml += `
            <div style="margin-top: 30px; text-align: center;">
                <h3 style="color: #1C85A6;">Index Gradient (GIF)</h3>
                <img src="${idxBtn.href}" style="max-width: 100%; border-radius: 6px; border: 1px solid #333;" />
            </div>`;
        }

        let chartContainerHtml = "";
        let chartScriptHtml = "";

        if (reportChartInst && document.querySelector('.report-chart').style.display !== 'none') {
            const cleanData = {
                labels: reportChartInst.data.labels,
                datasets: reportChartInst.data.datasets.map(ds => ({
                    label: ds.label,
                    data: ds.data,
                    borderColor: ds.borderColor,
                    backgroundColor: ds.backgroundColor,
                    borderWidth: ds.borderWidth,
                    fill: ds.fill,
                    tension: ds.tension,
                    pointRadius: ds.pointRadius,
                    pointHitRadius: ds.pointHitRadius,
                    spanGaps: ds.spanGaps,
                    hidden: ds.hidden,
                    order: ds.order
                }))
            };

            chartContainerHtml = `
            <div class="chart-wrapper">
                <canvas id="chart"></canvas>
            </div>`;

            chartScriptHtml = `
            const ctx = document.getElementById('chart').getContext('2d');
            const chartData = ${JSON.stringify(cleanData)};
            
            new Chart(ctx, {
                type: 'line',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { 
                        legend: { display: true, labels: { color: 'rgba(255,255,255,0.8)', usePointStyle: true, boxWidth: 8 } }
                    },
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)', maxRotation: 45, minRotation: 45, maxTicksLimit: 12 } }
                    }
                }
            });`;
        }

        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Sentinel Report - ${runDate}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
    <style>
        body { font-family: sans-serif; background-color: #121212; color: #fff; margin: 40px; }
        .container { max-width: 900px; margin: auto; background: #1e1e1e; padding: 30px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h1, h2, h3 { color: #1C85A6; }
        .meta-box { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #333; line-height: 1.5; }
        .meta-box p { margin: 5px 0; font-size: 14px; }
        .chart-wrapper { height: 400px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid #333; padding: 15px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Limn Report</h1>
        
        <div class="meta-box">
            <p><strong>Generated:</strong> ${runDate}</p>
            <p><strong>AOI Bounds:</strong> ${aoiBounds}</p>
            <p><strong>Active Index:</strong> ${indexName}</p>
            <p><strong>Selected Date(s):</strong> ${timeText}</p>
            <p><strong>Scientific Context:</strong><br/>${infoText}</p>
            <p style="margin-top: 10px; font-family: monospace; color: #1C85A6;">${mathLogic}</p>
        </div>

        ${mapHtml}

        ${chartContainerHtml}
        
        ${gifHtml}
    </div>

    <script>
        ${chartScriptHtml}
    </script>
</body>
</html>`;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sentinel-report-${Date.now()}.html`;
        a.click();
        URL.revokeObjectURL(url);

        if (btn) {
            btn.innerText = "Save Report (.html)";
            btn.disabled = false;
        }
    } catch (err) {
        console.error("Report Export Failed:", err);
        showToast("Failed to build offline report. See console.", 'warning');
    } finally {
        if (btn) {
            btn.innerText = "Save Report (.html)";
            btn.disabled = false;
        }
    }
}

// ── RRC Spill Overlay ─────────────────────────────────────────────────────────
// Loads ./data/rrc_spills.json (once, cached in state.rrcSpillData) and renders
// orange/red Leaflet circleMarkers. Each marker has a popup with date, volume,
// operator, county, and RRC district. A sidebar badge shows the total count.

export async function initRrcSpillOverlay() {
    // Remove any existing layer first
    if (window.state.rrcSpillLayer) {
        window.state.map.removeLayer(window.state.rrcSpillLayer);
        window.state.rrcSpillLayer = null;
    }

    // Fetch and cache data
    if (!window.state.rrcSpillData) {
        try {
            const resp = await fetch('./data/rrc_spills.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            window.state.rrcSpillData = await resp.json();
        } catch (err) {
            console.error('[RRC Overlay] Failed to load spill data:', err);
            return;
        }
    }

    const features = window.state.rrcSpillData.features || [];

    // Radius by volume (BBL)
    const getRadius = (vol) => {
        if (vol >= 2000) return 13;
        if (vol >= 1000) return 10;
        if (vol >= 500) return 7;
        return 5;
    };

    // Color ramp: orange → deep red
    const getColor = (vol) => {
        if (vol >= 2000) return '#FF1744';  // Major — bright red
        if (vol >= 1000) return '#FF5722';  // Significant — deep orange-red
        if (vol >= 500) return '#FF6B35';  // Moderate — orange
        return '#FF9060';                    // Minor — pale orange
    };

    const spillMarkers = [];

    features.forEach(f => {
        const p = f.properties;
        const coords = f.geometry.coordinates; // GeoJSON: [lng, lat]
        const lat = coords[1], lng = coords[0];

        const vol = p.volume_bbl || 0;
        const radius = getRadius(vol);
        const color = getColor(vol);

        const marker = L.circleMarker([lat, lng], {
            radius: radius,
            fillColor: color,
            color: '#1a0a00',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.88
        });

        const volStr = vol.toLocaleString();
        const severityEmoji =
            vol >= 2000 ? '🔴 Major' :
                vol >= 1000 ? '🟠 Significant' :
                    vol >= 500 ? '🟡 Moderate' : '⚪ Minor';

        marker.bindPopup(`
            <div style="font-family:'Space Grotesk',sans-serif;min-width:230px;color:#f0f0f0;">
                <div style="font-size:11px;font-weight:700;color:#FF6B35;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">⚠ RRC Spill Incident</div>
                <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#fff;">${p.incident_type}</div>
                <table style="font-size:11px;border-collapse:collapse;width:100%;">
                    <tr><td style="color:#999;padding:2px 8px 2px 0;white-space:nowrap;">Operator</td><td style="color:#fff;">${p.operator}</td></tr>
                    <tr><td style="color:#999;padding:2px 8px 2px 0;">County</td><td style="color:#fff;">${p.county} — RRC District ${p.district}</td></tr>
                    <tr><td style="color:#999;padding:2px 8px 2px 0;">Date</td><td style="color:#fff;">${p.date}</td></tr>
                    <tr><td style="color:#999;padding:2px 8px 2px 0;">Volume</td><td style="color:${color};font-weight:700;">${volStr} BBL &nbsp;${severityEmoji}</td></tr>
                </table>
                <div style="margin-top:9px;padding:8px;background:rgba(255,107,53,.1);border-radius:4px;border:1px solid rgba(255,107,53,.25);font-size:11px;color:#ccc;line-height:1.5;">${p.description}</div>
                <div style="margin-top:7px;font-size:10px;color:#555;">Source: TX RRC Inspections &amp; Violations — rrc.texas.gov</div>
            </div>
        `, { maxWidth: 310, className: 'rrc-spill-popup' });

        spillMarkers.push(marker);
    });

    window.state.rrcSpillLayer = L.layerGroup(spillMarkers).addTo(window.state.map);

    // Update sidebar count badge
    const badge = document.getElementById('rrc-spill-count');
    if (badge) {
        badge.textContent = `${features.length} incidents loaded`;
        badge.style.display = 'block';
    }
}

export async function probeAcquisitions() {
    if (!window.state.map) return;

    let validDates = new Set();
    let isTrialMode = false;

    try {
        const center = window.state.map.getCenter();
        const token = await getCDSEToken();
        const bbox = [center.lng - 0.05, center.lat - 0.05, center.lng + 0.05, center.lat + 0.05];

        // Search back to START_YEAR for full selector coverage
        const latest = new Date();
        const past = new Date(Date.UTC(window.CONFIG.START_YEAR || 2020, 0, 1));
        const fromISO = `${past.toISOString().split('.')[0]}Z`;
        const toISO = `${latest.toISOString().split('.')[0]}Z`;

        const result = await fetchValidSentinelDates(bbox, fromISO, toISO, token, publishSentinelHubError);
        validDates = result.validDates;
        isTrialMode = result.authError;
    } catch (e) {
        console.warn("Probe failed (switching to Trial Mode for UI tags):", e);
        isTrialMode = true;
    }

    // IF in Trial Mode (auth error) or the AOI genuinely returned nothing, generate a consistent
    // mock distribution so the selector still shows a usable, non-empty date list (fail open).
    if (isTrialMode || validDates.size === 0) {
        window.ALL_DATES.forEach((d, i) => {
            if (i % 5 === 0) validDates.add(d.value); // roughly S2/S1 combined revisit cadence
        });
    }

    window.state.validSentinelDates = validDates;
    if (typeof window.rebuildDateSelectors === 'function') {
        window.rebuildDateSelectors(validDates);
    }
}

// ── REPORT MODAL FOCUS & KEYBOARD ──────────────────
let lastReportTrigger = null;

function trapReportFocus(e) {
    const modal = document.getElementById('report-modal');
    if (!modal || modal.style.display === 'none') return;

    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.key === 'Tab') {
        if (e.shiftKey) {
            if (document.activeElement === first) {
                last.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === last) {
                first.focus();
                e.preventDefault();
            }
        }
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('report-modal');
        if (modal && modal.style.display !== 'none') {
            closeReportModal();
        }
    }
});

export function openReportModal() {
    lastReportTrigger = document.activeElement;
    const modal = document.getElementById('report-modal');
    modal.style.display = 'flex';
    document.addEventListener('keydown', trapReportFocus);
    // Focus close button initially
    setTimeout(() => {
        const closeBtn = document.getElementById('btn-close-report');
        if (closeBtn) closeBtn.focus();
    }, 100);
}

export function closeReportModal() {
    const modal = document.getElementById('report-modal');
    modal.style.display = 'none';
    document.removeEventListener('keydown', trapReportFocus);
    if (lastReportTrigger) lastReportTrigger.focus();
}

// Hook into existing buttons
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('btn-close-report');
    if (closeBtn) {
        closeBtn.onclick = closeReportModal;
    }
});
