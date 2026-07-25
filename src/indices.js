/* ==========================================================================
   Limn – Index Definitions & Evalscript Utilities
   Extracted from app.js for modularity
   ========================================================================== */

export const CALIBRATION_PRESETS = {
    permian: {
        name: "Permian Basin (Arid)",
        bsiMask: -0.3,
        bsiOffset: 0.3,
        ndwiOffset: 0.5,
        pwiSalinityOffset: 0.10,
        pwiHydrocarbonOffset: 0.30,
        pwiHmriOffset: 2.0
    },
    standard: {
        name: "Standard (Temperate/Wet)",
        bsiMask: -0.1,
        bsiOffset: 0.0,
        ndwiOffset: 0.0,
        pwiSalinityOffset: 0.05,
        pwiHydrocarbonOffset: 0.15,
        pwiHmriOffset: 1.5
    }
};

// Sentinel Hub WMS configurations are bound to a collection. The bundled
// AGRICULTURE layer is S2 L1C, so it cannot accept the L2A-only SCL band.
// Keep the analytical script unchanged for COG/GEE/L2A WMS, but remove the
// explicitly marked quality block for an L1C WMS carrier layer.
export function adaptEvalscriptForSentinelWms(scriptContent, supportsScl = false) {
    if (!scriptContent || supportsScl) return scriptContent;
    return scriptContent
        .replace(/,\s*['"]SCL['"]/g, '')
        .replace(/\s*\/\/ SCL_QA_START[\s\S]*?\/\/ SCL_QA_END\s*/g, '\n');
}

// Evalscript wrapper utility
export const genEvalscript = (bands, logic) => {
const inputBands = [...new Set([...bands, 'SCL'])];
return `//VERSION=3
function setup() {
  return {
    input: [${inputBands.map(b => `'${b}'`).join(', ')}, "dataMask"],
    output: { bands: 4 },
    upsampling: "BILINEAR",
    downsampling: "BILINEAR"
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  // SCL_QA_START
  // Pixel-level scene classification gate. Retain vegetation, bare ground,
  // water, and unclassified clear pixels; reject cloud, shadow, snow,
  // saturated/defective, dark-feature, and no-data classes.
  const clearPixel = sample.SCL === 4 || sample.SCL === 5 || sample.SCL === 6 || sample.SCL === 7;
  if (!clearPixel) return [0, 0, 0, 0];
  // SCL_QA_END
  ${logic}
}
`;
};

// Multi-Temporal Evalscript wrapper for differences
export const genDiffEvalscript = (bands, calcLogic) => {
const inputBands = [...new Set([...bands, 'SCL'])];
return `//VERSION=3
function setup() {
  return {
    input: [${inputBands.map(b => `'${b}'`).join(', ')}, "dataMask"],
    output: { bands: 4 },
    mosaicking: "ORBIT",
    upsampling: "BILINEAR",
    downsampling: "BILINEAR"
  };
}
function evaluatePixel(samples) {
  if (samples.length < 2) return [0, 0, 0, 0.1]; // Need 2 dates
  let s1 = samples[samples.length - 1]; // oldest (T1)
  let s2 = samples[0]; // newest (T2)
  if (s1.dataMask === 0 || s2.dataMask === 0) return [0, 0, 0, 0];
  // SCL_QA_START
  const clear1 = s1.SCL === 4 || s1.SCL === 5 || s1.SCL === 6 || s1.SCL === 7;
  const clear2 = s2.SCL === 4 || s2.SCL === 5 || s2.SCL === 6 || s2.SCL === 7;
  if (!clear1 || !clear2) return [0, 0, 0, 0];
  // SCL_QA_END
  
  let val1 = ${calcLogic.replace(/sample/g, 's1')};
  let val2 = ${calcLogic.replace(/sample/g, 's2')};
  let diff = val2 - val1;
  
  // Apply visual filter masking for difference heatmaps specifically
  // Difference maps are visually centered around 0 (no difference).
  // Thus we mask out pixels where the CHANGE (absolute difference) is below the percentage threshold.
  // diff generally spans roughly -0.3 to 0.3 for most indices, so we scale VISUAL_FILTER to compare it.
  if (typeof VISUAL_FILTER !== 'undefined' && Math.abs(diff) < (VISUAL_FILTER * 0.3)) {
      return [0, 0, 0, 0];
  }

  if (diff < -0.15) return [1.0, 0.2, 0.2, 0.8]; // Strong decrease
  if (diff < -0.05) return [1.0, 0.4, 0.4, 0.6]; // Slight decrease
  if (diff > 0.15) return [0.2, 0.6, 1.0, 0.8]; // Strong increase
  if (diff > 0.05) return [0.4, 0.7, 1.0, 0.6]; // Slight increase
  return [0.2, 0.2, 0.2, 0.3]; // Stable
}
`;
};

// Deep Fusion Evalscript wrapper (Multi-Source S1+S2)
export const genDeepFusionEvalscript = (bands, logic) => `//VERSION=3
function setup() {
  return {
    input: [
      { datasource: "sentinel-2-l2a", id: "s2", bands: ["B02", "B03", "B04", "B05", "B07", "B08", "B8A", "B11", "B12", "dataMask"] },
      { datasource: "sentinel-1-grd", id: "s1", bands: ["VV", "VH"] }
    ],
    output: { bands: 4 },
    mosaicking: "ORBIT",
    upsampling: "BILINEAR",
    downsampling: "BILINEAR"
  };
}

function evaluatePixel(samples, scenes) {
    // 1. Find most recent valid S2 sample
    let s2 = null;
    const s2Samples = samples.s2 || [];
    for (let i = 0; i < s2Samples.length; i++) {
        const s = s2Samples[i];
        if (s.dataMask === 1 && (s.B02 > 0 || s.B11 > 0)) {
            s2 = s;
            break;
        }
    }
    if (!s2) return [0,0,0,0];

    // 2. Find most recent valid S1 sample
    let s1 = null;
    const s1Samples = samples.s1 || [];
    for (let i = 0; i < s1Samples.length; i++) {
        const s = s1Samples[i];
        if (s.VH !== 0 && s.VV !== 0) {
            s1 = s;
            break;
        }
    }
    
    // 3. Construct flattened sample with safe fallbacks
    // If S1 is missing (e.g. no recent overpass), we use a placeholder that won't trigger the alert
    const effectiveS1 = s1 || { VV: 0.5, VH: 0.05, dataMask: 1 };
    
    // Manual merge for maximum compatibility
    const sampleFlat = {};
    for (let key in effectiveS1) sampleFlat[key] = effectiveS1[key];
    for (let key in s2) sampleFlat[key] = s2[key];

    ${logic.replace(/sample/g, 'sampleFlat')}
}
`;

// Multi-Temporal Evalscript for Cumulative MAX detection
export const genCumulativeEvalscript = (bands, logic, paletteStr) => {
const inputBands = [...new Set([...bands, 'SCL'])];
return `//VERSION=3
function setup() {
  return {
    input: [${inputBands.map(b => `'${b}'`).join(', ')}, "dataMask"],
    output: { bands: 4 },
    mosaicking: "ORBIT",
    upsampling: "BILINEAR",
    downsampling: "BILINEAR"
  };
}

function evaluatePixel(samples) {
  let maxVal = 0;
  for (let i = 0; i < samples.length; i++) {
    let sample = samples[i];
    if (sample.dataMask === 0) continue;
    // SCL_QA_START
    const clearPixel = sample.SCL === 4 || sample.SCL === 5 || sample.SCL === 6 || sample.SCL === 7;
    if (!clearPixel) continue;
    // SCL_QA_END
    let val = ${logic};
    if (val > maxVal) maxVal = val;
  }
  
  if (maxVal === 0) return [0, 0, 0, 0];
  
  // Apply palette to the max discovered value
  ${colorBlend('maxVal', paletteStr)}
}
`;
};

// Advanced continuous color blending logic for evalscripts
export function colorBlend(valExpr, stopsStr) {
    return `
  let v = ${valExpr};
  if (!isFinite(v) || isNaN(v)) return [0,0,0,0];
  v = Math.max(0, Math.min(1, v));
  if (typeof VISUAL_FILTER !== 'undefined' && v < VISUAL_FILTER) return [0,0,0,0];
  const stops = ${stopsStr};
  let i = 0;
  while (i < stops.length - 1 && v >= stops[i+1][0]) { i++; }
  if (i === stops.length - 1) { 
      let s = stops[i];
      let a = (s.length > 4) ? s[4] : 1.0;
      return [s[1]/255, s[2]/255, s[3]/255, a];
  }
  let s0 = stops[i], s1 = stops[i+1];
  let t = (v - s0[0]) / (s1[0] - s0[0]);
  let a0 = (s0.length > 4) ? s0[4] : 1.0;
  let a1 = (s1.length > 4) ? s1[4] : 1.0;
  return [
      (s0[1] + t * (s1[1] - s0[1])) / 255,
      (s0[2] + t * (s1[2] - s0[2])) / 255,
      (s0[3] + t * (s1[3] - s0[3])) / 255,
      a0 + t * (a1 - a0)
  ];`;
}

// Palette Definitions
// Palette Definitions
export const PALETTE_NDMI = "[[0, 212, 106, 36], [0.35, 239, 216, 122], [0.6, 28, 133, 166], [1, 10, 60, 100]]";
export const PALETTE_NDWI = "[[0, 130, 70, 20], [0.35, 215, 170, 60], [0.6, 80, 150, 200], [1, 20, 80, 180]]";
export const PALETTE_SI = "[[0, 36, 51, 64], [0.15, 180, 130, 40], [0.3, 220, 140, 50], [1, 240, 80, 30]]";
export const PALETTE_VEG = "[[0, 160, 120, 50], [0.3, 210, 180, 60], [0.6, 90, 160, 60], [1, 20, 100, 40]]"; // Brown -> Yellow -> Dark Green
export const PALETTE_MSI = "[[0, 28, 133, 166], [0.5, 239, 216, 122], [1, 212, 106, 36]]"; // Blue -> Yellow -> Orange (Inverse of NDMI)
export const PALETTE_BRINE = "[[0, 10, 60, 100], [0.35, 120, 100, 50], [0.6, 240, 80, 30], [1, 230, 20, 20]]"; // Blue -> Brown -> Orange -> Red
export const PALETTE_CSI = "[[0, 160, 120, 50], [0.5, 100, 220, 80], [1, 0, 255, 255]]"; // Brown -> Lime -> Cyan
export const PALETTE_HCAI = "[[0, 245, 222, 179], [0.5, 139, 69, 19], [1, 0, 0, 0]]"; // Wheat -> SaddleBrown -> Black
export const PALETTE_HMRI = "[[0, 230, 230, 250], [0.5, 128, 0, 128], [1, 255, 0, 255]]"; // Lavender -> Purple -> Magenta
export const PALETTE_PWI = "[[0, 0, 0, 0.0], [0.1, 0, 255, 255, 1.0], [0.5, 255, 0, 255, 1.0], [1, 255, 255, 0, 1.0]]"; // Restrictive: Trans -> Cyan -> Magenta -> Yellow
export const PALETTE_BSI = "[[0, 0, 0, 0], [0.1, 68, 136, 51], [0.15, 210, 180, 60], [1, 160, 120, 50]]"; // Black -> Green -> Yellow -> Brown
export const PALETTE_REAI = "[[0, 13, 26, 46], [0.35, 46, 92, 138], [0.65, 196, 122, 30], [1, 232, 196, 74]]"; // Navy -> Blue -> Bronze -> Yellow
export const PALETTE_VCBI = "[[0, 10, 32, 16], [0.3, 26, 96, 48], [0.6, 200, 160, 0], [1, 224, 80, 16]]"; // Dark Green -> Forest -> Gold -> Orange
export const PALETTE_FBC = "[[0, 26, 8, 0], [0.3, 139, 37, 0], [0.6, 212, 88, 26], [1, 255, 179, 71]]"; // Black -> Deep Red -> Burnt Orange -> Peach
export const PALETTE_HPWI = "[[0, 44, 62, 80], [0.5, 241, 196, 15], [1, 231, 76, 60]]"; // Dark Blue -> Gold -> Red
export const PALETTE_LBI = "[[0, 0, 0, 0], [0.3, 0, 210, 255], [0.7, 0, 136, 255], [1, 255, 0, 255]]";
export const PALETTE_TRI = "[[0, 26, 10, 0], [0.3, 128, 64, 0], [0.7, 153, 51, 255], [1, 255, 0, 255]]";
export const PALETTE_BPI = "[[0, 34, 34, 34], [0.3, 68, 68, 68], [0.7, 0, 255, 255], [1, 255, 255, 0]]";
export const PALETTE_VSI = "[[0, 0, 85, 0], [0.3, 255, 255, 0], [0.7, 255, 136, 0], [1, 255, 0, 0]]";
export const PALETTE_CMA = "[[0, 68, 34, 0], [0.3, 136, 68, 0], [0.7, 170, 136, 170], [1, 255, 255, 255]]";
export const PALETTE_APEX = "[[0, 0, 0, 0, 0.0], [0.45, 0, 0, 0, 0.0], [0.55, 0, 220, 255, 1.0], [0.75, 255, 0, 255, 1.0], [1, 140, 0, 255, 1.0]]"; // Trans until 0.45 → Cyan → Magenta → Purple
export const PALETTE_PHI = "[[0, 0, 0, 0], [0.3, 51, 51, 51], [0.7, 102, 51, 0], [1, 255, 204, 0]]";
export const PALETTE_HMI = "[[0, 0, 17, 0], [0.3, 0, 68, 0], [0.7, 0, 255, 187], [1, 255, 255, 255]]";
export const PALETTE_SCRI = "[[0, 0, 0, 0], [0.2, 75, 0, 130], [0.6, 231, 76, 60], [1, 241, 196, 15]]";
export const PALETTE_MSI_INV = "[[0, 212, 106, 36], [0.5, 239, 216, 122], [1, 28, 133, 166]]";
export const PALETTE_METHANE = "[[0.0, 13, 23, 27], [0.3, 245, 120, 20], [0.75, 255, 180, 0], [1.0, 255, 255, 200]]";
export const PALETTE_AWEI = "[[0, 48, 36, 18], [0.333, 193, 154, 72], [0.667, 35, 151, 181], [1, 8, 67, 128]]";
export const PALETTE_NDRE = "[[0, 105, 56, 32], [0.333, 205, 167, 72], [0.667, 92, 151, 71], [1, 16, 91, 52]]";
export const PALETTE_KSI = "[[0, 46, 35, 24], [0.4, 180, 150, 90], [0.75, 235, 225, 190], [1, 255, 255, 255]]"; // Dark soil -> Tan -> Pale crust -> White
export const PALETTE_VSSI = "[[0, 46, 125, 50], [0.4, 189, 183, 107], [0.7, 205, 133, 63], [1, 178, 34, 34]]"; // Forest green -> Khaki -> Peru -> Firebrick

export const INDICES = {
    tc: {
        name: 'True Color',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Stable',
        min: '0.0', max: '0.3',
        gradient: 'linear-gradient(to right, #000, #fff)',
        formula: 'RGB',
        info: 'Standard RGB bands (Red, Green, Blue) configured to provide human-readable, true-color imagery of the surface exactly as the eye would see it.',
        diffLabels: ['Decrease / Darker', 'Increase / Brighter'],
        evalscript: genEvalscript(['B04', 'B03', 'B02'], `
  let factor = 2.5;
  let r = sample.B04 * factor;
  let g = sample.B03 * factor;
  let b = sample.B02 * factor;
  let brightness = (r + g + b) / 3;
  if (typeof VISUAL_FILTER !== 'undefined' && brightness < VISUAL_FILTER) return [0,0,0,0];
  return [r, g, b, 1];
`),
        fisBands: ['B04', 'B03', 'B02'],
        fisLogic: `return [sample.B04, sample.B03, sample.B02];`
    },
    fc: {
        name: 'False Color (NIR)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Stable',
        min: '0.0', max: '0.3',
        gradient: 'linear-gradient(to right, #000, #fff)',
        formula: 'RGB (B08,B04,B03)',
        info: 'Utilizes Near-Infrared (NIR), Red, and Green bands. NIR reflects strongly off healthy vegetation while deeply absorbing water, making it ideal for highlighting plant health and defining sharp water boundaries.',
        diffLabels: ['Decrease / Darker', 'Increase / Brighter'],
        evalscript: genEvalscript(['B08', 'B04', 'B03'], `
  let factor = 2.5;
  let r = sample.B08 * factor;
  let g = sample.B04 * factor;
  let b = sample.B03 * factor;
  let brightness = (r + g + b) / 3;
  if (typeof VISUAL_FILTER !== 'undefined' && brightness < VISUAL_FILTER) return [0,0,0,0];
  return [r, g, b, 1];
`),
        fisBands: ['B08', 'B04', 'B03'],
        fisLogic: `return [sample.B08, sample.B04, sample.B03];`
    },
    swir_rgb: {
        name: 'SWIR Surface Context (B12/B11/B04)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Context',
        min: 'False Color RGB', max: '',
        gradient: 'linear-gradient(to right, #5d2338, #b79448, #f2e7cf)',
        formula: 'RGB = B12, B11, B04',
        formulaStatus: 'Implemented SWIR2/SWIR1/Red false-color context view',
        validationStatus: 'Context visualization only; colors are not material or contamination classes.',
        info: 'SWIR2, SWIR1, and Red are assigned to RGB to expose broad differences among wet surfaces, vegetation, bare ground, pads, and substrate. This is an interpretation aid, not a brine or produced-water classifier.',
        diffLabels: ['Darker Surface Response', 'Brighter Surface Response'],
        evalscript: genEvalscript(['B12', 'B11', 'B04'], `
  let factor = 2.5;
  let r = sample.B12 * factor;
  let g = sample.B11 * factor;
  let b = sample.B04 * factor;
  let brightness = (r + g + b) / 3;
  if (typeof VISUAL_FILTER !== 'undefined' && brightness < VISUAL_FILTER) return [0,0,0,0];
  return [r, g, b, 1];
`),
        fisBands: ['B12', 'B11', 'B04'],
        fisLogic: `return [Math.max(sample.B12, sample.B11, sample.B04)];`
    },
    awei: {
        name: 'Automated Water Extraction Index — Shadow Variant (AWEIsh)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'Non-Water', max: 'Water Response',
        gradient: 'linear-gradient(to right, #302412, #c19a48, #2397b5, #084380)',
        formula: 'AWEIsh = B02 + 2.5·B03 − 1.5·(B08+B11) − 0.25·B12; display=max(0,5·AWEIsh)',
        formulaStatus: 'Implemented established AWEI shadow-aware surface-water contrast',
        validationStatus: 'Established water-extraction form; not a salinity, brine, or produced-water measurement.',
        info: 'AWEIsh is an independent open-water cross-check for MNDWI that suppresses many shadow and bright-surface confounders. Positive response supports water-like surface context only.',
        diffLabels: ['Water Recedes', 'Water Expands'],
        evalscript: genEvalscript(['B02', 'B03', 'B08', 'B11', 'B12'], `
  let awei = sample.B02 + 2.5 * sample.B03 - 1.5 * (sample.B08 + sample.B11) - 0.25 * sample.B12;
  let mapped = Math.max(0, Math.min(1, awei * 5));
  ${colorBlend('mapped', PALETTE_AWEI)}
`),
        fisBands: ['B02', 'B03', 'B08', 'B11', 'B12'],
        fisLogic: `return [sample.B02 + 2.5 * sample.B03 - 1.5 * (sample.B08 + sample.B11) - 0.25 * sample.B12];`
    },
    ndre: {
        name: 'Normalized Difference Red-Edge Index (NDRE)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Lower Red-Edge Response', max: 'Higher Red-Edge Response',
        gradient: 'linear-gradient(to right, #693820, #cda748, #5c9747, #105b34)',
        formula: '(B8A - B05) / (B8A + B05)',
        formulaStatus: 'Implemented established red-edge vegetation response',
        validationStatus: 'Vegetation-context indicator only; stress cannot be attributed to produced water without controls.',
        info: 'NDRE uses narrow NIR and the first red-edge band to complement NDVI/SAVI when examining vegetation response. Phenology, drought, disease, management, grazing, and fire remain confounders.',
        diffLabels: ['Lower Red-Edge Vitality', 'Higher Red-Edge Vitality'],
        evalscript: genEvalscript(['B8A', 'B05'], `
  let sum = sample.B8A + sample.B05;
  if (sum === 0) return [0,0,0,0];
  let val = (sample.B8A - sample.B05) / sum;
  ${colorBlend('val + 0.1', PALETTE_NDRE)}
`),
        fisBands: ['B8A', 'B05'],
        fisLogic: `
  let sum = sample.B8A + sample.B05;
  if (sum === 0) return [0];
  return [(sample.B8A - sample.B05) / sum];
`
    },
    ndmi: {
        name: 'Moisture Index (NDMI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'High Stress', max: 'High Moisture',
        gradient: 'linear-gradient(to right, #D46A24, #EFD87A, #1C85A6)',
        formula: '(B8A - B11) / (B8A + B11)',
        info: 'Normalized Difference Moisture Index uses NIR (B8A) and Short-wave Infrared (SWIR, B11). SWIR is highly sensitive to water content in leaves and soil. The normalized difference between NIR and SWIR closely tracks canopy water stress and topsoil moisture.',
        diffLabels: ['Drier / Moisture Loss', 'Wetter / Moisture Gain'],
        evalscript: genEvalscript(['B8A', 'B11'], `
  let sum = sample.B8A + sample.B11;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B8A - sample.B11) / sum;
  ${colorBlend('val + 0.3', PALETTE_NDMI)}
`),
        fisBands: ['B8A', 'B11'],
        fisLogic: `
  let sum = sample.B8A + sample.B11;
  if(sum === 0) return [0];
  return [(sample.B8A - sample.B11) / sum];
`
    },
    pwoi: {
        name: "ASAI — Arid Salinity Anomaly Index (formerly PWOI / APEX)",
        tags: ['salinity', 'produced-water'],
        sensor: "Sentinel-2 L2A",
        min: 0,
        max: 1,
        gradient: 'linear-gradient(to right, #000000, #00DCFF, #FF00FF, #8C00FF)',
        formula: "max(W,D); W=0.42R+0.58S when R>0.58 and S>0; D=clamp(0.55+0.45(NDSI−0.15)/0.16) when NDWI<−0.42, NDSI>0.15, BSI>0.52; display≥0.60",
        formulaStatus: "Implemented dual-path Sentinel-2 screening proxy",
        validationStatus: "Not validated as a detector: pipeline recall 77.8% with 71.3% background activation; shipped viewer was blank at 11/11 reviewed positives and 150/150 background controls.",
        info: "Experimental arid salinity/surface-context proxy. The wet path combines a Sentinel-2 NDWI-derived smoothness proxy with a dual-SWIR salinity gate; the dry path displays only very dry, bright, high-NDSI bare surfaces. July 2026 controls found no threshold that separated produced-water sites from Permian caliche, so ASAI is suitable for visual screening and method comparison only—not produced-water identification.",
        diffLabels: ["Lower Proxy Response", "Higher Salinity/Surface Response"],
        // WMS-compatible S2-only evalscript (optical proxy for radar smoothness)
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], `
  // WET PATH — optical proxy for SAR surface smoothness
  // smooth/wet surfaces → high oVal, mirrors low SAR VH backscatter
  let sum = sample.B03 + sample.B11;
  let oVal = sum === 0 ? 0 : (sample.B03 - sample.B11) / sum;
  let radarProxy = Math.max(0, Math.min(1.0, (oVal + 0.3) / 0.6));
  let ndsiDen = sample.B11 + sample.B12;
  let ndsiVal = ndsiDen === 0 ? 0 : (sample.B11 - sample.B12) / ndsiDen;
  let salinityGate = Math.max(0, Math.min(1, (ndsiVal - 0.035) / 0.16));
  let wetScore = 0;
  if (radarProxy > 0.58 && salinityGate > 0) {
      wetScore = Math.min(1, (radarProxy * 0.42) + (salinityGate * 0.58));
  }

  // DRY BRINE PATH — evaporated salt crusts: dry bare soil + elevated NDSI
  let bsiDen = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let bsiDry = bsiDen === 0 ? 0 : ((sample.B11 + sample.B04) - (sample.B08 + sample.B02)) / bsiDen;
  let dryScore = 0;
  if (oVal < -0.42 && ndsiVal > 0.15 && bsiDry > 0.52) {
      dryScore = Math.max(0, Math.min(1, (ndsiVal - 0.15) / 0.16 * 0.45 + 0.55));
  }

  let finalVal = Math.min(Math.max(Math.max(wetScore, 0), dryScore), 1);
  if (finalVal < 0.60) return [0,0,0,0];
  ${colorBlend('finalVal', PALETTE_APEX)}
`),
        // Note: No deepEvalscript for PWOI — WMS cannot handle multi-datasource S1+S2 format.
        // Deep Fusion toggle has no effect on PWOI; optical proxy evalscript is always used.
        fisBands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let sum = sample.B03 + sample.B11;
  let oVal = sum === 0 ? 0 : (sample.B03 - sample.B11) / sum;
  let radarProxy = Math.max(0, Math.min(1.0, (oVal + 0.3) / 0.6));
  let ndsiDen = sample.B11 + sample.B12;
  let ndsiVal = ndsiDen === 0 ? 0 : (sample.B11 - sample.B12) / ndsiDen;
  let salinityGate = Math.max(0, Math.min(1, (ndsiVal - 0.035) / 0.16));
  let wetScore = (radarProxy > 0.58 && salinityGate > 0)
      ? Math.min(1, (radarProxy * 0.42) + (salinityGate * 0.58))
      : 0;
  let bsiDen = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let bsiDry = bsiDen === 0 ? 0 : ((sample.B11 + sample.B04) - (sample.B08 + sample.B02)) / bsiDen;
  let dryScore = (oVal < -0.42 && ndsiVal > 0.15 && bsiDry > 0.52)
      ? Math.max(0, Math.min(1, (ndsiVal - 0.15) / 0.16 * 0.45 + 0.55))
      : 0;
  let finalVal = Math.min(Math.max(Math.max(wetScore, 0), dryScore), 1);
  return [finalVal < 0.60 ? 0 : finalVal];
`
    },
    ndwi: {
        name: 'Modified Water Index (MNDWI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'Dry Surface', max: 'Saturated',
        gradient: 'linear-gradient(to right, #824614, #D7AA3C, #1450B4)',
        formula: '(B03 - B11) / (B03 + B11)',
        info: 'Modified Normalized Difference Water Index (Xu, 2006 form) uses Green (B03) and SWIR1 (B11). It is an established open-water and wet-surface contrast, not a chemical or salinity measurement. The internal key remains ndwi for backward compatibility.',
        diffLabels: ['Dries / Recedes', 'Wetter / Expands'],
        evalscript: genEvalscript(['B03', 'B11'], `
  let sum = sample.B03 + sample.B11;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B03 - sample.B11) / sum;
  ${colorBlend('val + 0.3', PALETTE_NDWI)}
`),
        fisBands: ['B03', 'B11'],
        fisLogic: `
  let sum = sample.B03 + sample.B11;
  if(sum === 0) return [0];
  return [(sample.B03 - sample.B11) / sum];
`
    },
    ndvi: {
        name: 'Vegetation Index (NDVI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Barren', max: 'Lush Vegetation',
        gradient: 'linear-gradient(to right, #A07832, #D2B43C, #146428)',
        formula: '(B08 - B04) / (B08 + B04)',
        info: 'Normalized Difference Vegetation Index uses NIR (B08) and Red (B04). Chlorophyll absorbs Red light for photosynthesis, while leaf cell structures powerfully reflect NIR. This ratio is the standard proxy for surveying live, green vegetation density.',
        diffLabels: ['Unhealthier / Loss', 'Healthier / Gain'],
        evalscript: genEvalscript(['B08', 'B04'], `
  let sum = sample.B08 + sample.B04;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B08 - sample.B04) / sum;
  ${colorBlend('val + 0.1', PALETTE_VEG)}
`),
        fisBands: ['B08', 'B04'],
        fisLogic: `
  let sum = sample.B08 + sample.B04;
  if(sum === 0) return [0];
  return [(sample.B08 - sample.B04) / sum];
`
    },
    savi: {
        name: 'Arid Vegetation (SAVI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Barren Soil', max: 'Dense Brush',
        gradient: 'linear-gradient(to right, #A07832, #D2B43C, #146428)',
        formula: '((B08 - B04) / (B08 + B04 + 0.5)) * 1.5',
        info: 'Soil Adjusted Vegetation Index is similar to NDVI but introduces a soil-brightness correction factor (L=0.5) to minimize the influence of background soil reflectance in arid, desert, or sparsely vegetated regions.',
        diffLabels: ['Unhealthier / Loss', 'Healthier / Gain'],
        evalscript: genEvalscript(['B08', 'B04'], `
  let sum = sample.B08 + sample.B04 + 0.5;
  if(sum === 0) return [0,0,0,0];
  let val = ((sample.B08 - sample.B04) / sum) * 1.5;
  ${colorBlend('val + 0.2', PALETTE_VEG)}
`),
        fisBands: ['B08', 'B04'],
        fisLogic: `
  let sum = sample.B08 + sample.B04 + 0.5;
  if(sum === 0) return [0];
  return [((sample.B08 - sample.B04) / sum) * 1.5];
`
    },
    msi: {
        name: 'Moisture Stress Index (MSI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'High Content', max: 'Severe Stress',
        gradient: 'linear-gradient(to right, #1C85A6, #EFD87A, #D46A24)',
        formula: 'B11 / B08',
        info: 'Moisture Stress Index is a simple band ratio of SWIR (B11) to NIR (B08). Higher values indicate lower moisture availability, inversely tracking drought stress and dry soil conditions impacting plant canopies.',
        diffLabels: ['More Stressed / Drier', 'Less Stressed / Wetter'],
        evalscript: genEvalscript(['B11', 'B08'], `
  if(sample.B08 === 0) return [0,0,0,0];
  let val = sample.B11 / sample.B08;
  // MSI typically ranges from 0.4 (low stress) to 2.0+ (high stress). 
  // We can map this to 0-1 for our colorBlend function.
  let mapped = Math.max(0, Math.min(1, (val - 0.4) / 1.6));
  ${colorBlend('mapped', PALETTE_MSI)}
`),
        fisBands: ['B11', 'B08'],
        fisLogic: `
  if(sample.B08 === 0) return [0];
  return [sample.B11 / sample.B08];
`
    },
    si: {
        name: 'SWIR1–NIR Surface Contrast (SI legacy)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: '0-12M',
        min: 'NIR-Dominant', max: 'SWIR1-Dominant',
        gradient: 'linear-gradient(to right, #243340, #EFD87A, #F0501E)',
        formula: '(B11 - B08) / (B11 + B08)',
        formulaStatus: 'Implemented normalized SWIR1–NIR surface contrast',
        validationStatus: 'Established band-ratio form; not calibrated here to salt concentration or produced water.',
        info: 'Normalized SWIR1–NIR contrast. It responds to broad differences in surface moisture, vegetation, substrate, disturbance, and brightness. It may support salinity investigations after local field calibration, but it does not measure salt concentration by itself.',
        diffLabels: ['Lower SWIR1–NIR Contrast', 'Higher SWIR1–NIR Contrast'],
        evalscript: genEvalscript(['B11', 'B08'], `
  let sum = sample.B11 + sample.B08;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B11 - sample.B08) / sum;
  // Legacy SI display: clamp and scale the positive SWIR1-NIR response.
  // This broad-band contrast is not a salt-concentration retrieval.
  ${colorBlend('Math.max(0, val * 2)', PALETTE_SI)}
`),
        fisBands: ['B11', 'B08'],
        fisLogic: `
  let sum = sample.B11 + sample.B08;
  if(sum === 0) return [0];
  return [(sample.B11 - sample.B08) / sum];
`
    },
    ksi: {
        name: 'Khan Salinity Index (KSI)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Low Reflectance / Vegetated', max: 'Bright / Salt-Crust-Like',
        gradient: 'linear-gradient(to right, #2e2318, #b4965a, #ebe1be, #ffffff)',
        formula: 'sqrt(B03 × B04)',
        formulaStatus: 'Implemented established Khan (2001) visible-band salinity index',
        validationStatus: 'Established literature form (Khan et al., 2001); Limn has not calibrated it to chloride, EC, or produced-water specificity.',
        info: 'Classic soil-salinity index using only the visible Green and Red bands — independent of the SWIR ratios used elsewhere in this suite, so it fails differently. Bright, low-vegetation salt crusts raise the score, but bare caliche, dry playa, and other bright soils can also raise it. It is not a chloride or EC measurement.',
        diffLabels: ['Higher Salinity-Index Response', 'Lower Salinity-Index Response'],
        evalscript: genEvalscript(['B03', 'B04'], `
  let ksi = Math.sqrt(Math.max(0, sample.B03) * Math.max(0, sample.B04));
  let mapped = Math.max(0, (ksi - 0.05) * 4.0);
  ${colorBlend('mapped', PALETTE_KSI)}
`),
        fisBands: ['B03', 'B04'],
        fisLogic: `
  let ksi = Math.sqrt(Math.max(0, sample.B03) * Math.max(0, sample.B04));
  return [Math.max(0, (ksi - 0.05) * 4.0)];
`
    },
    bsi: {
        name: 'Bare Soil Index (BSI)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Veg / Water', max: 'Bare Soil / Disturbance',
        gradient: 'linear-gradient(to right, #000000, #448833, #D2B43C, #A07832)',
        formula: '((B11+B04)-(B08+B02)) / ((B11+B04)+(B08+B02))',
        info: 'The Bare Soil Index (BSI) combines SWIR, Red, NIR, and Blue bands to distinguish bare ground from vegetation and water. High values indicate exposed soil, pad surfaces, or mechanical disturbances, providing a critical geographic baseline for PWI/FBC anomalies.',
        diffLabels: ['Revegetation', 'Soil Disturbance'],
        evalscript: genEvalscript(['B02', 'B04', 'B08', 'B11'], `
  let top = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  if(bot === 0) return [0,0,0,0];
  let val = top / bot;
  // BSI maps -1 to +1. Land is typically 0.05-0.2.
  ${colorBlend('val', PALETTE_BSI)}
`),
        fisBands: ['B02', 'B04', 'B08', 'B11'],
        fisLogic: `
  let top = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  if(bot === 0) return [0];
  return [top / bot];
`
    },
    ndsi: {
        name: 'Dual-SWIR Contrast (NDTI/NBR2 form; NDSI legacy)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Lower SWIR1/SWIR2 Contrast', max: 'Higher SWIR1/SWIR2 Contrast',
        gradient: 'linear-gradient(to right, #000000, #00FFFF, #FF00FF, #CCFF00)',
        formula: '(B11 - B12) / (B11 + B12)',
        formulaStatus: 'Implemented NDTI/NBR2-form dual-SWIR contrast',
        validationStatus: 'Established band-ratio form; not brine-specific and not calibrated here to salinity.',
        info: 'Normalized SWIR1–SWIR2 contrast. The same algebra is widely used as NDTI/NBR2 for tillage, residue, burn, moisture, and other surface-condition studies. In Limn it is retained as a salinity-hypothesis component, but it is not brine-specific and does not retrieve salt concentration.',
        diffLabels: ['Lower Dual-SWIR Contrast', 'Higher Dual-SWIR Contrast'],
        evalscript: genEvalscript(['B11', 'B12'], `
  let sum = sample.B11 + sample.B12;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B11 - sample.B12) / sum;
  ${colorBlend('Math.max(0, val * 2)', PALETTE_BRINE)}
`),
        fisBands: ['B11', 'B12'],
        fisLogic: `
  let sum = sample.B11 + sample.B12;
  if(sum === 0) return [0];
  return [(sample.B11 - sample.B12) / sum];
`
    },
    csi: {
        name: 'SWIR1/SWIR2 Surface Ratio (CSI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Lower Ratio', max: 'Higher Ratio',
        gradient: 'linear-gradient(to right, #A07832, #64DC50, #00FFFF)',
        formula: 'B11 / B12',
        formulaStatus: 'Implemented SWIR1/SWIR2 surface ratio',
        validationStatus: 'Contextual surface ratio; no contamination classification validation.',
        info: 'Broad SWIR1/SWIR2 surface ratio sensitive to mineralogy, crop residue, moisture, disturbance, and substrate. It can provide clay/surface context, but it does not establish contamination without field or laboratory evidence.',
        diffLabels: ['Lower SWIR Ratio', 'Higher SWIR Ratio'],
        evalscript: genEvalscript(['B11', 'B12'], `
  if(sample.B12 === 0) return [0,0,0,0];
  let val = sample.B11 / sample.B12;
  let mapped = Math.max(0, Math.min(1, (val - 0.5) / 2.0));
  ${colorBlend('mapped', PALETTE_CSI)}
`),
        fisBands: ['B11', 'B12'],
        fisLogic: `
  if(sample.B12 === 0) return [0];
  return [sample.B11 / sample.B12];
`
    },
    hcai: {
        name: 'SWIR1–Red Contrast (HCAI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '0-6M',
        min: 'Lower Contrast', max: 'Higher Contrast',
        gradient: 'linear-gradient(to right, #F5DEB3, #8B4513, #000000)',
        formula: '(B11 - B04) / (B11 + B04)',
        formulaStatus: 'Implemented normalized SWIR1–Red contrast',
        validationStatus: 'Surface-response proxy; not a hydrocarbon absorption retrieval.',
        info: 'Normalized SWIR1–Red surface contrast. Broad Sentinel-2 bands do not resolve the diagnostic narrow absorption feature used by hyperspectral Hydrocarbon Index methods. Treat this as a surface-response proxy, not a petroleum measurement.',
        diffLabels: ['Lower SWIR1–Red Contrast', 'Higher SWIR1–Red Contrast'],
        evalscript: genEvalscript(['B11', 'B04'], `
  let sum = sample.B11 + sample.B04;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B11 - sample.B04) / sum;
  let mapped = Math.max(0, (val - 0.30) * 3);
  ${colorBlend('mapped', PALETTE_HCAI)}
`),
        fisBands: ['B11', 'B04'],
        fisLogic: `
  let sum = sample.B11 + sample.B04;
  if(sum === 0) return [0];
  return [Math.max(0, ((sample.B11 - sample.B04) / sum) - 0.30)];
`
    },
    hmri: {
        name: 'SWIR2/Green Contrast (HMRI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '12M+',
        min: 'Lower Ratio', max: 'Higher Ratio',
        gradient: 'linear-gradient(to right, #E6E6FA, #800080, #FF00FF)',
        formula: 'B12 / B03',
        formulaStatus: 'Implemented SWIR2/Green surface ratio',
        validationStatus: 'Surface-response proxy; not calibrated to heavy-metal concentration.',
        info: 'Broad SWIR2/Green contrast. Heavy-metal estimation in remote-sensing studies requires field concentrations and calibrated multivariate models; this single ratio cannot identify barium, strontium, radium, or total metal concentration.',
        diffLabels: ['Lower SWIR2/Green Ratio', 'Higher SWIR2/Green Ratio'],
        evalscript: genEvalscript(['B12', 'B03'], `
  if(sample.B03 === 0) return [0,0,0,0];
  let val = sample.B12 / sample.B03;
  let mapped = Math.max(0, Math.min(1, (val - 2.0) / 3.0));
  ${colorBlend('mapped', PALETTE_HMRI)}
`),
        fisBands: ['B12', 'B03'],
        fisLogic: `
  if(sample.B03 === 0) return [0];
  return [Math.max(0, sample.B12 / sample.B03 - 2.0)];
`
    },
    ndoi: {
        name: 'Blue–SWIR2 Contrast (NDOI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '0-3M',
        min: 'SWIR2-Dominant', max: 'Blue-Dominant',
        gradient: 'linear-gradient(to right, #2c3e50, #7f8c8d, #f1c40f, #e74c3c)',
        formula: '(B02 - B12) / (B02 + B12)',
        formulaStatus: 'Implemented normalized Blue–SWIR2 contrast',
        validationStatus: 'Surface-response proxy; not validated as an oil classifier.',
        info: 'Normalized Blue–SWIR2 surface contrast. It can highlight water, bright surfaces, shadows, aerosols, or material differences, but a positive response is not uniquely attributable to oil.',
        diffLabels: ['Lower Blue–SWIR2 Contrast', 'Higher Blue–SWIR2 Contrast'],
        evalscript: genEvalscript(['B02', 'B12'], `
  let sum = sample.B02 + sample.B12;
  if(sum === 0) return [0,0,0,0];
  let val = (sample.B02 - sample.B12) / sum;
  
  // Legacy NDOI display: clamp and scale the positive Blue-SWIR2 response.
  // A positive response is not specific to oil.
  let mapped = Math.max(0, val * 2);
  ${colorBlend('mapped', `[
      [0.0, 43, 62, 80],
      [0.3, 127, 140, 141],
      [0.7, 241, 196, 15],
      [1.0, 231, 76, 60]
  ]`)}
`),
        fisBands: ['B02', 'B12'],
        fisLogic: `
  let sum = sample.B02 + sample.B12;
  if(sum === 0) return [0];
  return [(sample.B02 - sample.B12) / sum];
`
    },
    crsi: {
        name: 'Inverted Canopy Response Index (1 − CRSI)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: '6-24M',
        min: 'Higher CRSI', max: 'Lower CRSI / Stress Response',
        gradient: 'linear-gradient(to right, #27ae60, #f1c40f, #e67e22, #c0392b)',
        formula: '1 − clamp(sqrt((B08·B04 − B03·B02)/(B08·B04 + B03·B02)),0,1)',
        formulaStatus: 'Implemented inverted CRSI display',
        validationStatus: 'Established CRSI form; Limn has not calibrated the inverse to chloride or produced-water stress.',
        info: 'The underlying Canopy Response Salinity Index is established for calibrated salinity-stress studies. Limn displays its inverse so larger values indicate lower CRSI response. Water, vegetation condition, soil background, and other stressors can also change the value; it is not a chloride measurement.',
        diffLabels: ['Higher CRSI / Recovery', 'Lower CRSI / Stress Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08'], `
  let top = (sample.B08 * sample.B04) - (sample.B03 * sample.B02);
  let bot = (sample.B08 * sample.B04) + (sample.B03 * sample.B02);
  if(bot === 0 || top < 0) return [0,0,0,0];
  
  let crsi = Math.sqrt(top / bot);
  
  // CRSI drops as salinity increases and vegetation dies.
  // We invert it so Red/High = Bad (Salt Shock).
  let mapped = 1.0 - Math.min(1, Math.max(0, crsi)); 
  ${colorBlend('mapped', `[
      [0.0, 39, 174, 96],
      [0.4, 241, 196, 15],
      [0.7, 230, 126, 34],
      [1.0, 192, 57, 43]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B04', 'B08'],
        fisLogic: `
  let top = (sample.B08 * sample.B04) - (sample.B03 * sample.B02);
  let bot = (sample.B08 * sample.B04) + (sample.B03 * sample.B02);
  if(bot === 0 || top < 0) return [0];
  let crsi = Math.sqrt(top / bot);
  return [1.0 - Math.min(1, Math.max(0, crsi))];
`
    },
    vssi: {
        name: 'Vegetation Soil Salinity Index (VSSI)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: '3-12M',
        min: 'Healthy Vegetation', max: 'Bare / Salt-Affected',
        gradient: 'linear-gradient(to right, #2e7d32, #bdb76b, #cd853f, #b22222)',
        formula: '2·B03 − 5·(B04+B08)',
        formulaStatus: 'Implemented established Bannari (2008) vegetation soil-salinity index',
        validationStatus: 'Established literature form (Bannari et al., 2008), developed for irrigated agricultural salinity mapping; Limn has not calibrated it to Permian rangeland/caliche conditions or produced-water specificity.',
        info: 'Combines Green reflectance with a heavily-weighted Red+NIR penalty so healthy, high-NIR vegetation scores low and bare or salt-stressed ground (low NIR) scores high. Complements CRSI: CRSI reads canopy chloride stress, VSSI reads the surface directly. Drought, grazing, and disturbed bare ground are confounders, not source attribution.',
        diffLabels: ['Increasing Bare / Salt-Affected Response', 'Recovery / Revegetation'],
        evalscript: genEvalscript(['B03', 'B04', 'B08'], `
  let vssi = 2 * sample.B03 - 5 * (sample.B04 + sample.B08);
  let mapped = Math.max(0, Math.min(1, (vssi + 2.2) / 1.8));
  ${colorBlend('mapped', PALETTE_VSSI)}
`),
        fisBands: ['B03', 'B04', 'B08'],
        fisLogic: `
  let vssi = 2 * sample.B03 - 5 * (sample.B04 + sample.B08);
  return [Math.max(0, Math.min(1, (vssi + 2.2) / 1.8))];
`
    },
    aoi: {
        name: 'Red/Blue × SWIR Surface Contrast (AOI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '0-6M',
        min: 'Lower Product', max: 'Higher Product',
        gradient: 'linear-gradient(to right, #2c3e50, #8e44ad, #c0392b)',
        formula: '(B04 / B02) * (B11 / B12)',
        formulaStatus: 'Implemented Red/Blue × SWIR1/SWIR2 surface product',
        validationStatus: 'Research-only surface proxy; no oxidation-state or produced-water validation.',
        info: 'Product of Red/Blue and SWIR1/SWIR2 surface ratios. It may highlight iron-rich or mineralogically altered surfaces, but it does not establish anoxia, ferrous/ferric state, hydrocarbons, or produced-water causation without independent evidence.',
        diffLabels: ['Lower Surface Product', 'Higher Surface Product'],
        evalscript: genEvalscript(['B02', 'B04', 'B11', 'B12'], `
  if(sample.B02 === 0 || sample.B12 === 0) return [0,0,0,0];
  let ironOxide = sample.B04 / sample.B02;
  let hydrocarbon = sample.B11 / sample.B12;
  
  let aoi = ironOxide * hydrocarbon;
  
  // AOI background is typically ~1.5 to 2.0. Severe oxidation pushes it to 3.5+
  let mapped = Math.max(0, Math.min(1, (aoi - 2.0) / 2.0));
  
  ${colorBlend('mapped', `[
      [0.0, 44, 62, 80],    // Dark Slate
      [0.4, 142, 68, 173],  // Purple
      [0.8, 192, 57, 43],   // Deep Red
      [1.0, 255, 0, 0]      // Bright Red
  ]`)}
`),
        fisBands: ['B02', 'B04', 'B11', 'B12'],
        fisLogic: `
  if(sample.B02 === 0 || sample.B12 === 0) return [0];
  let aoi = (sample.B04 / sample.B02) * (sample.B11 / sample.B12);
  return [Math.max(0, (aoi - 2.0) / 2.0)];
`
    },
    ehc: {
        name: 'EHC — Three-Channel Surface Context Composite',
        sensor: 'Sentinel-2 L2A',
        temporal: '0-3M',
        min: 'False Color RGB', max: '',
        gradient: 'linear-gradient(to right, #ff0000, #00ff00, #0000ff)',
        formula: 'R=max(0,3·Blue–SWIR2 contrast); G=max(0,2·BSI); B=max(0,4·dual-SWIR contrast); statistics=clamp(max(R,G,B),0,1)',
        formulaStatus: 'Implemented RGB context composite; scalar statistics use maximum channel intensity',
        validationStatus: 'Not validated as a morphology classifier or produced-water detector.',
        info: 'Experimental false-color context view. Red represents Blue–SWIR2 contrast, green represents BSI, and blue represents dual-SWIR contrast. The colors can help inspect spatial pattern, but they do not identify an oil center, mud footprint, salt ring, or blowout morphology without independent event evidence.',
        diffLabels: ['N/A', 'N/A'],
        evalscript: `//VERSION=3
            function setup() {
                return {
                    input: ["B02","B04","B08","B11","B12", "dataMask"],
                    output: { bands: 4 }
                };
            }
            function evaluatePixel(sample) {
                if(sample.dataMask === 0) return [0,0,0,0];
                
                // Red channel = Blue–SWIR2 surface contrast
                let sumNdoi = sample.B02 + sample.B12;
                let ndoi = sumNdoi === 0 ? 0 : (sample.B02 - sample.B12) / sumNdoi;
                let red = Math.max(0, ndoi * 3);

                // Green channel = BSI surface context
                let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
                let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
                let bsi = bsiBot === 0 ? 0 : bsiTop / bsiBot;
                let green = Math.max(0, bsi * 2);

                // Blue channel = dual-SWIR surface contrast
                let ndsiSum = sample.B11 + sample.B12;
                let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
                let blue = Math.max(0, ndsi * 4);
                
                let intensity = Math.max(red, green, blue);
                if (typeof VISUAL_FILTER !== 'undefined' && intensity < VISUAL_FILTER) return [0,0,0,0];

                return [red, green, blue, 1];
            }`,
        fisBands: ['B02', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let sumNdoi = sample.B02 + sample.B12;
  let red = sumNdoi === 0 ? 0 : Math.max(0, ((sample.B02 - sample.B12) / sumNdoi) * 3);
  let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let green = bsiBot === 0 ? 0 : Math.max(0, (bsiTop / bsiBot) * 2);
  let ndsiSum = sample.B11 + sample.B12;
  let blue = ndsiSum === 0 ? 0 : Math.max(0, ((sample.B11 - sample.B12) / ndsiSum) * 4);
  return [Math.min(1, Math.max(red, green, blue))];
`
    },
    hpwi: {
        name: 'OBEC — Optical Brightness/Edge Contrast (legacy Oil-Brine Emulsion Composite)',
        primaryScreener: true,
        fieldRole: 'Primary screener for pad-scale optical contrast and flowline releases. Combines hydrocarbon NDOI with dual-SWIR salinity and surface smoothness.',
        tags: ['salinity', 'produced-water'],
        sensor: 'Sentinel-2 L2A',
        temporal: '0-3M',
        min: 'Background', max: 'Optical Contrast Response',
        gradient: 'linear-gradient(to right, #000000, #00FFFF, #FF00FF, #CCFF00)',
        formula: 'clamp(6 × clamp(NDOI + 0.8·max(0,NDSI−τ),0,1) × clamp((NDWI+0.3)/0.6,0,1),0,1); display≥0.08',
        formulaStatus: 'Implemented single-scene Sentinel-2 optical-contrast proxy',
        validationStatus: 'Not validated as a detector: pipeline recall 66.7% with 71.3% background activation; shipped viewer was blank at 11/11 reviewed positives and 150/150 background controls.',
        info: 'Experimental optical-contrast proxy combining nonnegative Blue/SWIR2 contrast, a dual-SWIR salinity boost, and an NDWI-derived surface term. Despite its historical name, the bands do not retrieve oil or prove an emulsion. July 2026 controls found no useful produced-water discrimination, so use OBEC for contextual screening and formula comparison only.',
        diffLabels: ['Lower Proxy Response', 'Higher Optical Contrast Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B11', 'B12'], `
  if (sample.dataMask === 0) return [0,0,0,0];

  // 1. Hydrocarbon gate (primary): NDOI
  let sumNdoi = sample.B02 + sample.B12;
  if (sumNdoi === 0) return [0,0,0,0];
  let ndoi = Math.max(0, (sample.B02 - sample.B12) / sumNdoi);

  // 2. Brine boost (additive): NDSI > 0.06 only (hardened for v31)
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.04, 0.06 - (DETECTION_SENSITIVITY * 0.03));
  let brineBoost = Math.max(0, ndsi - brineThreshold) * 0.8;
  
  // Combined chemical signal
  let chemSignal = Math.min(1, ndoi + brineBoost);

  // 3. Surface Smoothness Proxy (S2 stand-in for SAR VH dampening)
  let sumSmooth = sample.B03 + sample.B11;
  let smoothness = sumSmooth === 0 ? 0 : (sample.B03 - sample.B11) / sumSmooth;
  let normSmooth = Math.max(0, Math.min(1, (smoothness + 0.3) / 0.6));

  // 4. Composite
  let score = chemSignal * normSmooth;
  let mapped = Math.max(0, Math.min(1, score * 6.0));
  if (mapped < 0.08) return [0,0,0,0];

  ${colorBlend('mapped', `[
      [0.0, 17, 17, 17, 0.0],
      [0.3, 75, 0, 130],
      [0.7, 231, 76, 60],
      [1.0, 241, 196, 15]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B11', 'B12'],
        fisLogic: `
  let sumNdoi = sample.B02 + sample.B12;
  if (sumNdoi === 0) return [0];
  let ndoi = Math.max(0, (sample.B02 - sample.B12) / sumNdoi);
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.04, 0.06 - (DETECTION_SENSITIVITY * 0.03));
  let brineBoost = Math.max(0, ndsi - brineThreshold) * 0.8;
  let chemSignal = Math.min(1, ndoi + brineBoost);
  let sumSmooth = sample.B03 + sample.B11;
  let smooth = sumSmooth === 0 ? 0 : Math.max(0, Math.min(1, ((sample.B03 - sample.B11)/sumSmooth + 0.3) / 0.6));
  let mapped = Math.min(1, chemSignal * smooth * 6.0);
  return [mapped < 0.08 ? 0 : mapped];
`
    },
    fbc: {
        name: 'Red/Blue–Dual-SWIR–Low-Vegetation Composite (FBC legacy)',
        tags: ['salinity', 'produced-water'],
        sensor: 'Sentinel-2 L2A',
        temporal: '3-12M',
        min: 'Background', max: 'Iron+Brine Alteration',
        gradient: 'linear-gradient(to right, #1a0800, #8B2500, #D4581A, #FFB347)',
        formula: 'clamp(150·(ironScore·dualSWIRScore·noVeg)^1.4,0,1)',
        formulaStatus: 'Implemented red/blue × dual-SWIR × low-vegetation display composite',
        validationStatus: 'Research-only surface-response proxy; no produced-water discrimination or iron-chemistry validation.',
        info: 'Experimental co-occurrence composite using Red/Blue contrast, dual-SWIR contrast, and a low-vegetation gate. Iron-rich soils, substrate, moisture, residue, and disturbance can produce the same response; it does not retrieve iron oxidation state or brine chemistry.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], `
  if (sample.dataMask === 0 || sample.B02 === 0) return [0,0,0,0];

  // 1. Iron Oxide Gate: B04/B02 (Red/Blue)
  // Baseline bare soil: ~1.2–1.6. Iron alteration (Fe²⁺→Fe³⁺) pushes above 1.6.
  let ironOxide = sample.B04 / sample.B02;
  let ironThreshold = Math.max(1.3, 1.4 - (DETECTION_SENSITIVITY * 0.3));
  let ironScore = Math.max(0, (ironOxide - ironThreshold) / 1.0);

  // 2. Brine Gate: NDSI = (B11-B12)/(B11+B12)
  let ndsiSum = sample.B11 + sample.B12;
  if (ndsiSum === 0) return [0,0,0,0];
  let ndsi = (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.02, 0.04 - (DETECTION_SENSITIVITY * 0.08));
  let brineScore = Math.max(0, ndsi - brineThreshold);

  // 3. No-Vegetation Gate
  let ndviSum = sample.B08 + sample.B04;
  let ndvi = ndviSum === 0 ? 0 : (sample.B08 - sample.B04) / ndviSum;
  let noVeg = Math.max(0, 1.0 - Math.max(0, ndvi));

  // Composite: Product based with power scaling to suppress background "blobs"
  let fbc = (ironScore * brineScore) * noVeg;
  let mapped = Math.min(1, Math.pow(fbc, 1.4) * 150.0);

  ${colorBlend('mapped', `[
      [0.0,  26, 8, 0],
      [0.3, 139, 37, 0],
      [0.6, 212, 88, 26],
      [1.0, 255, 179, 71]
  ]`)}
`),
        fisBands: ['B02', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  if (sample.B02 === 0) return [0];
  let ironThreshold = Math.max(1.3, 1.4 - (DETECTION_SENSITIVITY * 0.3));
  let ironScore = Math.max(0, (sample.B04 / sample.B02) - ironThreshold) / 1.0;
  let ndsiSum = sample.B11 + sample.B12;
  if (ndsiSum === 0) return [0];
  let ndsi = (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.02, 0.04 - (DETECTION_SENSITIVITY * 0.08));
  let brineScore = Math.max(0, ndsi - brineThreshold);
  let ndviSum = sample.B08 + sample.B04;
  let noVeg = Math.max(0, 1.0 - Math.max(0, ndviSum === 0 ? 0 : (sample.B08 - sample.B04) / ndviSum));
  let score = (ironScore * brineScore) * noVeg;
  return [Math.min(1, Math.pow(score, 1.4) * 150.0)];
`
    },
    reai: {
        name: 'Red-Edge/Dual-SWIR Alteration Composite (REAI)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: '3-12M',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #0d1a2e, #2e5c8a, #c47a1e, #e8c44a)',
        formula: 'clamp(100·(redEdgeScore·dualSWIRScore)^2,0,1)',
        formulaStatus: 'Implemented red-edge × dual-SWIR display composite',
        validationStatus: 'Research-only surface-response proxy; no ferric-mineral or produced-water validation.',
        info: 'Experimental product of a thresholded B06/B05 red-edge ratio and thresholded dual-SWIR contrast. Vegetation structure, soil, sensor geometry, moisture, and mineralogy can affect both terms; it does not confirm goethite, hematite, or brine chemistry.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B05', 'B06', 'B11', 'B12'], `
  if (sample.dataMask === 0 || sample.B05 === 0) return [0,0,0,0];

  // 1. Red Edge Iron Ratio: B06/B05
  let redEdge = sample.B06 / sample.B05;
  let ironThreshold = Math.max(1.08, 1.18 - (DETECTION_SENSITIVITY * 0.15));
  let ironScore = Math.max(0, (redEdge - ironThreshold) / 0.45);

  // 2. Brine confirmation
  let ndsiSum = sample.B11 + sample.B12;
  if (ndsiSum === 0) return [0,0,0,0];
  let ndsi = (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.06, 0.12 - (DETECTION_SENSITIVITY * 0.1));
  let brineScore = Math.max(0, ndsi - brineThreshold);

  let reai = ironScore * brineScore;
  let mapped = Math.min(1, Math.pow(reai, 2.0) * 100.0);

  ${colorBlend('mapped', `[
      [0.0,  13, 26, 46],
      [0.3,  46, 92, 138],
      [0.65, 196, 122, 30],
      [1.0,  232, 196, 74]
  ]`)}
`),
        fisBands: ['B05', 'B06', 'B11', 'B12'],
        fisLogic: `
  if (sample.B05 === 0) return [0];
  let ironThreshold = Math.max(1.08, 1.18 - (DETECTION_SENSITIVITY * 0.15));
  let ironScore = Math.max(0, (sample.B06 / sample.B05) - ironThreshold) / 0.45;
  let ndsiSum = sample.B11 + sample.B12;
  let brineThreshold = Math.max(0.06, 0.12 - (DETECTION_SENSITIVITY * 0.1));
  let brineScore = ndsiSum === 0 ? 0 : Math.max(0, (sample.B11 - sample.B12) / ndsiSum - brineThreshold);
  return [Math.min(1, Math.pow(ironScore * brineScore, 2.0) * 100.0)];
`
    },
    vcbi: {
        name: 'Vegetation-Stress/Dual-SWIR Composite (VCBI)',
        tags: ['salinity'],
        sensor: 'Sentinel-2 L2A',
        temporal: '6-24M',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #0a2010, #1a6030, #c8a000, #e05010)',
        formula: 'clamp(30·(invertedCRSIScore·dualSWIRScore)^1.5,0,1)',
        formulaStatus: 'Implemented inverted-CRSI × dual-SWIR display composite',
        validationStatus: 'Research-only stress proxy; it does not attribute vegetation stress to chloride or produced water.',
        info: 'Experimental co-occurrence of lower CRSI response and elevated dual-SWIR contrast. Drought, disease, grazing, fire, soil disturbance, and other stressors remain plausible causes; the composite does not confirm a brine-kill zone.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], `
  if (sample.dataMask === 0) return [0,0,0,0];

  // 1. Inverted CRSI: high = vegetation mortality from brine stress
  let top = (sample.B08 * sample.B04) - (sample.B03 * sample.B02);
  let bot = (sample.B08 * sample.B04) + (sample.B03 * sample.B02);
  let crsi = (bot <= 0 || top < 0) ? 0 : Math.sqrt(top / bot);
  // Invert: healthy veg = low score, brine-stressed/dead = high score
  let stressThreshold = 0.55 + (DETECTION_SENSITIVITY * 0.2);
  let stressScore = Math.max(0, stressThreshold - crsi) * (1.0 / 0.55);

  // 2. Brine chemistry at same pixel
  let ndsiSum = sample.B11 + sample.B12;
  if (ndsiSum === 0) return [0,0,0,0];
  let ndsi = (sample.B11 - sample.B12) / ndsiSum;
  let brineThreshold = Math.max(0.05, 0.10 - (DETECTION_SENSITIVITY * 0.08));
  let brineScore = Math.max(0, ndsi - brineThreshold);

  let vcbi = stressScore * brineScore;
  let mapped = Math.min(1, Math.pow(vcbi, 1.5) * 30.0);

  ${colorBlend('mapped', `[
      [0.0,  10, 32, 16],
      [0.3,  26, 96, 48],
      [0.65, 200, 160, 0],
      [1.0,  224, 80, 16]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let top = (sample.B08 * sample.B04) - (sample.B03 * sample.B02);
  let bot = (sample.B08 * sample.B04) + (sample.B03 * sample.B02);
  let crsi = (bot <= 0 || top < 0) ? 0 : Math.sqrt(top / bot);
  let stressThreshold = 0.55 + (DETECTION_SENSITIVITY * 0.2);
  let stressScore = Math.max(0, stressThreshold - crsi) * (1.0 / 0.55);
  let ndsiSum = sample.B11 + sample.B12;
  let brineThreshold = Math.max(0.05, 0.10 - (DETECTION_SENSITIVITY * 0.08));
  let brineScore = ndsiSum === 0 ? 0 : Math.max(0, (sample.B11 - sample.B12) / ndsiSum - brineThreshold);
  return [Math.min(1, Math.pow(stressScore * brineScore, 1.5) * 30.0)];
`
    },
    pwi: {
        name: 'PWCI — Produced-Water Contrast Index (formerly Produced Water Chemical Index / PWI)',
        tags: ['salinity', 'produced-water'],
        sensor: 'Sentinel-2 L2A',
        temporal: '0-3M',
        min: 'Background', max: 'Three-Ratio Response',
        gradient: 'linear-gradient(to right, #000000, #00FFFF, #FF00FF, #CCFF00)',
        formula: 'if BSI>mask: clamp((20·max(0,NDSI−τ₁)·2max(0,HCAI−τ₂)·2max(0,HMRI−τ₃))³,0,1); display≥0.05',
        formulaStatus: 'Implemented BSI-gated three-ratio screening architecture',
        validationStatus: 'Not validated as a detector: pipeline recall 81.5% with 96.7% background activation; shipped viewer was blank at 11/11 reviewed positives and 150/150 background controls.',
        info: 'Experimental three-ratio screening architecture. PWCI multiplies thresholded dual-SWIR, SWIR/Red, and SWIR2/Green proxies after a bare-soil gate, then applies a cubic display stretch. These broad Sentinel-2 ratios are not direct measurements of salinity, hydrocarbons, or heavy metals. The July 2026 threshold sweep found no useful separation between produced-water sites and Permian caliche at the tested 500 m single-scene support.',
        diffLabels: ['Lower Proxy Response', 'Higher Three-Ratio Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], `
  // 1. Bare Soil Index (BSI) -- URBAN / WATER / VEG MASK
  let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  if (bsiBot === 0) return [0,0,0,0];
  let bsi = bsiTop / bsiBot;
  
  if (bsi <= __BSI_MASK__) return [0,0,0,0];

  // 2. Dual-SWIR surface contrast (NDSI legacy key)
  let sumBrine = sample.B11 + sample.B12;
  if(sumBrine === 0) return [0,0,0,0];
  let brine = (sample.B11 - sample.B12) / sumBrine;
  
  // 3. SWIR1–Red surface contrast (HCAI legacy key)
  let sumHcai = sample.B11 + sample.B04;
  if(sumHcai === 0) return [0,0,0,0];
  let hcai = (sample.B11 - sample.B04) / sumHcai;
  
  // 4. SWIR2/Green surface contrast (HMRI legacy key)
  if(sample.B03 === 0) return [0,0,0,0];
  let hmri = sample.B12 / sample.B03;
  
  // True Classic Calibration (March 4th Restrictive)
  let brineScore = Math.max(0, brine - __PWI_SALINITY_OFFSET__);
  let hcaiScore = Math.max(0, (hcai - __PWI_HC_OFFSET__) * 2);
  let hmriScore = Math.max(0, (hmri - __PWI_HMRI_OFFSET__) * 2);
  
  let pwi = brineScore * hcaiScore * hmriScore;
  
  // Cubic scaling: aggressively suppresses background noise
  let mapped = Math.min(1.0, Math.pow(pwi * 20.0, 3.0));
  if (mapped < 0.05) return [0,0,0,0];
  ${colorBlend('mapped', PALETTE_PWI)}
`),
        fisBands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  if (bsiBot === 0 || (bsiTop / bsiBot) <= __BSI_MASK__) return [0];

  let sumNdsi = sample.B11 + sample.B12;
  if(sumNdsi === 0) return [0];
  let ndsi = (sample.B11 - sample.B12) / sumNdsi;
  
  let sumHcai = sample.B11 + sample.B04;
  if(sumHcai === 0) return [0];
  let hcai = (sample.B11 - sample.B04) / sumHcai;
  
  if(sample.B03 === 0) return [0];
  let hmri = sample.B12 / sample.B03;
  
  let pwi = Math.max(0, ndsi - __PWI_SALINITY_OFFSET__) * Math.max(0, (hcai - __PWI_HC_OFFSET__) * 2) * Math.max(0, (hmri - __PWI_HMRI_OFFSET__) * 2);
  let mapped = Math.min(1.0, Math.pow(pwi * 20.0, 3.0));
  return [mapped < 0.05 ? 0 : mapped];
`
    },
    lbi: {
        name: 'LBI — Liquid/Salinity Response Index (formerly Liquid Brine Index)',
        primaryScreener: true,
        fieldRole: 'Primary screener for standing liquid brine, containment pit overflows, and crater blowouts. Bypasses bare-soil mask when standing water is detected.',
        tags: ['salinity', 'produced-water'],
        sensor: 'Sentinel-2 L2A',
        temporal: '0-3M',
        min: 'Background', max: 'Liquid/Salinity Response',
        gradient: 'linear-gradient(to right, #000000, #0055ff, #00d2ff, #ffffff)',
        formula: '20·max(0,NDSI−0.02)·max(0,NDWI+0.40)·max(0,0.45−NDVI)·G; G=1 when NDWI>0.30, else max(0,BSI+0.20); display≥0.08',
        formulaStatus: 'Implemented water/salinity response proxy with standing-water bypass',
        validationStatus: 'Preliminary only: 2/4 standing-brine sites versus 0/3 freshwater controls at the reviewed threshold (two-sided Fisher exact p≈0.43); not brine-specific or validated.',
        info: 'Experimental liquid/salinity response proxy. It combines dual-SWIR contrast, wetness, low vegetation, and a surface gate; open water bypasses the BSI gate. Preliminary July 2026 sampling found low caliche activation but overlapping standing-brine and freshwater responses, so LBI must not be described as brine-specific or as a general produced-water detector.',
        diffLabels: ['Lower Liquid Response', 'Higher Liquid/Salinity Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B08', 'B11', 'B12'], `
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  
  let ndwiSum = sample.B03 + sample.B11;
  let ndwi = ndwiSum === 0 ? 0 : (sample.B03 - sample.B11) / ndwiSum;
  
  let ndviSum = sample.B08 + sample.B04;
  let ndvi = ndviSum === 0 ? 0 : (sample.B08 - sample.B04) / ndviSum;
  
  let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let bsi = bsiBot === 0 ? 0 : bsiTop / bsiBot;
  
  // Deep standing water bypasses the BSI gate — deep water absorbs SWIR
  // regardless of brine content, driving BSI far negative. Confirm open
  // water with NDWI and let NDSI carry the brine signal instead.
  let isStandingWater = ndwi > 0.30;
  if (bsi <= -0.25 && !isStandingWater) return [0,0,0,0];

  let brineGate = Math.max(0, ndsi - 0.02);
  let liquidGate = Math.max(0, ndwi + 0.40);
  let lowVegGate = Math.max(0, 0.45 - ndvi);
  let surfaceGate = isStandingWater ? 1.0 : Math.max(0, bsi + 0.20);
  let score = brineGate * liquidGate * lowVegGate * surfaceGate;
  let mapped = Math.min(1, score * 20.0);
  if (mapped < 0.08) return [0,0,0,0];
  
  ${colorBlend('mapped', `[
      [0.0, 0, 0, 0],
      [0.3, 0, 85, 255],
      [0.7, 0, 210, 255],
      [1.0, 255, 255, 255]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let ndwi = (sample.B03 + sample.B11) === 0 ? 0 : (sample.B03 - sample.B11) / (sample.B03 + sample.B11);
  let ndvi = (sample.B08 + sample.B04) === 0 ? 0 : (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  let bsi = (sample.B11+sample.B04+sample.B08+sample.B02) === 0 ? 0 : ((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02));
  let isStandingWater = ndwi > 0.30;
  if (bsi <= -0.25 && !isStandingWater) return [0];
  let surfaceGate = isStandingWater ? 1.0 : Math.max(0, bsi + 0.20);
  let score =
    Math.max(0, ndsi - 0.02) *
    Math.max(0, ndwi + 0.40) *
    Math.max(0, 0.45 - ndvi) *
    surfaceGate;
  let mapped = Math.min(1, score * 20.0);
  return [mapped < 0.08 ? 0 : mapped];
`
    },
    tri: {
        name: 'Three-Ratio Residue Composite (TRI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '6M+',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #1a0a00, #804000, #9933ff, #ff00ff)',
        formula: 'clamp((10·dualSWIRScore·SWIR2GreenScore·surfaceProductScore)^2,0,1)',
        formulaStatus: 'Implemented three-ratio residue-response display composite',
        validationStatus: 'Research-only surface proxy; no toxicity, metal, or produced-water attribution.',
        info: 'Experimental product of dual-SWIR, SWIR2/Green, and Red/Blue×SWIR surface contrasts. It can highlight persistent material differences but does not identify a toxic scab or historical spill without independent records and field confirmation.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B04', 'B11', 'B12'], `
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  
  let hmri = sample.B03 === 0 ? 0 : sample.B12 / sample.B03;
  
  let aoi = (sample.B02 === 0 || sample.B12 === 0) ? 0 : (sample.B04 / sample.B02) * (sample.B11 / sample.B12);
  
  let score = Math.max(0, ndsi - 0.05) * Math.max(0, (hmri - 1.5)/2) * Math.max(0, (aoi - 1.5)/2);
  let mapped = Math.min(1, Math.pow(score * 10, 2.0));
  
  ${colorBlend('mapped', `[
      [0.0, 26, 10, 0],
      [0.3, 128, 64, 0],
      [0.7, 153, 51, 255],
      [1.0, 255, 0, 255]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B04', 'B11', 'B12'],
        fisLogic: `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let hmri = sample.B03 === 0 ? 0 : sample.B12 / sample.B03;
  let aoi = (sample.B02 === 0 || sample.B12 === 0) ? 0 : (sample.B04 / sample.B02) * (sample.B11 / sample.B12);
  let score = Math.max(0, ndsi - 0.05) * Math.max(0, (hmri - 1.5)/2) * Math.max(0, (aoi - 1.5)/2);
  return [Math.min(1, Math.pow(score * 10, 2.0))];
`
    },
    bpi: {
        name: 'Bare-Pad Three-Ratio Composite (BPI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #222222, #444444, #00FFFF, #FFFF00)',
        formula: 'clamp(30·bareSoilScore·dualSWIRScore·SWIR1RedScore,0,1)',
        formulaStatus: 'Implemented bare-surface three-ratio display composite',
        validationStatus: 'Research-only pad-surface proxy; no pinhole-leak or contamination validation.',
        info: 'Experimental co-occurrence of bare-soil, dual-SWIR, and SWIR1–Red contrasts. It can organize inspection of pads and roads, but cannot distinguish a leak from construction, grading, moisture, substrate, or residue without independent evidence.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B04', 'B08', 'B11', 'B12'], `
  let bsiTop = (sample.B11 + sample.B04) - (sample.B08 + sample.B02);
  let bsiBot = (sample.B11 + sample.B04) + (sample.B08 + sample.B02);
  let bsi = bsiBot === 0 ? 0 : bsiTop / bsiBot;
  if (bsi <= __BSI_MASK__) return [0,0,0,0]; // Loosened for pad-level spills
  
  let ndsiSum = sample.B11 + sample.B12;
  let ndsi = ndsiSum === 0 ? 0 : (sample.B11 - sample.B12) / ndsiSum;
  
  let hcaiSum = sample.B11 + sample.B04;
  let hcai = hcaiSum === 0 ? 0 : (sample.B11 - sample.B04) / hcaiSum;
  
  let score = Math.max(0, bsi + __BSI_OFFSET__) * Math.max(0, ndsi - 0.03) * Math.max(0, hcai - 0.15);
  let mapped = Math.min(1, score * 30.0);
  
  ${colorBlend('mapped', `[
      [0.0, 34, 34, 34],
      [0.3, 68, 68, 68],
      [0.7, 0, 255, 255],
      [1.0, 255, 255, 0]
  ]`)}
`),
        fisBands: ['B02', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let bsi = (sample.B11+sample.B04+sample.B08+sample.B02) === 0 ? 0 : ((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02));
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let hcai = (sample.B11 + sample.B04) === 0 ? 0 : (sample.B11 - sample.B04) / (sample.B11 + sample.B04);
  if (bsi <= __BSI_MASK__) return [0];
  let score = Math.max(0, bsi + __BSI_OFFSET__) * Math.max(0, ndsi - 0.03) * Math.max(0, hcai - 0.15);
  return [Math.min(1, score * 30.0)];
`
    },
    vsi: {
        name: 'Vegetation/Dual-SWIR Stress Composite (VSI)',
        sensor: 'Sentinel-2 L2A',
        temporal: '3-24M',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #005500, #FFFF00, #FF8800, #FF0000)',
        formula: 'clamp(10·dualSWIRScore·redEdgeStressScore·moistureStressScore,0,1)',
        formulaStatus: 'Implemented vegetation and dual-SWIR stress display composite',
        validationStatus: 'Research-only vegetation-stress proxy; no toxicity or produced-water attribution.',
        info: 'Experimental product of dual-SWIR contrast, a red-edge term, and MSI. It may surface vegetation stress, but drought, phenology, fire, disease, grazing, and soil disturbance remain confounders.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B05', 'B07', 'B11', 'B12', 'B8A'], `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let redEdgeDelta = (sample.B07 + sample.B05) === 0 ? 0 : (sample.B07 - sample.B05) / (sample.B07 + sample.B05);
  let msi = sample.B8A === 0 ? 0 : sample.B11 / sample.B8A;
  
  let score = Math.max(0, ndsi) * Math.max(0, 0.4 - redEdgeDelta) * Math.max(0, msi - 1.0);
  let mapped = Math.min(1, score * 10.0);
  
  ${colorBlend('mapped', `[
      [0.0, 0, 85, 0],
      [0.3, 255, 255, 0],
      [0.7, 255, 136, 0],
      [1.0, 255, 0, 0]
  ]`)}
`),
        fisBands: ['B05', 'B07', 'B11', 'B12', 'B8A'],
        fisLogic: `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let redEdgeDelta = (sample.B07 + sample.B05) === 0 ? 0 : (sample.B07 - sample.B05) / (sample.B07 + sample.B05);
  let msi = sample.B8A === 0 ? 0 : sample.B11 / sample.B8A;
  let score = Math.max(0, ndsi) * Math.max(0, 0.4 - redEdgeDelta) * Math.max(0, msi - 1.0);
  return [Math.min(1, score * 10.0)];
`
    },
    cma: {
        name: 'Clay/Surface Contrast Composite (CMA)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Persistent',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #442200, #884400, #AA88AA, #FFFFFF)',
        formula: 'clamp(15·dualSWIRScore·SWIRRatioScore·redBlueScore,0,1)',
        formulaStatus: 'Implemented three-ratio surface display composite',
        validationStatus: 'Research-only mineral/surface proxy; no clay-lattice or produced-water validation.',
        info: 'Experimental combination of dual-SWIR, SWIR1/SWIR2, and Red/Blue surface contrasts. It may highlight persistent substrate differences but cannot establish clay-lattice disruption or chemical alteration.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B04', 'B11', 'B12'], `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let clayRatio = sample.B12 === 0 ? 0 : sample.B11 / sample.B12;
  let ironIndex = sample.B02 === 0 ? 0 : sample.B04 / sample.B02;
  
  let score = Math.max(0, ndsi) * Math.max(0, clayRatio - 1.2) * Math.max(0, ironIndex - 1.5);
  let mapped = Math.min(1, score * 15.0);
  
  ${colorBlend('mapped', `[
      [0.0, 68, 34, 0],
      [0.3, 136, 68, 0],
      [0.7, 170, 136, 170],
      [1.0, 255, 255, 255]
  ]`)}
`),
        fisBands: ['B02', 'B04', 'B11', 'B12'],
        fisLogic: `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let clayRatio = (sample.B12 === 0) ? 0 : sample.B11 / sample.B12;
  let ironIndex = (sample.B02 === 0) ? 0 : sample.B04 / sample.B02;
  let score = Math.max(0, ndsi) * Math.max(0, clayRatio - 1.2) * Math.max(0, ironIndex - 1.5);
  return [Math.min(1, score * 15.0)];
`
    },
    phi: {
        name: 'SWIR-Shoulder Surface Composite (PHI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '0-6M',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #000000, #333333, #663300, #FFCC00)',
        formula: 'clamp(20·dualSWIRScore·SWIRShoulderScore·SWIR1RedScore,0,1)',
        formulaStatus: 'Implemented three-ratio SWIR/visible display composite',
        validationStatus: 'Research-only surface proxy; not a petroleum or oily-brine retrieval.',
        info: 'Experimental product of dual-SWIR, SWIR1/SWIR2, and SWIR1–Red contrasts. Sentinel-2 broad bands do not resolve a diagnostic petroleum absorption feature here, so the composite cannot separate oily brine from other surface materials without independent confirmation.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B04', 'B11', 'B12'], `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let shoulder = sample.B12 === 0 ? 0 : sample.B11 / sample.B12;
  let hcai = (sample.B11 + sample.B04) === 0 ? 0 : (sample.B11 - sample.B04) / (sample.B11 + sample.B04);
  
  let score = Math.max(0, ndsi) * Math.max(0, shoulder - 1.0) * Math.max(0, hcai - 0.2);
  let mapped = Math.min(1, score * 20.0);
  
  ${colorBlend('mapped', `[
      [0.0, 0, 0, 0],
      [0.3, 51, 51, 51],
      [0.7, 102, 51, 0],
      [1.0, 255, 204, 0]
  ]`)}
`),
        fisBands: ['B04', 'B11', 'B12'],
        fisLogic: `
  let ndsi = (sample.B11 + sample.B12) === 0 ? 0 : (sample.B11 - sample.B12) / (sample.B11 + sample.B12);
  let shoulder = (sample.B12 === 0) ? 0 : sample.B11 / sample.B12;
  let hcai = (sample.B11 + sample.B04) === 0 ? 0 : (sample.B11 - sample.B04) / (sample.B11 + sample.B04);
  let score = Math.max(0, ndsi) * Math.max(0, shoulder - 1.0) * Math.max(0, hcai - 0.2);
  return [Math.min(1, score * 20.0)];
`
    },
    hmi: {
        name: 'Green–SWIR Interaction Composite (HMI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: '12M+',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #001100, #004400, #00FFBB, #FFFFFF)',
        formula: 'clamp(10·greenBlueScore·SWIRRatioScore,0,1)',
        formulaStatus: 'Implemented green/blue × SWIR-ratio display composite',
        validationStatus: 'Research-only surface proxy; no barium, strontium, radium, or total-metal validation.',
        info: 'Experimental product of Green/Blue and SWIR1/SWIR2 ratios. Heavy-metal concentration requires field sampling and calibrated modeling; this composite cannot identify metal precipitation or detoxification.',
        diffLabels: ['Lower Composite Response', 'Higher Composite Response'],
        evalscript: genEvalscript(['B02', 'B03', 'B11', 'B12'], `
  let greenShift = sample.B02 === 0 ? 0 : sample.B03 / sample.B02;
  let saltPPT = sample.B12 === 0 ? 0 : sample.B11 / sample.B12;
  
  let score = Math.max(0, greenShift - 1.1) * Math.max(0, saltPPT - 1.2);
  let mapped = Math.min(1, score * 10.0);
  
  ${colorBlend('mapped', `[
      [0.0, 0, 17, 0],
      [0.3, 0, 68, 0],
      [0.7, 0, 255, 187],
      [1.0, 255, 255, 255]
  ]`)}
`),
        fisBands: ['B02', 'B03', 'B11', 'B12'],
        fisLogic: `
  let greenShift = (sample.B02 === 0) ? 0 : sample.B03 / sample.B02;
  let saltPPT = (sample.B12 === 0) ? 0 : sample.B11 / sample.B12;
  let score = Math.max(0, greenShift - 1.1) * Math.max(0, saltPPT - 1.2);
  return [Math.min(1, score * 10.0)];
`
    },
    scri: {
        name: 'SAR Surface-Contrast Index (SCRI legacy)',
        tags: ['salinity'],
        sensor: 'Sentinel-1 GRD',
        temporal: '3-12M',
        min: 'Lower Response', max: 'Higher Response',
        gradient: 'linear-gradient(to right, #000000, #4b0082, #e74c3c, #f1c40f)',
        formula: 'clamp((0.5·max(0,(VH_dB+19)/9)·max(0,(VH_dB−VV_dB+6)/5))^2.5,0,1)',
        formulaStatus: 'Implemented single-scene Sentinel-1 VV/VH surface-contrast proxy',
        validationStatus: 'Not calibrated to electrical conductivity or validated as a salt-crust classifier.',
        info: 'Experimental Sentinel-1 backscatter and polarization-contrast response. Roughness, moisture, vegetation, incidence angle, and substrate all affect VV/VH. It provides all-weather surface context but no optical salt proxy or chemical salinity confirmation.',
        diffLabels: ['Lower SAR Contrast', 'Higher SAR Contrast'],
        evalscript: `//VERSION=3
function setup() {
  return {
    input: ["VV", "VH", "dataMask"],
    output: { id: "default", bands: 4 }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0,0,0,1];
  let vh = 10 * Math.log10(sample.VH);
  let vv = 10 * Math.log10(sample.VV);
  let ratio = vh - vv;
  // Contrast hardened: -19dB floor, 6dB ratio bias, powered scaling
  let score = Math.max(0, (vh + 19) / 9) * Math.max(0, (ratio + 6) / 5);
  let mapped = Math.min(1, Math.pow(score * 0.5, 2.5));
  
  ${colorBlend('mapped', `[
      [0.0, 0, 0, 0],
      [0.3, 75, 0, 130],
      [0.7, 231, 76, 60],
      [1.0, 241, 196, 15]
  ]`)}
}`,
        fisBands: ['VV', 'VH'],
        fisLogic: `
  let vh = 10 * Math.log10(sample.VH);
  let vv = 10 * Math.log10(sample.VV);
  let score = Math.max(0, (vh + 19) / 9) * Math.max(0, (vh - vv + 6) / 5);
  return [Math.min(1, Math.pow(score * 0.5, 2.5))];
`
    },
    s1_sar: {
        name: 'Sentinel-1 VV Backscatter Context',
        sensor: 'Sentinel-1 GRD',
        min: 'Lower VV Backscatter', max: 'Higher VV Backscatter',
        gradient: 'linear-gradient(to right, #000000, #448833, #CCDD55)',
        formula: 'grayscale clamp((10·log10(VV)+20)/20,0,1)',
        info: 'Single-channel Sentinel-1 VV backscatter context rendered in grayscale. Backscatter responds to roughness, dielectric properties, geometry, vegetation, and moisture; low or high values are not uniquely dry, wet, smooth, or rough.',
        diffLabels: ['Lower VV Backscatter', 'Higher VV Backscatter'],
        evalscript: `//VERSION=3
function setup() {
  return {
    input: ["VV", "VH", "dataMask"],
    output: { bands: 4 }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0,0,0,0];
  // Convert power to decibels
  let vv_db = Math.max(0, Math.min(1, (Math.log10(sample.VV) * 10 + 20) / 20));
  
  if (typeof VISUAL_FILTER !== 'undefined' && vv_db < VISUAL_FILTER) return [0,0,0,0];
  
  // Map backscatter to grayscale (smooth/dark -> rough/white)
  return [vv_db, vv_db, vv_db, 1];
}`,
        fisBands: ['VV', 'VH'],
        fisLogic: `
  if (sample.VV <= 0) return [0];
  return [Math.max(0, Math.min(1, (Math.log10(sample.VV) * 10 + 20) / 20))];
`
    },
    mvpi: {
        name: 'Single-Scene SWIR Ratio Screen (MVPI legacy)',
        sensor: 'Sentinel-2 L2A',
        temporal: 'Live',
        min: 'Lower Response', max: 'Higher SWIR-Ratio Response',
        gradient: 'linear-gradient(to right, #0d171b, #f57814, #ffb400)',
        formula: 'clamp(3·brightSurfaceGate·max(0,(B11/B12−1.15)·4)·waterReject·vegReject,0,1)',
        formulaStatus: 'Implemented single-scene Sentinel-2 SWIR-ratio surface screen',
        validationStatus: 'Not a methane retrieval; no MBSP/MBMP reference-scene fitting or plume validation.',
        info: 'Experimental single-scene B11/B12 surface-ratio screen over bright, sparsely vegetated ground. Operational Sentinel-2 methane methods require scene fitting and commonly a non-plume reference observation; this layer must not be interpreted as methane detection.',
        diffLabels: ['Lower SWIR-Ratio Response', 'Higher SWIR-Ratio Response'],
        evalscript: genEvalscript(['B03', 'B04', 'B08', 'B11', 'B12'], `
  if (sample.dataMask === 0) return [0,0,0,0];
  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  let methaneRatio = sample.B11 / Math.max(sample.B12, 0.001);
  let methaneScore = Math.max(0.0, (methaneRatio - 1.15) * 4.0);
  let swirMean = (sample.B11 + sample.B12) / 2.0;
  let groundGate = Math.max(0.0, (swirMean - 0.20) * 2.0);
  let waterReject = sample.B03 > sample.B11 ? 0.0 : 1.0;
  let vegReject = ndvi > 0.15 ? 0.0 : 1.0;
  let score = waterReject * vegReject * groundGate * methaneScore;
  let mapped = Math.min(1.0, score * 3.0);
  ${colorBlend('mapped', PALETTE_METHANE)}
`),
        fisBands: ['B03', 'B04', 'B08', 'B11', 'B12'],
        fisLogic: `
  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  let methaneRatio = sample.B11 / Math.max(sample.B12, 0.001);
  let methaneScore = Math.max(0.0, (methaneRatio - 1.15) * 4.0);
  let swirMean = (sample.B11 + sample.B12) / 2.0;
  let groundGate = Math.max(0.0, (swirMean - 0.20) * 2.0);
  let waterReject = sample.B03 > sample.B11 ? 0.0 : 1.0;
  let vegReject = ndvi > 0.15 ? 0.0 : 1.0;
  return [Math.min(1.0, waterReject * vegReject * groundGate * methaneScore * 3.0)];
`
    }
};

// Per-index thresholds matching the scan rule engine
export const HIGHLIGHT_THRESHOLDS = {
    pwi:  0.10,   // Produced Water Composite — scan flags > 0.10
    hpwi: 0.05,   // Hot-Pixel PW Index — scan flags > 0.05
    pwoi: 0.05,   // PWOI Produced Water Optical Index — scan flags > 0.05
    fbc:  0.10,   // Forensic Brine Composite — scan flags > 0.1
    lbi:  0.08,   // Active liquid brine after stricter wet/bare gates
    ndmi: 0.35,   // Normalized Diff Moisture — anomaly when high + dry
    ndwi: 0.15,   // Water 
    si:   0.15,   // Salinity Index
    ndsi: 0.15,   // Saline Content (Brine)
    bsi:  0.10,   // Bare Soil Index
    csi:  1.20,   // Contaminated Soil (Clay Ratio > 1.2 is anomalous)
    hcai: 0.10,   // Hydrocarbons (offset-adjusted, > 0.10 above baseline)
    hmri: 0.10,   // Heavy Metals (offset-adjusted, > 0.10 above baseline)
    ndoi: 0.15,   // Oil Slicks
    msi:  1.20,   // Moisture Stress (ratio > 1.2 = stressed)
    savi: 0.25,   // Vegetation (highlight low-veg/barren areas)
    vsi:  0.10,   // Proxy
    scri: 0.10,   // Proxy
    tri:  0.08,   // Proxy
    bpi:  0.08,    // Proxy
    mvpi: 0.10
};

export const CHART_COLORS = {
    ndmi: '#1C85A6', ndwi: '#1450B4', ndvi: '#146428', savi: '#A07832',
    msi: '#D46A24', s1_sar: '#999999', ndsi: '#FF00FF', bsi: '#A07832', hcai: '#8B4513',
    hpwi: '#f1c40f', pwi: '#00D2FF', lbi: '#00D2FF', fbc: '#FFB347',
    vsi: '#FFD700', scri: '#FF4500', tri: '#9933ff', bpi: '#00FFFF',
    tc: '#FFFFFF', fc: '#FF0000', si: '#00FFFF', csi: '#8B4513',
    hmri: '#808080', ndoi: '#000000', crsi: '#FF5555', aoi: '#5555FF',
    ehc: '#333333', reai: '#FF0055', vcbi: '#AA0000', cma: '#AA88AA',
    phi: '#FF00FF', hmi: '#444444', pwoi: '#8C00FF',
    mvpi: '#f57814', ksi: '#EBE1BE', vssi: '#B22222'
};

export function getHighlightScript(indexKey, hexColor, chartValue, includeContext = false, activeBasin = 'permian', useScl = false) {
    const cfg = INDICES[indexKey];
    if (!cfg || !cfg.fisLogic) return '';
    const isSar = cfg.sensor && cfg.sensor.includes('Sentinel-1');
    
    // Apply Dynamic Calibration Placeholders to the logic
    const cal = CALIBRATION_PRESETS[activeBasin || 'permian'];
    let logic = cfg.fisLogic
        .replace(/__BSI_MASK__/g, cal.bsiMask)
        .replace(/__BSI_OFFSET__/g, cal.bsiOffset)
        .replace(/__NDWI_OFFSET__/g, cal.ndwiOffset)
        .replace(/__PWI_SALINITY_OFFSET__/g, cal.pwiSalinityOffset)
        .replace(/__PWI_HC_OFFSET__/g, cal.pwiHydrocarbonOffset)
        .replace(/__PWI_HMRI_OFFSET__/g, cal.pwiHmriOffset);

    // If context is requested, we need B04, B03, B02 for True Color background
    const contextBands = isSar ? [] : ['B04', 'B03', 'B02', ...(useScl ? ['SCL'] : [])];
    const bandsList = [...new Set([...(cfg.fisBands || []), ...contextBands])];
    
    // Use dynamic chart value as the highlight threshold if available
    let rawThreshold = HIGHLIGHT_THRESHOLDS[indexKey] || 0.20;
    if (chartValue !== undefined && chartValue !== null && !isNaN(chartValue)) {
        rawThreshold = Math.min(parseFloat(chartValue), rawThreshold);
    }
    
    const threshold = (rawThreshold * 0.90).toFixed(5);
    
    // Convert hex to float RGB
    let r = 1.0, g = 0.0, b = 1.0;
    if (hexColor && hexColor.startsWith('#') && hexColor.length === 7) {
        r = parseInt(hexColor.slice(1, 3), 16) / 255;
        g = parseInt(hexColor.slice(3, 5), 16) / 255;
        b = parseInt(hexColor.slice(5, 7), 16) / 255;
    }
    
    return `//VERSION=3
function setup() {
  return {
    input: [${bandsList.map(b => `'${b}'`).join(', ')}, "dataMask"],
    output: { bands: 4 }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  ${isSar || !useScl ? '' : '// SCL_QA_START\n  if (!(sample.SCL === 4 || sample.SCL === 5 || sample.SCL === 6 || sample.SCL === 7)) return [0, 0, 0, 0];\n  // SCL_QA_END'}
  const calculate = (sample) => {
    ${logic}
  };
  let result = calculate(sample);
  let val = Array.isArray(result) ? result[0] : result;
  
  if (${!includeContext}) {
     // OFFSCREEN PEAK DETECTION MODE
     // Encode the continuous value (mapped to 0..1) into 24-bit truecolor RGB
     // so the JS canvas can resolve ties among 16.7 million levels.
     let norm = (val + 1.0) / 4.0;
     let v = Math.max(0.0, Math.min(1.0, norm));
     let v24 = Math.floor(v * 16777215); // 2^24 - 1
     
     let cR = Math.floor(v24 / 65536) / 255.0;
     let cG = Math.floor((v24 % 65536) / 256) / 255.0;
     let cB = (v24 % 256) / 255.0;
     
     return [cR, cG, cB, 1.0];
  } else {
     // THUMBNAIL VISUAL MODE
     // Blend highlights over True Color background at 60% opacity
     let factor = 2.5;
     let tR = sample.B04 * factor;
     let tG = sample.B03 * factor;
     let tB = sample.B02 * factor;

     if (val >= ${threshold}) {
         return [
             (tR * 0.4) + (${r.toFixed(3)} * 0.6),
             (tG * 0.4) + (${g.toFixed(3)} * 0.6),
             (tB * 0.4) + (${b.toFixed(3)} * 0.6),
             1.0
         ]; 
     } else {
         return [tR, tG, tB, 1.0];
     }
  }
}`;
}

export function getShortIndexName(indexKey) {
    if (!indexKey) return '';
    const mapping = {
        pwi: 'PWCI',
        hpwi: 'OBEC',
        pwoi: 'ASAI',
        ehc: 'EHC',
        ndvi: 'NDVI',
        savi: 'SAVI',
        ndmi: 'NDMI',
        ndwi: 'NDWI',
        ndsi: 'NDSI',
        bsi: 'BSI',
        lbi: 'LBI',
        fbc: 'FBC',
        vsi: 'VSI',
        scri: 'SCRI',
        tri: 'TRI',
        bpi: 'BPI',
        phi: 'PHI',
        cma: 'CMA',
        hmi: 'HMI',
        vcbi: 'VCBI',
        reai: 'REAI',
        aoi: 'AOI',
        tc: 'True Color',
        fc: 'False Color',
        mvpi: 'MV-PI'
    };
    return mapping[indexKey.toLowerCase()] || indexKey.toUpperCase();
}
