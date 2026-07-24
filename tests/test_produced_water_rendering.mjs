import assert from 'node:assert/strict';
import { CALIBRATION_PRESETS, INDICES, adaptEvalscriptForSentinelWms } from '../src/indices.js';

const cal = CALIBRATION_PRESETS.permian;

function buildEvaluatePixel(indexKey) {
  let script = INDICES[indexKey].evalscript
    .replace(/__BSI_MASK__/g, cal.bsiMask)
    .replace(/__BSI_OFFSET__/g, cal.bsiOffset)
    .replace(/__NDWI_OFFSET__/g, cal.ndwiOffset)
    .replace(/__PWI_SALINITY_OFFSET__/g, cal.pwiSalinityOffset)
    .replace(/__PWI_HC_OFFSET__/g, cal.pwiHydrocarbonOffset)
    .replace(/__PWI_HMRI_OFFSET__/g, cal.pwiHmriOffset);

  script = `const VISUAL_FILTER = 0;\nconst DETECTION_SENSITIVITY = 0;\n${script}`;
  // This test exercises the core index math, not the per-pixel SCL cloud/quality gate every
  // evalscript now carries (added 2026-07-21) — synthetic samples below have no SCL property, so
  // the gate would zero every result before the formula ever runs. Strip it, same as
  // getScriptContent() does for a WMS carrier that can't supply SCL.
  script = adaptEvalscriptForSentinelWms(script, false);
  return new Function(`${script}\nreturn evaluatePixel;`)();
}

function alpha(output) {
  assert.equal(output.length, 4, 'evalscript returns RGBA output');
  return output[3];
}

const evaluatePwci = buildEvaluatePixel('pwi');
const evaluateObec = buildEvaluatePixel('hpwi');
const evaluateAsai = buildEvaluatePixel('pwoi');
const evaluateLbi = buildEvaluatePixel('lbi');

const pwciHigh = {
  B02: 0.10,
  B03: 0.10,
  B04: 0.20,
  B08: 0.20,
  B11: 0.60,
  B12: 0.30,
  dataMask: 1
};

const pwciBackground = {
  B02: 0.18,
  B03: 0.30,
  B04: 0.28,
  B08: 0.24,
  B11: 0.30,
  B12: 0.27,
  dataMask: 1
};

const obecHigh = {
  B02: 0.50,
  B03: 0.30,
  B11: 0.08,
  B12: 0.05,
  dataMask: 1
};

const obecBackground = {
  B02: 0.10,
  B03: 0.10,
  B11: 0.30,
  B12: 0.30,
  dataMask: 1
};

const asaiAridBackground = {
  B02: 0.08,
  B03: 0.13,
  B04: 0.24,
  B08: 0.24,
  B11: 0.50,
  B12: 0.45,
  dataMask: 1
};

const asaiBroadSaltyBareSoil = {
  B02: 0.08,
  B03: 0.13,
  B04: 0.30,
  B08: 0.20,
  B11: 0.55,
  B12: 0.43,
  dataMask: 1
};

const asaiDryBrine = {
  B02: 0.05,
  B03: 0.12,
  B04: 0.35,
  B08: 0.15,
  B11: 0.50,
  B12: 0.35,
  dataMask: 1
};

const lbiLiquidBrine = {
  B02: 0.04,
  B03: 0.18,
  B04: 0.08,
  B08: 0.05,
  B11: 0.08,
  B12: 0.055,
  dataMask: 1
};

const lbiWetBackground = {
  B02: 0.08,
  B03: 0.12,
  B04: 0.16,
  B08: 0.18,
  B11: 0.25,
  B12: 0.22,
  dataMask: 1
};

const lbiVegetatedWet = {
  B02: 0.06,
  B03: 0.15,
  B04: 0.20,
  B08: 0.45,
  B11: 0.12,
  B12: 0.10,
  dataMask: 1
};

assert.equal(alpha(evaluatePwci(pwciHigh)), 1, 'PWCI high signal remains opaque');
assert.equal(alpha(evaluateObec(obecHigh)), 1, 'OBEC high signal remains opaque');
assert.equal(alpha(evaluatePwci(pwciBackground)), 0, 'PWCI background is transparent');
assert.equal(alpha(evaluateObec(obecBackground)), 0, 'OBEC background is transparent');
assert.equal(alpha(evaluateAsai(asaiAridBackground)), 0, 'ASAI arid background is transparent');
assert.equal(alpha(evaluateAsai(asaiBroadSaltyBareSoil)), 0, 'ASAI broad salty bare soil is transparent');
assert.equal(alpha(evaluateAsai(asaiDryBrine)), 1, 'ASAI dry brine signal remains opaque');
assert.equal(alpha(evaluateLbi(lbiLiquidBrine)), 1, 'LBI liquid brine signal remains opaque');
assert.equal(alpha(evaluateLbi(lbiWetBackground)), 0, 'LBI wet-ish background stays transparent');
assert.equal(alpha(evaluateLbi(lbiVegetatedWet)), 0, 'LBI rejects vegetated wet surfaces');
assert.deepEqual(
  INDICES.lbi.fisBands,
  ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
  'LBI statistics bands include every band used by the stricter BSI gate'
);

console.log('Produced-water rendering regression checks passed');
