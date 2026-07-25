/* ==========================================================================
   Globe & Atlas · Limn — Global Spectral Index Atlas
   91 proposed index specifications across 12 domains. No produced-water content.
   Version 2 keeps contribution, implementation maturity, event context, and
   scientific validation as separate fields.
   ========================================================================== */

const genEvalscript = (bands, logic) => `//VERSION=3
function setup() {
  return { input: [${bands.map(b=>`'${b}'`).join(', ')}, "dataMask"], output: { bands: 4 }, upsampling: "BILINEAR", downsampling: "BILINEAR" };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0,0,0,0];
  ${logic}
}`;

const TC = genEvalscript(['B04','B03','B02'],
  `return [sample.B04*2.5, sample.B03*2.5, sample.B02*2.5, 1];`);

// colorBlend: returns inline JS string for evalscript gradient
// Uses explicit alpha checks (no ?? operator) for SH evalscript compatibility
const cb = (v, stops) => {
  const s = JSON.stringify(stops);
  return `(function(){var v=${v};if(isNaN(v))return[0,0,0,0];var s=${s};var i=0;while(i<s.length-1&&v>=s[i+1][0])i++;if(i===s.length-1){var c=s[i];return[c[1]/255,c[2]/255,c[3]/255,c.length>4?c[4]:1];}var a=s[i],b=s[i+1],t=(v-a[0])/(b[0]-a[0]);var a4=a.length>4?a[4]:1,b4=b.length>4?b[4]:1;return[(a[1]+t*(b[1]-a[1]))/255,(a[2]+t*(b[2]-a[2]))/255,(a[3]+t*(b[3]-a[3]))/255,a4+t*(b4-a4)];})()`;
};

// Shared palette stop arrays
const P = {
  fire:    [[0,20,17,14],[0.3,139,107,66],[0.6,217,134,79],[0.85,230,180,80],[1,226,102,90]],
  water:   [[0,13,34,39],[0.3,111,201,220],[0.6,142,207,128],[0.85,230,180,80],[1,226,102,90]],
  algae:   [[0,13,34,39],[0.25,30,80,60],[0.55,80,180,80],[0.8,200,220,60],[1,240,180,0]],
  mine:    [[0,17,20,24],[0.3,230,180,80],[0.6,217,134,79],[1,226,102,90]],
  urban:   [[0,24,21,21],[0.3,142,207,128],[0.6,230,180,80],[0.85,217,134,79],[1,226,102,90]],
  perm:    [[0,17,16,24],[0.3,111,201,220],[0.6,182,149,232],[0.85,217,134,79],[1,226,102,90]],
  forest:  [[0,10,32,16],[0.3,26,96,48],[0.6,200,160,0],[1,224,80,16]],
  dry:     [[0,23,19,15],[0.3,188,174,101],[0.6,217,134,79],[1,226,102,90]],
  wetland: [[0,13,29,29],[0.3,111,201,220],[0.6,142,207,128],[0.85,230,180,80],[1,226,102,90]],
  fuel:    [[0,19,23,15],[0.3,142,207,128],[0.6,230,180,80],[0.85,217,134,79],[1,226,102,90]],
  silt:    [[0,13,23,32],[0.3,111,201,220],[0.6,188,174,101],[0.85,217,134,79],[1,226,102,90]],
  scum:    [[0,13,34,39],[0.3,111,201,220],[0.6,142,207,128],[0.85,230,180,80],[1,226,102,90]],
};

// Domain CSS gradient for legend bar
const G = {
  fire:    'linear-gradient(to right,#141109,#8b6b42,#d9864f,#e6b450,#e2665a)',
  water:   'linear-gradient(to right,#0d2227,#6fc9dc,#8ecf80,#e6b450,#e2665a)',
  algae:   'linear-gradient(to right,#0d2227,#1e5040,#50b450,#c8dc3c,#f0b400)',
  mine:    'linear-gradient(to right,#111418,#e6b450,#d9864f,#e2665a)',
  urban:   'linear-gradient(to right,#181515,#8ecf80,#e6b450,#d9864f,#e2665a)',
  perm:    'linear-gradient(to right,#111018,#6fc9dc,#b695e8,#d9864f,#e2665a)',
  forest:  'linear-gradient(to right,#0a2010,#1a6030,#c8a000,#e05010)',
  dry:     'linear-gradient(to right,#17130f,#bcae65,#d9864f,#e2665a)',
  wetland: 'linear-gradient(to right,#0d1d1d,#6fc9dc,#8ecf80,#e6b450,#e2665a)',
  fuel:    'linear-gradient(to right,#131710,#8ecf80,#e6b450,#d9864f,#e2665a)',
  silt:    'linear-gradient(to right,#0d1720,#6fc9dc,#bcae65,#d9864f,#e2665a)',
  marine:  'linear-gradient(to right,#060d18,#0a3060,#1878b4,#50d0e0,#f0f0dc)',
};

export const ATLAS_DOMAINS = [
  { id:'wildfire',      label:'Wildfire & Post-Fire',       icon:'🔥' },
  { id:'waterquality',  label:'Water Quality & Freshwater', icon:'💧' },
  { id:'marine',        label:'Marine & Coastal',           icon:'🌊' },
  { id:'agriculture',   label:'Agriculture & Food',         icon:'🌾' },
  { id:'mining',        label:'Mining & Industrial',        icon:'⛏️'  },
  { id:'urban',         label:'Urban & Infrastructure',     icon:'🏙️'  },
  { id:'permafrost',    label:'Permafrost & Arctic',        icon:'🧊'  },
  { id:'tropicalforest',label:'Tropical Forest',            icon:'🌳'  },
  { id:'dryland',       label:'Dryland & Arid',             icon:'🏜️'  },
  { id:'wetland',       label:'Wetland & Peatland',         icon:'🌿'  },
  { id:'hyperspectral', label:'Hyperspectral-Enabled',      icon:'🔬'  },
  { id:'crosssensor',   label:'Cross-Sensor Fusion',        icon:'🛰️'  },
];

// Capability families are the primary public structure. Domains remain useful
// application context, while a family answers the more important question:
// "what physical condition or decision does this group of methods address?"
// Family membership is organizational metadata, not a novelty or validation claim.
export const ATLAS_CAPABILITIES = [
  { id:'fire-effects', label:'Fire Effects & Recovery', icon:'◒', description:'Burned-surface, post-rain, mineral-transition, and understory-fire research methods.' },
  { id:'fuel-moisture', label:'Fuel Moisture Context', icon:'⌁', description:'Canopy-moisture deficit features and field-calibration specifications.' },
  { id:'fire-atmosphere', label:'Smoke & Extreme Fire Behavior', icon:'≈', description:'Absorbing-aerosol context and prospective pyroconvection workflows.' },
  { id:'aquatic-blooms', label:'Aquatic Blooms & Pigments', icon:'✣', description:'Bloom, surface-scum, pigment, and functional-type observations across optical sensors.' },
  { id:'water-condition-plumes', label:'Water Condition & Plumes', icon:'≋', description:'Turbidity, color, CDOM, thermal, wastewater, mine-plume, and catchment context.' },
  { id:'riparian-flood', label:'Riparian & Floodplain Condition', icon:'⌇', description:'Dry-bank, floodplain, and wetland-agriculture edge context.' },
  { id:'floating-material', label:'Floating & Surface Material', icon:'◇', description:'Floating debris, vegetation, scum-adjacent material, and oil-weathering candidates.' },
  { id:'coastal-habitats', label:'Coastal Habitat Condition', icon:'◌', description:'Coral brightness, mangrove change, and shallow-water vegetation research methods.' },
  { id:'crop-stress', label:'Crop & Soil Stress', icon:'⋔', description:'Nutrient, dryness, compaction, and pre-harvest risk observations.' },
  { id:'agri-management', label:'Agricultural Management', icon:'⌗', description:'Cover-crop timing and irrigation water-use research workflows.' },
  { id:'mining-risk', label:'Mining Surfaces & Risk', icon:'△', description:'Mining-surface context, mineral features, residue, leach-pad, and failure-risk models.' },
  { id:'urban-surfaces', label:'Urban Surface Condition', icon:'▦', description:'Heat-vulnerability context, bare and paved surfaces, soiling, cooling, and dust.' },
  { id:'landfill-context', label:'Landfill Surface Context', icon:'◫', description:'Generic vegetation and moisture features awaiting landfill masks and field measurements.' },
  { id:'permafrost-change', label:'Permafrost & Peat Change', icon:'❄', description:'Exposed peat, pond margins, dielectric change, carbon exposure, and active-layer models.' },
  { id:'snow-algae', label:'Snow Pigment Context', icon:'✧', description:'Bright-snow red/green features for field-reviewed snow-algae studies.' },
  { id:'wetland-gas', label:'Wetland Gas Surface Context', icon:'○', description:'Open, wet, low-vegetation surface features that require methane flux measurements.' },
  { id:'wetland-hydrology', label:'Wetland Hydrology', icon:'∿', description:'Water-table calibration, tidal-zone, and peat-moisture transition methods.' },
  { id:'wetland-vegetation', label:'Wetland Vegetation Structure', icon:'♒', description:'Wetland vegetation-type and invasive-monoculture discrimination features.' },
  { id:'forest-canopy', label:'Forest Canopy Condition', icon:'♧', description:'Canopy stress, liana structure, and crown-scale research methods.' },
  { id:'forest-disturbance', label:'Forest Disturbance & Carbon', icon:'⌁', description:'Edge degradation, selective logging, and biomass/carbon calibration workflows.' },
  { id:'dryland-processes', label:'Dryland Surface Processes', icon:'⌓', description:'Biocrust, evaporite, carbonate, dust, erosion, and habitat-context methods.' },
  { id:'hyperspectral-materials', label:'Hyperspectral Materials', icon:'λ', description:'Continuum-removed mineral, fiber, carbon, and alteration-sequence specifications.' },
  { id:'atmospheric-carbon', label:'Atmospheric Methane & Carbon', icon:'↟', description:'Methane retrieval and transport-inversion research specifications.' },
  { id:'cross-sensor-systems', label:'Cross-Sensor Decision Models', icon:'⊕', description:'Deformation, water-security, soil-moisture, urban-air, and coastal-carbon models.' },
];

export const ATLAS_METHOD_ROLES = {
  primary: {
    label: 'Primary',
    description: 'The clearest current representative of this capability family; not a validation claim.',
  },
  variant: {
    label: 'Variant',
    description: 'An alternate formulation or target interpretation within the same capability family.',
  },
  component: {
    label: 'Component',
    description: 'A useful input or context feature that is weaker as a standalone decision product.',
  },
  reference: {
    label: 'Reference',
    description: 'An established sensor product or comparison layer retained for interpretation.',
  },
  'research-model': {
    label: 'Research model',
    description: 'A future retrieval, calibration, temporal, spatial, or cross-sensor workflow; not a current Atlas result.',
  },
  retired: {
    label: 'Retired',
    description: 'A legacy formula retained for traceability but removed from live scientific use.',
  },
};

const CAPABILITY_CLASSIFICATION = {
  bhdfsi: ['fire-effects', 'primary'],
  sfeii: ['fuel-moisture', 'retired'],
  lfmpi: ['fuel-moisture', 'primary'],
  pshri: ['fire-effects', 'research-model'],
  bsmti: ['fire-effects', 'research-model'],
  saci: ['fire-atmosphere', 'reference'],
  pcsii: ['fire-atmosphere', 'research-model'],

  peti: ['aquatic-blooms', 'primary'],
  csrc: ['aquatic-blooms', 'variant'],
  swri: ['water-condition-plumes', 'research-model'],
  dwci: ['water-condition-plumes', 'research-model'],
  rrfi: ['riparian-flood', 'variant'],
  epdi: ['water-condition-plumes', 'primary'],
  rdoci: ['water-condition-plumes', 'research-model'],
  ctpsti: ['aquatic-blooms', 'component'],
  dtpsi: ['water-condition-plumes', 'research-model'],
  gmcpi: ['water-condition-plumes', 'research-model'],
  fcli: ['riparian-flood', 'primary'],

  habsdi: ['aquatic-blooms', 'research-model'],
  smpdi: ['floating-material', 'primary'],
  cbsdi: ['coastal-habitats', 'primary'],
  kcdsi: ['floating-material', 'variant'],
  owsi: ['floating-material', 'variant'],
  mdspi: ['coastal-habitats', 'research-model'],
  sgdci: ['water-condition-plumes', 'research-model'],
  spei: ['coastal-habitats', 'research-model'],
  cduai: ['water-condition-plumes', 'variant'],
  mppdi: ['floating-material', 'variant'],

  npdefi: ['crop-stress', 'primary'],
  scspi: ['crop-stress', 'research-model'],
  apri: ['crop-stress', 'research-model'],
  pdsdi: ['crop-stress', 'variant'],
  cctti: ['agri-management', 'primary'],
  iwuei: ['agri-management', 'research-model'],
  wdacsi: ['riparian-flood', 'variant'],

  trsi: ['water-condition-plumes', 'research-model'],
  tdrasi: ['mining-risk', 'primary'],
  amdphi: ['mining-risk', 'retired'],
  tdsii: ['mining-risk', 'research-model'],
  reesai: ['mining-risk', 'research-model'],
  ccrbi: ['mining-risk', 'research-model'],
  hlpii: ['mining-risk', 'research-model'],
  ierpi: ['water-condition-plumes', 'research-model'],

  ecaci: ['urban-surfaces', 'primary'],
  hsai: ['urban-surfaces', 'component'],
  spsri: ['urban-surfaces', 'research-model'],
  uciei: ['urban-surfaces', 'research-model'],
  pcadi: ['urban-surfaces', 'component'],
  csdei: ['urban-surfaces', 'research-model'],
  lfgvi: ['landfill-context', 'component'],
  lrdvsi: ['landfill-context', 'component'],

  ttapi: ['permafrost-change', 'component'],
  tperi: ['permafrost-change', 'component'],
  pcei: ['permafrost-change', 'primary'],
  sabsi: ['snow-algae', 'primary'],
  fgdci: ['permafrost-change', 'research-model'],
  mepsi: ['wetland-gas', 'component'],
  alsi: ['permafrost-change', 'research-model'],

  pdcsi: ['forest-canopy', 'primary'],
  lisi: ['forest-canopy', 'variant'],
  ubcdi: ['fire-effects', 'research-model'],
  fedgi: ['forest-disturbance', 'research-model'],
  slsdi: ['forest-disturbance', 'research-model'],
  etcsi: ['forest-canopy', 'research-model'],

  bscmci: ['dryland-processes', 'research-model'],
  sbci: ['dryland-processes', 'research-model'],
  cscai: ['dryland-processes', 'research-model'],
  defpi: ['dryland-processes', 'research-model'],
  dlpehi: ['dryland-processes', 'component'],
  aibeai: ['dryland-processes', 'research-model'],

  pwtdi: ['wetland-hydrology', 'research-model'],
  mhssp: ['wetland-gas', 'component'],
  tfidi: ['wetland-hydrology', 'component'],
  wdptzi: ['wetland-hydrology', 'component'],
  ipvsi: ['wetland-vegetation', 'primary'],
  wvtdi: ['wetland-vegetation', 'variant'],

  cmsti: ['hyperspectral-materials', 'research-model'],
  mpssfi: ['atmospheric-carbon', 'research-model'],
  afcdi: ['hyperspectral-materials', 'research-model'],
  scfgosi: ['hyperspectral-materials', 'research-model'],
  reenbi: ['hyperspectral-materials', 'research-model'],
  epcase: ['hyperspectral-materials', 'research-model'],
  dpcci: ['aquatic-blooms', 'research-model'],
  pftib: ['aquatic-blooms', 'research-model'],

  tseai: ['atmospheric-carbon', 'research-model'],
  issai: ['cross-sensor-systems', 'research-model'],
  geawsi: ['cross-sensor-systems', 'research-model'],
  emsmmi: ['cross-sensor-systems', 'research-model'],
  nfcai: ['forest-disturbance', 'research-model'],
  snuvqi: ['cross-sensor-systems', 'research-model'],
  puenpi: ['cross-sensor-systems', 'research-model'],
};

const RAW_ATLAS_INDICES = [

/* ─── 1. WILDFIRE ──────────────────────────────────────────────────────── */
{
  key:'bhdfsi', acronym:'BH-DFSI', domain:'wildfire',
  name:'Burnt Hillside Debris-Flow Susceptibility Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'BurnGate × SoilGate × MoistureProxy × ChromaticSlope',
  physics:'Requires co-occurrence of severe NBR char, exposed soil (BSI), post-fire moisture, and slope chromatism. All four gates must fire.',
  benefit:'Pre-event evacuation triage for communities below burned watersheds.',
  gradient: G.fire,
  bookmark:{lat:34.44, lng:-119.63, zoom:13, date:'2018-01-24', label:'Montecito corridor — post-flow peak debris signal'},
  source: 'USGS Montecito debris-flow release (2018)',
  sourceUrl: 'https://www.usgs.gov/data/debris-flow-inundation-and-damage-data-9-january-2018-montecito-debris-flow-event',
  justification: 'Karpathy-loop hotspot target for the Montecito debris-flow corridor below the Thomas Fire burn scar. WMS loop QC selected January 24, 2018 at zoom 13 with 29.770% visible coverage and 22.485% high-signal coverage, beating the prior January 9 bookmark.',
  evalscript: genEvalscript(['B02','B04','B08','B11','B12'],`
  let nbr=(sample.B08-sample.B12)/(sample.B08+sample.B12+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let score=Math.max(0,0.15-nbr)*Math.max(0,bsi+0.1)*Math.max(0,0.35-ndvi);
  return ${cb('Math.min(1,score*12)',P.fire)};`)
},
{
  key:'sfeii', acronym:'SF-EII', domain:'wildfire',
  name:'Wildfire Fuel Hazard & Canopy Dehydration Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'[(B8A−B11)/(B8A+B11)] × [1−(B08/B12)]',
  physics:'SWIR1 absorption tracks canopy water; B12/B08 encodes cell-wall integrity. High SF-EII = critical pre-ignition canopy desiccation.',
  benefit:'Identifies specific forest patches in critical pre-ignition condition before fire season.',
  gradient: G.fuel,
  bookmark:{lat:37.77, lng:-119.57, zoom:11, date:'2021-08-01', label:'Yosemite area — pre-fire fuel mapping'},
  source: 'US Drought Monitor — California drought context',
  sourceUrl: 'https://droughtmonitor.unl.edu/',
  justification: 'Peak-signal proof target for canopy dehydration: Yosemite-area conifer and mixed woodland during the extreme 2021 California summer drought, when live canopy water stress should be spatially obvious.',
  evalscript: genEvalscript(['B08','B8A','B11','B12'],`
  let sfEii=((sample.B8A-sample.B11)/(sample.B8A+sample.B11+0.001))*(1-(sample.B08/(sample.B12+0.001)));
  return ${cb('Math.max(0,Math.min(1,sfEii*2+0.5))',P.fuel)};`)
},
{
  key:'lfmpi', acronym:'LFMPI', domain:'wildfire',
  name:'Live Fuel Moisture Pre-Ignition Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'FuelGate × WaterReject × (1 − NDMI) / 2',
  physics:'A normalized Sentinel-2 NDMI deficit is displayed only over live vegetation after water rejection. It is an uncalibrated canopy-moisture context feature, not a live-fuel-moisture retrieval.',
  benefit:'Screens vegetated areas for relatively dry canopy-moisture context; field LFMC is required for calibration.',
  gradient: G.fuel,
  bookmark:{lat:34.28, lng:-118.02, zoom:11, date:'2021-08-01', label:'Angeles NF chaparral — peak drought live-fuel risk'},
  source: 'Drought.gov California-Nevada October 2021 drought update',
  sourceUrl: 'https://www.drought.gov/drought-status-updates/drought-status-update-california-nevada-2021-10-15',
  justification: 'Peak-signal proof target for live-fuel moisture stress: fire-prone Angeles National Forest chaparral during the peak summer dry period of the historic 2021 drought. Open water and non-fuel surfaces are explicitly masked out.',
  evalscript: genEvalscript(['B03','B04','B8A','B11'],`
  let ndmi=(sample.B8A-sample.B11)/(sample.B8A+sample.B11+0.001);
  let ndviB8A=(sample.B8A-sample.B04)/(sample.B8A+sample.B04+0.001);
  let mndwi=(sample.B03-sample.B11)/(sample.B03+sample.B11+0.001);
  let waterReject=(mndwi>0.15&&ndviB8A<0.25)?0:1;
  let liveFuel=(ndviB8A>0.28&&sample.B8A>sample.B04&&sample.B11>0.04)?1:0;
  let risk=Math.max(0,Math.min(1,(1-ndmi)*0.5))*waterReject*liveFuel;
  if(risk<=0)return[0,0,0,0];
  return ${cb('risk',[
    [0,19,23,15],[0.3,142,207,128],[0.6,230,180,80],[0.85,217,134,79],[1,226,102,90]])};`)
},
{
  key:'pshri', acronym:'PSHRI', domain:'wildfire',
  name:'Post-Fire Soil Hydrophobicity Risk Index',
  platform:'S2+ERA5', platformShort:'S2+ERA5', novelty:'T1', canRender:false,
  formula:'NDWI_post_rain − NDWI_pre_rain (in ERA5-confirmed precipitation window)',
  physics:'Normal soil wets after rain → NDWI rises. Hydrophobic burned soil repels water → NDWI unchanged despite rainfall.',
  benefit:'Identifies slopes where rain will not absorb, flagging runoff and debris-flow risk.',
  gradient: G.fire,
  bookmark:{lat:39.76, lng:-121.62, zoom:12, date:'2019-01-15', label:'Paradise CA — Camp Fire burn scar'},
  evalscript: TC
},
{
  key:'bsmti', acronym:'BSMTI', domain:'wildfire',
  name:'Burn Severity Mineralogy Transition Index',
  platform:'EMIT', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'depth(535nm) / depth(486nm)',
  physics:'Goethite→magnetite→hematite transition encodes fire temperature history. Requires EMIT 5 nm spectral resolution.',
  benefit:'Maps fire temperature gradients in burn scars — links to revegetation prognosis.',
  gradient: G.fire,
  bookmark:{lat:40.0, lng:-121.4, zoom:11, date:'2021-09-15', label:'Dixie Fire scar — EMIT context'},
  evalscript: TC
},
{
  key:'saci', acronym:'SACI', domain:'wildfire',
  name:'Smoke Aerosol Composition Index',
  platform:'TROPOMI', platformShort:'TROPOMI', novelty:'T1', canRender:true, wmsLayer:'S5P-AER', minZoom:3,
  formula:'AOD_UV340 / AOD_550',
  physics:'High ratio (>1.5) = smoldering/OC-dominated smoke. Low ratio (~1.0) = flaming/BC-dominated.',
  benefit:'Distinguishes fire type for public health smoke advisories.',
  gradient: 'linear-gradient(to right,#1e120a,#7a3d12,#c8731f,#e8a02a,#f2d24a)',
  bookmark:{lat:42.38, lng:-121.12, zoom:6, date:'2021-08-11', label:'Bootleg Fire OR — dense smoke aerosol plume'},
  legend:['Clear air', 'Dense smoke'],
  source:'NOAA GML long-range smoke from Bootleg and Dixie fires',
  sourceUrl:'https://gml.noaa.gov/aero/net/bld/2021_fires.html',
  justification:'Live tile renders the TROPOMI UV Absorbing Aerosol Index (340/380 nm) — the available proxy for the full AOD-ratio composition index, which needs AOD products TROPOMI does not carry at 550 nm. Karpathy-loop WMS QC selected the August 11, 2021 Bootleg Fire smoke scene with 79.114% visible/high-signal coverage after transparent background gating.',
  evalscript: genEvalscript(['AER_AI_340_380'], `var aai=Math.max(0,Math.min(1,sample.AER_AI_340_380/3.5));if(aai<=0.08)return[0,0,0,0];return [0.55+0.45*aai, 0.45*(1-aai)+0.15, 0.12, Math.min(0.95,0.25+aai*0.75)];`)
},
{
  key:'pcsii', acronym:'PCSII', domain:'wildfire',
  name:'Pyroconvection Detection Index',
  platform:'GOES+TROPOMI', platformShort:'GOES', novelty:'T1', canRender:false,
  formula:'(BT_3.7µm − BT_11µm > 0) AND (AOD_TROPOMI > 1.0)',
  physics:'Pyrocumulus tops show reversed brightness temperature at 3.7µm + extreme AOD loading.',
  benefit:'Real-time extreme fire behavior alert — pyroconvection creates erratic spotting kilometers ahead.',
  gradient: G.fire,
  bookmark:{lat:42.0, lng:-122.0, zoom:9, date:'2020-09-10', label:'West Coast fire complex OR/CA'},
  evalscript: TC
},

/* ─── 2. WATER QUALITY ─────────────────────────────────────────────────── */
{
  key:'peti', acronym:'PETI', domain:'waterquality',
  name:'Phycocyanin Eutrophication Toxicity Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDCI × RedEdge slope × water gate × persistence',
  physics:'Phycocyanin absorbs at 620 nm between B04 (665 nm) and B05 (705 nm), creating a diagnostic red-to-red-edge slope depression over cyanobacteria mats.',
  benefit:'Public health early warning for toxic cyanobacterial blooms in drinking-water reservoirs.',
  gradient: G.algae,
  bookmark:{lat:41.66, lng:-83.19, zoom:10, date:'2019-08-01', label:'Lake Erie — western algae bloom'},
  source: 'NOAA NCCOS Lake Erie HAB 2019 retrospective',
  sourceUrl: 'https://coastalscience.noaa.gov/news/lake-erie-hab-2019-retrospective-bloom-severity-was-7-3-as-predicted-by-the-seasonal-forecast/',
  justification: 'Targets the western basin of Lake Erie during the documented 2019 Microcystis bloom season. The August 1, 2019 bookmark sits in the high-bloom summer window NOAA summarized at severity 7.3, validating the virtual phycocyanin proxy near Toledo.',
  evalscript: genEvalscript(['B03','B04','B05','B06','B11'],`
  let ndci=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let slope=(sample.B06-sample.B04)/(sample.B06+sample.B04+0.001);
  let water=sample.B03>sample.B11?1:0;
  let val=Math.max(0,ndci*slope*water*8);
  return ${cb('Math.min(1,val)',P.algae)};`)
},
{
  key:'csrc', acronym:'CSRC', domain:'waterquality',
  name:'Cyanotoxin Scum Risk Composite',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDCI × NIR_scum_boost × (1−turbidity_rejection) × persistence',
  physics:'Dense floating scum elevates NIR from cell clumping while maintaining NDCI signal. Turbidity rejection suppresses sediment false positives.',
  benefit:'Identifies specific lake zones where direct human contact risk (swimming, fishing) is highest.',
  gradient: G.algae,
  bookmark:{lat:31.22, lng:120.22, zoom:10, date:'2020-08-01', label:'Lake Taihu China — bloom peak'},
  source: 'NASA Earthdata: Cleaner Water from Space (Lake Taihu HAB monitoring)',
  sourceUrl: 'https://www.earthdata.nasa.gov/news/feature-articles/cleaner-water-from-space',
  justification: 'Targets Lake Taihu, China, during the peak summer bloom period. NASA Earthdata documents satellite monitoring of Lake Taihu cyanobacterial blooms, making this bookmark a location-matched scum-risk demonstration with sediment false-positive rejection.',
  evalscript: genEvalscript(['B03','B04','B05','B06','B08','B11'],`
  let ndci=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let scumBoost=Math.max(0,sample.B08-0.15)*3;
  let turb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let turbRej=Math.max(0,turb*5);
  let water=sample.B03>sample.B11?1:0;
  let val=Math.max(0,ndci+scumBoost)*(1-Math.min(1,turbRej))*water;
  return ${cb('Math.min(1,val*3)',P.algae)};`)
},
{
  key:'swri', acronym:'SWRI', domain:'waterquality',
  name:'Sewage-Water Release Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated proof target', novelty:'T2', canRender:false,
  formula:'turbidity_shock × organic_bloom_proxy × persistence',
  physics:'Sewage effluent combines turbidity spike (suspended solids), organic bloom signal (elevated NDCI), and distinctive green-to-blue ratio from nutrient loading.',
  benefit:'Early warning for municipal wastewater failures — actionable within hours of Sentinel-2 overpass.',
  gradient: G.water,
  bookmark:{lat:39.05, lng:-76.26, zoom:10, date:'2021-08-14', label:'Chesapeake Bay — nutrient plume'},
  source: 'NOAA Florida HAB Event Tracker (2018)',
  sourceUrl: 'https://www.climate.gov/news-features/event-tracker/harmful-algal-blooms-linger-parts-southern-florida-july-and-august-2018',
  justification: 'Context target only. Same-location date and zoom sweeps remained moderate in WMS QC, so SWRI needs a measured high-signal wastewater-release scene before live proof rendering.',
  evalscript: genEvalscript(['B03','B04','B05','B08','B11'],`
  let turbidity=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let organic=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let water=sample.B03>sample.B11?1:0;
  let val=Math.max(0,turbidity+0.05)*Math.max(0,organic+0.05)*water*30;
  return ${cb('Math.min(1,val)',P.water)};`)
},
{
  key:'dwci', acronym:'DWCI', domain:'waterquality',
  name:'Drinking Water Catchment Injury Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated proof target', novelty:'T1', canRender:false,
  formula:'turbidity_anomaly × upstream_flow_weight × persistence',
  physics:'Turbidity in upstream catchment zones propagates to water treatment intake points; early detection at source reduces treatment cost and protects public supply.',
  benefit:'Early warning for water treatment facilities — detects turbidity events before they reach intakes.',
  gradient: G.water,
  bookmark:{lat:37.87, lng:-121.63, zoom:11, date:'2021-04-15', label:'Sacramento-San Joaquin Delta CA'},
  source: 'California Water Boards Camp Fire Report (2018)',
  sourceUrl: 'https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/CampFire.html',
  justification: 'Context target only. Replacement-candidate WMS QC found the best tested DWCI scene remained weak, so this is not presented as a proof-grade live detection bookmark until a measured high-signal catchment injury scene is documented.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let turbidity=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let water=sample.B11<sample.B03?1:0;
  let val=Math.max(0,turbidity*3)*water*(1-Math.max(0,ndvi));
  return ${cb('Math.min(1,val)',P.silt)};`)
},
{
  key:'rrfi', acronym:'RRFI', domain:'waterquality',
  name:'Riparian Refuge Failure Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDVI_riparian_loss × NDWI_channel_decline × BSI_bank_exposure',
  physics:'Riparian buffer loss (NDVI decline along streambanks) combined with reduced channel moisture and bank soil exposure signals ecosystem collapse under drought or land clearance.',
  benefit:'Maps stream reaches losing their ecological buffer — prioritizes restoration funding.',
  gradient: G.forest,
  bookmark:{lat:35.69, lng:-105.95, zoom:11, date:'2021-05-18', label:'Rio Grande riparian corridor NM'},
  source: 'USGS Upper Rio Grande streamflow and climate response study',
  sourceUrl: 'https://pubs.usgs.gov/publication/sir20215138',
  justification: 'Targets the Rio Grande riparian corridor in New Mexico during a severe drought. WMS QC date sweep selected May 18, 2021, as a strong proof target with 2.183% high-signal coverage.',
  evalscript: genEvalscript(['B02','B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let loss=Math.max(0,0.3-ndvi);
  let dry=Math.max(0,-ndwi);
  let bare=Math.max(0,bsi);
  return ${cb('Math.min(1,loss*dry*bare*40)',P.forest)};`)
},
{
  key:'epdi', acronym:'EPDI', domain:'waterquality',
  name:'Erosion Pulse Delivery Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'BSI_upslope_change × turbidity_downstream × persistence',
  physics:'Upslope bare soil (BSI) combined with downstream turbidity spike (B04/B03 anomaly) identifies an active erosion-to-channel delivery linkage.',
  benefit:'Identifies which hillslopes are actively delivering sediment to streams — targets remediation.',
  gradient: G.silt,
  bookmark:{lat:36.90, lng:-121.75, zoom:11, date:'2023-03-17', label:'Pajaro River CA — levee-breach sediment pulse'},
  source: 'California DWR Pajaro River levee break response (2023)',
  sourceUrl: 'https://water.ca.gov/News/Blog/2023/Mar-23/DWR-Supports-Flood-Fight-Efforts-at-Pajaro-River-Levee-Break',
  justification: 'Targets the Pajaro River floodplain one week after the March 2023 levee breach, aligning the erosion-delivery bookmark with a site-specific flood-fight and sediment-response source.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let bareGate=sample.B11>0.2&&sample.B04>sample.B08?1:0;
  let turb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let water=sample.B11<sample.B03?1:0;
  let val=Math.max(0,bareGate*0.5+turb*water*3);
  return ${cb('Math.min(1,val)',P.silt)};`)
},
{
  key:'rdoci', acronym:'RDOCI', domain:'waterquality',
  name:'River Dissolved Organic Carbon Index',
  platform:'PACE OCI', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'ln(ρ_320nm / ρ_412nm) / (412−320) × −1',
  physics:'CDOM spectral slope coefficient S275-295 from PACE UV channels approximates DOC concentration. PACE OCI 320 nm band makes this computable from orbit for first time.',
  benefit:'Global river DOC flux monitoring — a poorly constrained, critical carbon cycle variable.',
  gradient: G.water,
  bookmark:{lat:-0.5, lng:-49.5, zoom:9, date:'2021-03-15', label:'Amazon River plume — DOC export'},
  evalscript: TC
},
{
  key:'ctpsti', acronym:'CTPSTI', domain:'waterquality',
  name:'Cyanobacterial Toxin Proxy Spectral Index',
  platform:'PACE / DESIS', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'[ρ(560nm) − ρ(620nm)] / [ρ(560nm) + ρ(620nm)]',
  physics:'Toxic Microcystis is phycocyanin-dominant (620 nm). Non-toxic Aphanizomenon has phycoerythrin at 565 nm. Ratio encodes species composition correlated with toxin-producer abundance.',
  benefit:'Transforms HAB monitoring from bloom presence/absence to species-specific toxin risk.',
  gradient: G.algae,
  bookmark:{lat:50.18, lng:-98.0, zoom:10, date:'2021-08-15', label:'Lake Winnipeg — blue-green bloom'},
  evalscript: TC
},
{
  key:'dtpsi', acronym:'DTPSI', domain:'waterquality',
  name:'Dam Thermal Plume Stratification Index',
  platform:'Landsat TIRS', platformShort:'TIRS', novelty:'T1', canRender:false,
  formula:'(LST_downstream_1km − LST_reservoir) / (LST_upstream − LST_reservoir)',
  physics:'<0 = cold hypolimnetic release; >0 = warm surface release. Thermal stratification controls dissolved oxygen and fish habitat quality downstream.',
  benefit:'Dam operations optimization for cold-water fisheries and downstream aquatic habitat.',
  gradient: G.water,
  bookmark:{lat:37.07, lng:-111.31, zoom:11, date:'2021-07-15', label:'Lake Powell — thermal stratification'},
  evalscript: TC
},
{
  key:'gmcpi', acronym:'GMCPI', domain:'waterquality',
  name:'Glacial Meltwater Chemistry Proxy Index',
  platform:'Sentinel-2 + PACE', platformShort:'PACE/CDOM model', novelty:'T1', canRender:false,
  formula:'CDOM ratio × turbidity proxy in glacier outflow plumes',
  physics:'Meltwater carries distinct glacial flour turbidity (B04/B03 ratio) and low CDOM (high B03/B04 vs. downstream). Combines visible turbidity with spectral signature of rock flour.',
  benefit:'Tracks glacial meltwater contribution to freshwater chemistry — crucial for downstream communities.',
  gradient: G.water,
  bookmark:{lat:60.47, lng:-149.83, zoom:11, date:'2021-08-01', label:'Kenai Fjords AK — glacial outflow'},
  source: 'USGS / NPS Glacier Monitoring Program',
  sourceUrl: 'https://www.nps.gov/kefj/index.htm',
  justification: 'Context target only. Public Sentinel-2 WMS candidate testing returned blank GMCPI overlays; proof-grade chemistry detection requires the PACE/CDOM component rather than the current Sentinel-2 proxy.',
  evalscript: genEvalscript(['B02','B03','B04','B08','B11'],`
  let turb=(sample.B04-sample.B02)/(sample.B04+sample.B02+0.001);
  let cdom=sample.B03/(sample.B04+0.001);
  let water=sample.B11<sample.B03?1:0;
  let val=Math.max(0,turb*2)*Math.max(0,cdom-0.8)*water;
  return ${cb('Math.min(1,val*4)',P.silt)};`)
},
{
  key:'fcli', acronym:'FCLI', domain:'waterquality',
  name:'Floodplain Contamination Legacy Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'SWIR2_anomaly × (1−NDVI_next_season)',
  physics:'Metal-contaminated flood sediments alter SWIR2 reflectance; phytotoxic suppression of next-season vegetation confirms legacy impact on inundated floodplains.',
  benefit:'Environmental justice triage for communities farming floodplains after industrial spills.',
  gradient: G.mine,
  bookmark:{lat:29.77, lng:-95.64, zoom:12, date:'2018-10-15', label:'Houston Addicks Reservoir TX — post-Harvey'},
  source: 'EPA Harvey Response / USGS Sediment Studies',
  sourceUrl: 'https://www.epa.gov/archive/epa/newsreleases/status-water-systems-areas-affected-harvey.html',
  justification: 'Targets Addicks Reservoir in Houston, TX, which was heavily inundated during Hurricane Harvey in late 2017. The October 2018 date tracks the legacy soil and vegetation stress responses one year after the flood sediments settled.',
  evalscript: genEvalscript(['B04','B08','B11','B12'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let swir2Anom=Math.max(0,sample.B12-0.18);
  let val=swir2Anom*Math.max(0,0.4-ndvi)*8;
  return ${cb('Math.min(1,val)',P.mine)};`)
},

/* ─── 3. MARINE & COASTAL ──────────────────────────────────────────────── */
{
  key:'habsdi', acronym:'HABSDI', domain:'marine',
  name:'HAB Species-Level Discrimination Index',
  platform:'PACE / DESIS', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'PC_index − FX_index (cyano) | FX_index − PC_index (diatom)',
  physics:'Cyanobacteria → phycocyanin (620 nm). Diatoms → fucoxanthin (510–540 nm). PACE OCI 5 nm bands resolve both pigment packages simultaneously.',
  benefit:'Transforms HAB monitoring from presence/absence to toxin-risk species assessment.',
  gradient: G.marine,
  bookmark:{lat:38.3, lng:-76.4, zoom:10, date:'2021-07-15', label:'Chesapeake Bay — HAB context'},
  evalscript: TC
},
{
  key:'smpdi', acronym:'SMPDI', domain:'marine',
  name:'Sargassum vs. Microplastic Discrimination Index',
  platform:'Sentinel-2 + EMIT', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'WaterGate × LandReject × [FAI − ((B8A−B11)/(B8A+B11))]',
  physics:'Sargassum has active photosynthesis — strong 680 nm chlorophyll absorption. Microplastics have suppressed NIR and no chlorophyll. A water-context gate and SWIR land rejection prevent terrestrial vegetation and bright island edges from being treated as floating material.',
  benefit:'Separates two critically different ocean pollution types — enabling targeted cleanup strategies.',
  gradient: G.marine,
  bookmark:{lat:18.0, lng:-65.0, zoom:12, date:'2022-07-02', label:'Caribbean — water-gated Sargassum belt'},
  source: 'USF Sargassum Watch System Caribbean bulletins',
  sourceUrl: 'https://optics.marine.usf.edu/projects/saws.html',
  justification: 'Targets the Caribbean Sea south of Puerto Rico during the 2022 Sargassum season. After adding water-context and land-rejection gates, WMS QC selected July 2, 2022, at zoom 12 as a strong water-only proof target with 2.396% high-signal coverage.',
  evalscript: genEvalscript(['B03','B04','B08','B8A','B11','B12'],`
  let fai=sample.B08-(sample.B04+(sample.B12-sample.B04)*((833-665)/(2190-665)));
  let swirNdvi=(sample.B8A-sample.B11)/(sample.B8A+sample.B11+0.001);
  let mndwi=(sample.B03-sample.B11)/(sample.B03+sample.B11+0.001);
  let waterContext=(mndwi>0.05||sample.B11<0.06)?1:0;
  let landReject=(sample.B11>0.12&&mndwi<0.0)?0:1;
  let smpdi=fai-swirNdvi;
  let val=Math.max(0,Math.min(1,smpdi*20+0.3))*waterContext*landReject;
  if(val<=0)return[0,0,0,0];
  return ${cb('val',P.algae)};`)
},
{
  key:'cbsdi', acronym:'CBSDI', domain:'marine',
  name:'Coral Bleaching Stage Discrimination Index',
  platform:'Sentinel-2 + PRISMA', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'Stage1=(B3−B4)/(B3+B4) | Stage2=B2/(B3+B4+B1) | Stage3=(B3/B4)−(B2/B4)',
  physics:'Pale corals (stage 1): green-to-red ratio. Fully bleached (stage 2): blue dominance. Algae-colonized dead (stage 3): green/red differential. Each stage maps to a distinct spectral signature.',
  benefit:'Monitors bleaching extent and stage at 10 m — actionable for marine park management within days.',
  gradient: G.marine,
  bookmark:{lat:-18.29, lng:147.70, zoom:11, date:'2020-03-15', label:'Great Barrier Reef — bleaching event'},
  source: 'Mongabay report on the 2020 Great Barrier Reef bleaching event',
  sourceUrl: 'https://news.mongabay.com/2020/04/great-barrier-reef-suffers-biggest-bleaching-event-yet/',
  justification: 'Targets the central Great Barrier Reef during the severe mass bleaching event of March 2020, triggered by prolonged elevated sea surface temperatures.',
  evalscript: genEvalscript(['B02','B03','B04'],`
  let stage1=(sample.B03-sample.B04)/(sample.B03+sample.B04+0.001);
  let bleached=stage1<0.05&&sample.B02>0.06?1:0;
  let val=bleached*(0.5+sample.B02*3);
  return ${cb('Math.min(1,val)',P.water)};`)
},
{
  key:'kcdsi', acronym:'KCDSI', domain:'marine',
  name:'Kelp Canopy Density and Stress Index',
  platform:'Sentinel-2 + S3', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDVI_kelp × (1−NDWI) in kelp-depth water',
  physics:'Surface kelp canopy elevates NIR while suppressing SWIR; stressed or dying kelp shows declining NDVI at same water depth. Shallow coastal bathymetry gate isolates kelp zone.',
  benefit:'Monitors kelp forest extent and health — foundation of nearshore marine food webs.',
  gradient: G.marine,
  bookmark:{lat:36.89, lng:-121.87, zoom:10, date:'2021-12-30', label:'Monterey Bay CA — kelp canopy'},
  legend: ['Sparse', 'Dense kelp'],
  source: 'Monterey Bay National Marine Sanctuary Kelp Studies',
  sourceUrl: 'https://montereybay.noaa.gov/',
  justification: 'Targets the kelp forest canopy along the Monterey Peninsula. WMS QC date/zoom sweep selected December 30, 2021, at zoom 10 as a strong proof target with 2.863% high-signal coverage.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let waterVeg=(sample.B11<0.04&&sample.B03<0.16)?1:0;
  let val=Math.max(0,ndvi)*waterVeg;
  if(val<0.04)return[0,0,0,0];
  return ${cb('Math.min(1,val*3)',P.algae)};`)
},
{
  key:'owsi', acronym:'OWSI', domain:'marine',
  name:'Oil Spill Weathering Stage Index',
  platform:'EMIT + Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDOI × (B11/B12) weathering ratio',
  physics:'Fresh crude: high SWIR absorption. Weathered oil: oxidized surface changes B11/B12 ratio. Combining NDOI with SWIR slope tracks oil age from fresh (days) to emulsified (weeks).',
  benefit:'Real-time spill response prioritization — fresh vs. weathered oil requires different cleanup methods.',
  gradient: G.marine,
  bookmark:{lat:28.7, lng:-88.4, zoom:11, date:'2016-05-15', label:'Gulf of Mexico — oil slick weathering context'},
  source: 'NOAA Deepwater Horizon oil spill case study',
  sourceUrl: 'https://response.restoration.noaa.gov/deepwater-horizon-oil-spill-case-study',
  justification: 'Targets the area near the Deepwater Horizon site in the Gulf of Mexico. The bookmark is a persistent oil-slick weathering context target, now tied to NOAA ORR Deepwater Horizon documentation instead of a generic ORR landing page.',
  evalscript: genEvalscript(['B02','B03','B11','B12'],`
  let ndoi=(sample.B02-sample.B12)/(sample.B02+sample.B12+0.001);
  let weather=sample.B11/(sample.B12+0.001);
  let val=Math.max(0,ndoi)*Math.max(0,weather-0.8)*2;
  return ${cb('Math.min(1,val)',P.mine)};`)
},
{
  key:'mdspi', acronym:'MDSPI', domain:'marine',
  name:'Mangrove Dieback Spatial Pattern Index',
  platform:'Sentinel-2 + S1; proof target pending', platformShort:'validated proof target', novelty:'T1', canRender:false,
  formula:'NDVI_loss in mangrove zone × BSI_increase',
  physics:'Mangrove dieback creates characteristic spatial NDVI loss patterns (canopy collapse) combined with exposed substrate (elevated BSI) — distinguishing it from seasonal leaf drop.',
  benefit:'Alerts coastal managers to accelerating mangrove dieback — protecting storm surge buffers.',
  gradient: G.forest,
  bookmark:{lat:21.98, lng:89.18, zoom:11, date:'2021-12-01', label:'Sundarbans — mangrove dieback monitoring'},
  source: 'Sundarbans Forestry Department / UNESCO',
  sourceUrl: 'https://whc.unesco.org/en/list/798/',
  justification: 'Context target only. Candidate WMS QC found Everglades post-Irma was only moderate and the current Sundarbans bookmark was weak, so live proof awaits a measured high-signal dieback scene or multi-date/S1 support.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let dieback=Math.max(0,0.5-ndvi)*Math.max(0,bsi+0.05);
  return ${cb('Math.min(1,dieback*6)',P.forest)};`)
},
{
  key:'sgdci', acronym:'SGDCI', domain:'marine',
  name:'Submarine Groundwater Discharge Chemistry Index',
  platform:'PACE + ECOSTRESS', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'(ρ_412 / ρ_550) − CDOM_regional_mean within thermal anomaly mask',
  physics:'SGD creates localized CDOM-depleted (low UV/blue absorption) zones combined with thermal anomalies at seafloor seep points. Requires PACE UV channels.',
  benefit:'Maps submarine freshwater discharge — a cryptic but critical coastal nutrient source.',
  gradient: G.marine,
  bookmark:{lat:21.0, lng:-87.5, zoom:10, date:'2021-08-01', label:'Yucatan coast — SGD context'},
  evalscript: TC
},
{
  key:'spei', acronym:'SPEI', domain:'marine',
  name:'Seagrass Photosynthetic Efficiency Index',
  platform:'Sentinel-2 + DESIS', platformShort:'DESIS/depth model', novelty:'T2', canRender:false,
  formula:'Water-depth corrected NDVI in shallow coastal bathymetry window',
  physics:'Seagrass has distinct NIR-red reflectance ratio in clear shallow water. Depth correction using Lyzenga water column model reduces false positives from benthic sediment.',
  benefit:'Monitors critical blue-carbon seagrass meadows — CO₂ sequestration baseline for coastal carbon accounting.',
  gradient: G.marine,
  bookmark:{lat:43.52, lng:16.45, zoom:11, date:'2021-08-01', label:'Adriatic coast — seagrass meadow'},
  source: 'Lyzenga (1978) / Adriatic Seagrass Monitoring',
  sourceUrl: 'https://doi.org/10.1016/0034-4257(78)90029-7',
  justification: 'Context target only. Candidate WMS QC showed weak high-signal coverage; proof-grade seagrass efficiency detection requires bathymetric/depth correction and DESIS-class spectral support.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let shallow=sample.B03<0.10&&sample.B11<0.02?1:0;
  let val=Math.max(0,ndvi-0.1)*shallow;
  return ${cb('Math.min(1,val*5)',P.algae)};`)
},
{
  key:'cduai', acronym:'CD-UAI', domain:'marine',
  name:'Coastal Dredging & Marine Siltation Plume Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'turbidity_ratio × green_red_plume × (1−cloud_mask)',
  physics:'Dredging creates characteristic turbid plumes with elevated B04/B03 ratio in marine water, distinguishable from riverine sediment by spatial pattern and B11 absorption.',
  benefit:'Marine permit compliance monitoring — detects unauthorized dredge discharge into protected zones.',
  gradient: G.silt,
  bookmark:{lat:22.37, lng:113.69, zoom:10, date:'2021-04-01', label:'Pearl River estuary — silt plume'},
  source: 'Scientific Reports study on anthropogenic change in Pearl River Estuary sediment dynamics',
  sourceUrl: 'https://www.nature.com/articles/s41598-021-96183-0',
  justification: 'Targets the Pearl River Estuary near Hong Kong on April 1, 2021, validating coastal dredging and heavy suspended marine sediment plume dynamics.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let turb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let water=sample.B11<sample.B04?1:0;
  let val=Math.max(0,turb+0.05)*water*6;
  return ${cb('Math.min(1,val)',P.silt)};`)
},
{
  key:'mppdi', acronym:'MP-PDI', domain:'marine',
  name:'Marine Plastisphere & Polymer Differentiation Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'FDI_base × (1−Sargassum) × (1−vegetation) × (1−foam) × (1−turbidity)',
  physics:'Microplastics (PE/PP) show C-H stretch overtones at 1730 nm, suppressed NIR, and no chlorophyll. FAI/SWIR1 combination removes Sargassum and foam false positives.',
  benefit:'Maps marine plastic accumulation zones — guides ocean cleanup operations.',
  gradient: G.marine,
  bookmark:{lat:7.0, lng:79.55, zoom:10, date:'2021-06-02', label:'Sri Lanka west coast — X-Press Pearl plastic pellet spill'},
  source: 'UNEP X-Press Pearl maritime disaster report',
  sourceUrl: 'https://www.unep.org/resources/report/x-press-pearl-maritime-disaster-sri-lanka-report-un-environmental-advisory-mission',
  justification: 'Targets the Sri Lanka west coast immediately after the 2021 X-Press Pearl disaster, aligning the floating-plastic bookmark with UNEP and marine-debris documentation for the pellet spill.',
  evalscript: genEvalscript(['B03','B04','B08','B8A','B11','B12'],`
  let fai=sample.B08-(sample.B04+(sample.B12-sample.B04)*0.13);
  let notVeg=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001)<0.2?1:0;
  let notTurb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001)<0.15?1:0;
  let val=Math.max(0,fai)*notVeg*notTurb*10;
  return ${cb('Math.min(1,val)',P.water)};`)
},

/* ─── 4. AGRICULTURE ───────────────────────────────────────────────────── */
{
  key:'npdefi', acronym:'NPDefI', domain:'agriculture',
  name:'Nitrogen vs. Phosphorus Deficiency Discrimination Index',
  platform:'Sentinel-2 + EnMAP', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'[(B04−B05)/(B04+B05)] − [(B12−B11)/(B12+B11)]',
  physics:'N deficiency → chlorophyll degradation → red-edge shift (B05/B04 signal). P deficiency → anthocyanin → SWIR2 (B12). Subtraction yields a signed nutrient discriminator.',
  benefit:'Precision nutrient prescription from orbit — reduces fertilizer over-application and nutrient runoff.',
  gradient: G.forest,
  bookmark:{lat:41.59, lng:-93.62, zoom:11, date:'2021-07-01', label:'Iowa cornfields — nutrient mapping'},
  source: 'Iowa State nutrient deficiencies guide',
  sourceUrl: 'https://www.agronext.iastate.edu/soilfertility/nutrientdeficiencies.html',
  justification: 'Targets the agricultural heartland near Des Moines, Iowa. July 1, 2021, captures the corn canopy at rapid vegetative growth phase when nitrogen/phosphorus deficiency is most pronounced.',
  evalscript: genEvalscript(['B04','B05','B08','B11','B12'],`
  let nSig=(sample.B04-sample.B05)/(sample.B04+sample.B05+0.001);
  let pSig=(sample.B12-sample.B11)/(sample.B12+sample.B11+0.001);
  let npdefi=nSig-pSig;
  let veg=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001)>0.2?1:0;
  return ${cb('Math.max(0,Math.min(1,(npdefi+0.5)*1.0))*veg',P.forest)};`)
},
{
  key:'scspi', acronym:'SCSPI', domain:'agriculture',
  name:'Soil Compaction Spectral Proxy Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated proof target', novelty:'T1', canRender:false,
  formula:'[1−(B11/B12)] × (B03/B02)',
  physics:'Compacted soils show distinctive SWIR ratio from reduced porosity and altered surface crust mineralogy. Applied during bare-field windows when vegetation is absent.',
  benefit:'Identifies compaction zones in farm fields — guides subsoiling operations to restore yield.',
  gradient: G.dry,
  bookmark:{lat:38.67, lng:-98.33, zoom:11, date:'2021-04-15', label:'Kansas — bare wheat fields post-harvest'},
  source: 'Kansas State Agricultural Extension Soil Studies',
  sourceUrl: 'https://www.ksre.k-state.edu/',
  justification: 'Context target only. Candidate WMS QC over Kansas, California Central Valley, and Texas High Plains bare-field scenes remained weak, so this needs field-calibrated proof before live rendering is presented as detection.',
  evalscript: genEvalscript(['B02','B03','B04','B08','B11','B12'],`
  let bare=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001)<0.1;
  let scspi=(1-(sample.B11/(sample.B12+0.001)))*(sample.B03/(sample.B02+0.001));
  return ${cb('Math.max(0,Math.min(1,scspi*2))',P.dry)};`)
},
{
  key:'apri', acronym:'APRI', domain:'agriculture',
  name:'Aflatoxin Pre-Harvest Risk Index',
  platform:'ECOSTRESS + S2 + ERA5', platformShort:'ECOSTRESS', novelty:'T1', canRender:false,
  formula:'(LST_anomaly/σ) × [1−NDWI] × heat_accumulation_days',
  physics:'Aspergillus infection risk peaks when heat stress + moisture deficit + heat accumulation coincide during flowering-to-grain-fill. LST anomaly from ECOSTRESS required.',
  benefit:'Pre-harvest aflatoxin risk maps at field scale — estimated 25% reduction could prevent millions of cancer cases globally.',
  gradient: G.fuel,
  bookmark:{lat:12.0, lng:2.0, zoom:9, date:'2021-04-01', label:'West Africa — maize growing region'},
  evalscript: TC
},
{
  key:'pdsdi', acronym:'PDSDI', domain:'agriculture',
  name:'Pesticide vs. Drought Stress Discrimination Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDVI_texture_cv / NDRE (simplified: BSI_spatial_var × NDRE)',
  physics:'Pesticide stress creates patchy necrosis (high spatial variance NDVI). Drought stress creates uniform decline. Red-edge stress index normalizes the difference.',
  benefit:'Distinguishes application errors from climate stress — prevents unnecessary re-spraying.',
  gradient: G.forest,
  bookmark:{lat:40.72, lng:-90.22, zoom:11, date:'2022-07-15', label:'Illinois — crop stress season'},
  source: 'University of Illinois Crop Sciences Research',
  sourceUrl: 'https://cropsciences.illinois.edu/',
  justification: 'Targets farming plots in western Illinois during July 2022, capturing crop stress differentiation during active pesticide application and dry mid-summer weather.',
  evalscript: genEvalscript(['B04','B05','B08','B11'],`
  let ndre=(sample.B08-sample.B05)/(sample.B08+sample.B05+0.001);
  let stress=Math.max(0,0.6-ndre);
  let arid=sample.B11/(sample.B08+0.001);
  let val=stress*Math.max(0,arid-0.5);
  return ${cb('Math.min(1,val*4)',P.forest)};`)
},
{
  key:'cctti', acronym:'CCTTI', domain:'agriculture',
  name:'Cover Crop Termination Timing Index',
  platform:'Sentinel-2 time series', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDVI_cover_green × (1−soil_tillage_signal)',
  physics:'Cover crops maintain distinctive NDVI signature before termination; rapid NDVI drop + BSI increase marks termination event. Timing optimizes nitrogen fixation vs. cash crop planting window.',
  benefit:'Precision timing recommendations for cover crop termination — maximizes nitrogen credit to cash crops.',
  gradient: G.forest,
  bookmark:{lat:40.63, lng:-89.59, zoom:11, date:'2022-04-01', label:'Illinois — spring cover crop green-up'},
  source: 'Illinois Department of Agriculture I-COVER program',
  sourceUrl: 'https://agr.illinois.gov/resources/landwater/i-cover.html',
  justification: 'Targets central Illinois fields during spring green-up (April 1, 2022), catching the critical transition window when cover crops are terminated prior to cash crop sowing.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let coverGreen=Math.max(0,ndvi-0.25)*(1-Math.max(0,bsi));
  return ${cb('Math.min(1,coverGreen*4)',P.forest)};`)
},
{
  key:'iwuei', acronym:'IWUEI', domain:'agriculture',
  name:'Irrigation Water Use Efficiency Index',
  platform:'ECOSTRESS + S1', platformShort:'ECOSTRESS', novelty:'T2', canRender:false,
  formula:'ET_ecostress / (precipitation_ERA5 + irrigation_proxy_S1)',
  physics:'High ET relative to precipitation confirms active irrigation; SAR soil moisture change detects recent wetting events. Ratio encodes how efficiently applied water converts to crop ET.',
  benefit:'Identifies fields wasting irrigation water — direct targets for smart irrigation system installation.',
  gradient: G.wetland,
  bookmark:{lat:36.72, lng:-120.05, zoom:11, date:'2021-07-01', label:'Central Valley CA — irrigation'},
  evalscript: TC
},
{
  key:'wdacsi', acronym:'WDA-CSI', domain:'agriculture',
  name:'Wetland Encroachment & Agricultural Intrusion Composite',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'nitrogen_chlorophyll_spike × peat_drainage_signal × NDWI_loss',
  physics:'Agricultural intrusion into wetlands creates a signature of nitrogen-driven chlorophyll spike at the edge, drainage-induced NDWI decline, and peat organic soil exposure.',
  benefit:'Maps the active agricultural-wetland boundary for conservation enforcement and wetland banking.',
  gradient: G.wetland,
  bookmark:{lat:25.84, lng:-80.66, zoom:10, date:'2021-12-01', label:'Florida Everglades — agricultural edge'},
  source: 'Everglades Foundation on Everglades Agricultural Area peat subsidence',
  sourceUrl: 'https://www.evergladesfoundation.org/post/everglades-restoration-water-and-climate-change',
  justification: 'Targets the Florida Everglades boundary on December 1, 2021, to map agricultural encroachment and peatland drainage edge collapse dynamics.',
  evalscript: genEvalscript(['B03','B04','B05','B08','B11'],`
  let ndci=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let peat=sample.B11>0.1&&sample.B04>0.08?1:0;
  let val=Math.max(0,ndci)*Math.max(0,-ndwi)*peat*10;
  return ${cb('Math.min(1,val)',P.wetland)};`)
},

/* ─── 5. MINING & INDUSTRIAL ───────────────────────────────────────────── */
{
  key:'trsi', acronym:'TRSI', domain:'mining',
  name:'Tailings River Shock Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated tailings target', novelty:'T2', canRender:false,
  formula:'turbidity_jump × ferric_color_shift × mine_proximity × persistence',
  physics:'Tailings releases create ferric iron turbidity plumes (red-orange discoloration in B04/B03 ratio) combined with extreme turbidity — a signature distinct from natural sediment loads.',
  benefit:'Real-time tailings spill detection downstream of active mines — enables emergency response within days.',
  gradient: G.mine,
  bookmark:{lat:-20.20, lng:-43.47, zoom:9, date:'2015-11-15', label:'Samarco / Rio Doce runout'},
  source: 'UNEP Samarco disaster profile (2015)',
  sourceUrl: 'https://www.unep.org/news-and-stories/story/brazil-mine-disaster',
  justification: 'Context target only. The Samarco/Rio Doce candidate is visually present but fell just below the strict 512px proof-grade high-signal threshold after date, zoom, and local coordinate checks; keep as context until a stronger measured tailings plume target is documented.',
  evalscript: genEvalscript(['B02','B03','B04','B08','B11'],`
  let turb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let iron=(sample.B04-sample.B02)/(sample.B04+sample.B02+0.001);
  let water=sample.B11<sample.B04?1:0;
  let val=Math.max(0,turb+0.05)*Math.max(0,iron)*water*15;
  return ${cb('Math.min(1,val)',P.mine)};`)
},
{
  key:'tdrasi', acronym:'TDR-ASI', domain:'mining',
  name:'Tailings Dam Runout & Acid Silt Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'jarosite_signal × sulfate_absorption × mine_proximity_weight',
  physics:'Jarosite (yellow iron sulfate) has a distinctive B04/B03 ratio above background. Sulfate-rich silt downstream of failed tailings dams shows combined iron oxide and SWIR sulfate signature.',
  benefit:'Forensic mapping of tailings runout extent — guides remediation boundary and community health response.',
  gradient: G.mine,
  bookmark:{lat:-10.69, lng:-76.26, zoom:11, date:'2021-08-01', label:'Cerro de Pasco Peru — mining tailings'},
  source: 'NASA Earth Observatory: Mining Peru\'s Cerro de Pasco',
  sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/mining-perus-cerro-de-pasco-144481/',
  justification: 'Targets active tailings impoundments in Cerro de Pasco, Peru, on August 1, 2021, with the citation now tied to the same mining district and tailings landscape.',
  evalscript: genEvalscript(['B02','B03','B04','B11','B12'],`
  let jarosite=(sample.B04-sample.B02)/(sample.B04+sample.B02+0.001);
  let sulfate=sample.B11/(sample.B12+0.001);
  let val=Math.max(0,jarosite-0.05)*Math.max(0,sulfate-1.0)*3;
  return ${cb('Math.min(1,val)',P.mine)};`)
},
{
  key:'amdphi', acronym:'AMDPHI', domain:'mining',
  name:'Acid Mine Drainage pH Proxy Index',
  platform:'Sentinel-2 + EMIT', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'[(B04−B03)/(B04+B03)] / [(B02−B03)/(B02+B03+0.001)]',
  physics:'AMD iron mineral precipitates are pH-diagnostic: jarosite (pH 2–3.5) vs. schwertmannite (pH 3–4.5) vs. goethite (pH 4.5–6). Ratio encodes iron mineral assemblage → pH range.',
  benefit:'Continental-scale AMD triage without field sampling — prioritizes site remediation by pH severity.',
  gradient: G.mine,
  bookmark:{lat:40.66, lng:-122.53, zoom:12, date:'2021-09-01', label:'Iron Mountain Mine CA — acid drainage'},
  source: 'USGS Iron Mountain environmental effects profile',
  sourceUrl: 'https://ca.water.usgs.gov/projects/iron_mountain/environment.html',
  justification: 'Targets the Iron Mountain Mine superfund site in California, world-renowned for extremely acidic mine waters. September 1, 2021, captures dry-season precipitates (jarosite/goethite) along the outflow.',
  evalscript: genEvalscript(['B02','B03','B04'],`
  let num=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let den=(sample.B02-sample.B03)/(sample.B02+sample.B03+0.001);
  let amdphi=num/(Math.abs(den)+0.001);
  let val=Math.max(0,Math.min(1,(amdphi-1)*0.5));
  return ${cb('val',P.mine)};`)
},
{
  key:'tdsii', acronym:'TDSII', domain:'mining',
  name:'Tailings Dam Structural Integrity Index',
  platform:'S2 + S1 InSAR', platformShort:'InSAR', novelty:'T1', canRender:false,
  formula:'w1×NDWI_anomaly + w2×(−InSAR_subsidence) + w3×NDVI_decline',
  physics:'Three precursors: downstream seepage (NDWI), structural settling (InSAR), vegetation stress from leachate (NDVI decline). InSAR processing not possible via WMS.',
  benefit:'Life-safety monitoring for all 14,000+ operational tailings dams globally.',
  gradient: G.mine,
  bookmark:{lat:52.67, lng:-121.65, zoom:12, date:'2021-08-01', label:'Mount Polley BC — tailings dam context'},
  evalscript: TC
},
{
  key:'reesai', acronym:'REESAI', domain:'mining',
  name:'Rare Earth Element Surface Anomaly Index',
  platform:'EnMAP + EMIT', platformShort:'EnMAP', novelty:'T1', canRender:false,
  formula:'1−ρ(803nm)/[ρ(780nm)+interpolated_continuum]',
  physics:'Nd³⁺ f-f transition absorption at 803 nm in REE carbonate/phosphate minerals. Requires EnMAP 5–10 nm spectral resolution to resolve the 803 nm feature.',
  benefit:'Transforms REE exploration from field-campaign to satellite-first screening.',
  gradient: G.mine,
  bookmark:{lat:41.77, lng:110.01, zoom:10, date:'2021-08-01', label:'Bayan Obo Inner Mongolia — REE deposit'},
  evalscript: TC
},
{
  key:'ccrbi', acronym:'CCRBI', domain:'mining',
  name:'Coal Combustion Residue Bioaccumulation Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated proof target', novelty:'T1', canRender:false,
  formula:'[(B04−B08)/(B04+B08)] × [B03/(B11+0.01)]',
  physics:'Grass over CCR impoundments accumulates As/Se causing anthocyanin stress response (elevated red). Harkness et al. 2025: "grass is a tattletale" — phytotoxic stress reveals buried coal ash.',
  benefit:'Maps CCR impoundment footprints and leachate migration without drilling.',
  gradient: G.mine,
  bookmark:{lat:35.79, lng:-87.55, zoom:12, date:'2021-09-01', label:'Tennessee coal ash site — vegetation stress'},
  source: 'TVA Kingston Fossil Plant Recovery / EPA Reports',
  sourceUrl: 'https://www.epa.gov/tn/kingston-coal-ash-spill',
  justification: 'Context target only. Kingston and Sutton replacement candidates remained weak in WMS QC, so CCRBI requires a stronger documented CCR vegetation-stress target before live proof rendering.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let anthocyanin=(sample.B04-sample.B08)/(sample.B04+sample.B08+0.001);
  let green=sample.B03/(sample.B11+0.01);
  let veg=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001)>0.1?1:0;
  let val=Math.max(0,anthocyanin+0.2)*Math.max(0,green-1.0)*veg;
  return ${cb('Math.min(1,val*4)',P.mine)};`)
},
{
  key:'hlpii', acronym:'HLPII', domain:'mining',
  name:'Heap Leach Pad Integrity Index',
  platform:'S2 + EMIT', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'SWIR2_anomaly in liner failure zone + EMIT mineral alteration downslope',
  physics:'Liner failure causes SWIR2 elevation from leachate-altered soil mineralogy. EMIT resolves the specific alteration mineral suite. S2 alone lacks the spectral resolution.',
  benefit:'Monitors cyanide/acid leachate containment integrity at 1,000+ active heap leach operations.',
  gradient: G.mine,
  bookmark:{lat:40.80, lng:-117.04, zoom:11, date:'2021-09-01', label:'Nevada gold mining — heap leach context'},
  evalscript: TC
},
{
  key:'ierpi', acronym:'IERPI', domain:'mining',
  name:'Industrial Effluent River Plume Index',
  platform:'Landsat-family/Sentinel-2 context', platformShort:'validated effluent target', novelty:'T2', canRender:false,
  formula:'turbidity × iron_color_shift × channel_mask',
  physics:'Industrial discharge creates turbidity and iron/chemical color shifts in river channels. Landsat captures with S2 spatial logic; S2 approximation works with same band equivalents.',
  benefit:'Documents illegal industrial discharge events — enables enforcement action with satellite evidence.',
  gradient: G.mine,
  bookmark:{lat:37.27, lng:-107.88, zoom:11, date:'2015-09-01', label:'Animas River CO — Gold King Mine spill'},
  source: 'EPA Gold King Mine Response Action',
  sourceUrl: 'https://www.epa.gov/goldkingmine',
  justification: 'Context target only. Gold King and acid-river candidate tests were blank or weak in public Sentinel-2 WMS, so proof-grade effluent plume rendering needs a measured high-signal scene or Landsat-family processing path.',
  evalscript: genEvalscript(['B02','B03','B04','B11'],`
  let turb=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let iron=(sample.B04-sample.B02)/(sample.B04+sample.B02+0.001);
  let channel=sample.B11<sample.B03?1:0;
  let val=Math.max(0,turb)*Math.max(0,iron)*channel*15;
  return ${cb('Math.min(1,val)',P.mine)};`)
},

/* ─── 6. URBAN & INFRASTRUCTURE ────────────────────────────────────────── */
{
  key:'ecaci', acronym:'EC-ACI', domain:'urban',
  name:'Evapotranspirative Canopy & Asphalt Contrast Index',
  platform:'Sentinel-2 + ECOSTRESS', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'(1−NDVI) × low_moisture_proxy',
  physics:'Urban heat islands form where high-albedo vegetation is replaced by low-albedo asphalt. S2 NDVI loss combined with MSI moisture stress proxies urban heat island formation without thermal data.',
  benefit:'Maps urban heat island intensity at neighborhood scale — guides heat-resilience infrastructure investment.',
  gradient: G.urban,
  bookmark:{lat:33.45, lng:-112.07, zoom:11, date:'2021-07-20', label:'Phoenix AZ metro — urban heat island'},
  source: 'WMO July 2019 hottest-month analysis',
  sourceUrl: 'https://wmo.int/media/july-matched-and-maybe-broke-record-hottest-month-analysis-began',
  justification: 'Targets the Phoenix, AZ, metro area during the extreme summer 2021 heat window, contrasting low-canopy/dry-surface context with vegetated areas. See FORMULA_V2_OVERRIDES.ecaci for the corrected bookmark date (2021-07-05, replacing 2021-07-20 after a no-data gap was found in the original WMS render) and the honest physics/benefit text — this base field is not read by atlas-app.js but is kept accurate for anyone reading source.',
  evalscript: genEvalscript(['B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let msi=sample.B11/(sample.B08+0.001);
  let val=Math.max(0,0.4-ndvi)*Math.max(0,msi-0.8)*3;
  return ${cb('Math.min(1,val)',P.urban)};`)
},
{
  key:'hsai', acronym:'HSAI', domain:'urban',
  name:'Heat-Shelter Absence Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'low NDVI + high BSI + urban mask',
  physics:'Absence of tree canopy in residential areas creates heat exposure vulnerability. Low NDVI + high bare soil index flags neighborhoods with insufficient shade cover.',
  benefit:'Identifies heat-vulnerable neighborhoods lacking cooling canopy — targets tree-planting programs.',
  gradient: G.urban,
  bookmark:{lat:29.76, lng:-95.37, zoom:11, date:'2021-08-01', label:'Houston TX — urban heat vulnerability'},
  source: 'NASA VEDA Urban Heating dashboard',
  sourceUrl: 'https://www.earthdata.nasa.gov/dashboard/data-catalog/urban-heating',
  justification: 'Targets Houston, TX, on August 1, 2021, mapping neighborhoods with high bare soil/asphalt and low tree canopy cover under a source that explicitly supports urban heating analysis.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let shelter=Math.max(0,0.3-ndvi)*Math.max(0,bsi+0.05);
  return ${cb('Math.min(1,shelter*6)',P.urban)};`)
},
{
  key:'spsri', acronym:'SPSRI', domain:'urban',
  name:'Solar Panel Soiling Remote Index',
  platform:'Sentinel-2 + Planet', platformShort:'Planet/PV baseline', novelty:'T1', canRender:false,
  formula:'(ρ_B02 − baseline_B02) / baseline_B02 × (B11/B12)',
  physics:'Clean PV panels have very low reflectance (~5%). Dust-coated panels show elevated reflectance. B11/B12 ratio encodes dust mineral type (silica vs. carbonate).',
  benefit:'Optimizes cleaning crew deployment — global PV soiling loss exceeds $5B/year.',
  gradient: G.urban,
  bookmark:{lat:30.96, lng:2.48, zoom:11, date:'2021-09-01', label:'Saharan solar farm Algeria'},
  source: 'NREL Solar Soiling Mitigation Studies',
  sourceUrl: 'https://www.nrel.gov/pv/soiling.html',
  justification: 'Context target only. Utility-scale PV candidates remained weak in Sentinel-2 WMS QC; proof-grade soiling detection needs a panel baseline and finer-resolution Planet-class support.',
  evalscript: genEvalscript(['B02','B03','B11','B12'],`
  let pv=sample.B02<0.12&&sample.B03<0.12?1:0;
  let soiling=sample.B02*10;
  let dust=sample.B11/(sample.B12+0.001);
  let val=pv*Math.max(0,soiling-0.3)*Math.max(0,dust-0.8);
  return ${cb('Math.min(1,val)',P.urban)};`)
},
{
  key:'uciei', acronym:'UCIEI', domain:'urban',
  name:'Urban Cool Infrastructure Effectiveness Index',
  platform:'S2 + ECOSTRESS', platformShort:'ECOSTRESS', novelty:'T1', canRender:false,
  formula:'(1−albedo_satellite) × LST_anomaly',
  physics:'High UCIEI = hot dark surface (old asphalt). Low UCIEI = effective cool infrastructure. Green roofs have low UCIEI despite low albedo because they convert absorbed energy to ET.',
  benefit:'Parcel-level scorecard for cool infrastructure programs — enables evidence-based urban policy.',
  gradient: G.urban,
  bookmark:{lat:41.88, lng:-87.62, zoom:12, date:'2021-08-15', label:'Chicago IL — green roof district'},
  evalscript: TC
},
{
  key:'pcadi', acronym:'PCADI', domain:'urban',
  name:'Pavement Condition and Albedo Decay Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'(ρ_B02 − baseline_B02) / baseline_B02 within road mask',
  physics:'Pavement darkens as asphalt oxidizes and aggregate becomes embedded. Lower B02 reflectance compared to fresh pavement baseline encodes road age/condition.',
  benefit:'City-scale pavement management without expensive ground surveys.',
  gradient: G.urban,
  bookmark:{lat:42.33, lng:-83.04, zoom:12, date:'2021-08-02', label:'Detroit MI — road infrastructure'},
  source: 'SEMCOG 2021 pavement condition dataset',
  sourceUrl: 'https://hub.arcgis.com/maps/SEMCOG%3A%3Apavement-condition-2021',
  justification: 'Targets Detroit\'s highway system. WMS QC selected August 2, 2021, as the stronger same-location pavement/albedo-decay proof scene.',
  evalscript: genEvalscript(['B02','B03','B04','B08'],`
  let dark=sample.B02<0.15&&sample.B03<0.15&&sample.B04<0.15?1:0;
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let road=dark&&ndvi<0.05?1:0;
  let albedo=(sample.B02+sample.B03+sample.B04)/3;
  return ${cb('road*(1-albedo*8)',[[0,0,0,0],[0.3,60,60,90],[0.7,120,120,180],[1,200,200,255]])};`)
},
{
  key:'csdei', acronym:'CSDEI', domain:'urban',
  name:'Construction Site Silica Dust Emission Index',
  platform:'TROPOMI + GIS', platformShort:'TROPOMI', novelty:'T1', canRender:false,
  formula:'AOD_anomaly × construction_site_proximity × wind_vector',
  physics:'Silica dust from active construction sites creates AOD anomalies traceable with wind-direction analysis. Requires TROPOMI aerosol optical depth, not available as S2 WMS.',
  benefit:'Identifies silica exposure hot zones for occupational health enforcement near construction sites.',
  gradient: G.urban,
  bookmark:{lat:25.17, lng:55.27, zoom:10, date:'2021-08-01', label:'Dubai — construction dust context'},
  evalscript: TC
},
{
  key:'lfgvi', acronym:'LFGVI', domain:'urban',
  name:'Landfill Gas Vegetation Intrusion Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'red_edge_stress × moisture_loss × chlorosis × ring_pattern_score',
  physics:'LFG creates a characteristic annular NDVI depression around landfill boundaries — geometrically distinctive and not mimicked by natural stress. Red-edge chlorosis confirms gas toxicity.',
  benefit:'Maps LFG migration extent — identifies properties with buried methane fire/explosion hazard.',
  gradient: G.urban,
  bookmark:{lat:40.57, lng:-74.17, zoom:13, date:'2021-08-01', label:'Fresh Kills Landfill Staten Island NY'},
  source: 'Freshkills Park landfill gas collection and processing',
  sourceUrl: 'https://freshkillspark.org/landfill-engineering/collection-and-processing',
  justification: 'Targets Fresh Kills Landfill on Staten Island on August 1, 2021, tracking peripheral soil moisture loss and vegetation chlorosis around a site with documented landfill-gas collection infrastructure.',
  evalscript: genEvalscript(['B04','B05','B08','B8A','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let redEdge=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let ndmi=(sample.B8A-sample.B11)/(sample.B8A+sample.B11+0.001);
  let stress=Math.max(0,0.5-ndvi)*Math.max(0,0.2-redEdge)*Math.max(0,0.3-ndmi);
  return ${cb('Math.min(1,stress*20)',P.urban)};`)
},
{
  key:'lrdvsi', acronym:'LRD-VSI', domain:'urban',
  name:'Landfill Leachate & Runoff Degradation Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDVI_stress × NDWI_anomaly × downslope_channel_context',
  physics:'Leachate migrates downslope creating phytotoxic stress (NDVI decline) combined with anomalous water signal (NDWI) in areas without natural surface water.',
  benefit:'Environmental justice screening — detects leachate impacts on communities downstream of landfills.',
  gradient: G.urban,
  bookmark:{lat:40.73, lng:-73.94, zoom:13, date:'2021-07-15', label:'Newtown Creek NY — urban waterway'},
  source: 'NOAA Newtown Creek hazardous-waste profile',
  sourceUrl: 'https://darrp.noaa.gov/hazardous-waste/newtown-creek',
  justification: 'Targets Newtown Creek, NY, on July 15, 2021, detecting runoff and degradation indicators in a highly urbanized waterway with EPA Superfund documentation.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let stress=Math.max(0,0.4-ndvi)*Math.max(0,ndwi+0.2);
  return ${cb('Math.min(1,stress*5)',P.urban)};`)
},

/* ─── 7. PERMAFROST & ARCTIC ───────────────────────────────────────────── */
{
  key:'ttapi', acronym:'TT-API', domain:'permafrost',
  name:'Thermokarst Thaw & Anoxic Peat Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'PeatExposure × WetAnoxic × EdgeCollapse',
  physics:'Dark anoxic peat (high SWIR2, depressed NIR), saturated zone (mid-NDWI), edge collapse (abrupt NDVI step at slump margins). All three gates isolate active thermokarst expansion.',
  benefit:'Maps thermokarst across circumpolar permafrost where >1,000 Gt carbon is at risk.',
  gradient: G.perm,
  bookmark:{lat:62.0, lng:68.0, zoom:13, date:'2021-09-30', label:'West Siberia — thermokarst lakes'},
  source: 'High carbon emissions from thermokarst lakes of Western Siberia',
  sourceUrl: 'https://www.nature.com/articles/s41467-019-09592-1',
  justification: 'Targets West Siberia thermokarst terrain. WMS QC zoom-framing selected zoom 13 as a strong proof target with 2.325% high-signal coverage, now anchored to a Western Siberia thermokarst-lake carbon study.',
  evalscript: genEvalscript(['B03','B04','B08','B11','B12'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let peat=sample.B12>0.1&&sample.B08<0.2?1:0;
  let score=Math.max(0,0.3-ndvi)*Math.max(0,ndwi+0.3)*peat;
  return ${cb('Math.min(1,score*8)',P.perm)};`)
},
{
  key:'tperi', acronym:'TPERI', domain:'permafrost',
  name:'Thermokarst Pond Expansion Rate Index',
  platform:'Sentinel-2 bi-temporal', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'Δ(B11_t1−B11_t2) / Δ(B03_t1−B03_t2) — active expansion proxy',
  physics:'Active thermokarst expansion creates transitional wet margins — detected as NDWI increase combined with SWIR2 change. Single-date approximation: wet peat edge anomaly.',
  benefit:'Provides the rate signal needed for carbon flux modeling — "how fast is this pond growing."',
  gradient: G.perm,
  bookmark:{lat:68.4, lng:-134.9, zoom:11, date:'2021-08-15', label:'Mackenzie Delta Canada — thermokarst'},
  source: 'Natural Resources Canada Mackenzie Valley permafrost monitoring publication',
  sourceUrl: 'https://ostrnrcan-dostrncan.canada.ca/entities/publication/322833e9-a6fa-41bc-8b67-de66b1b39940',
  justification: 'Targets permafrost slumps and thaw lakes in the Mackenzie Delta, Canada. Mid-August represents peak seasonal thaw before freeze-up begins.',
  evalscript: genEvalscript(['B03','B08','B11','B12'],`
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let peatEdge=sample.B12>0.08&&ndwi>-0.2&&ndwi<0.4?1:0;
  return ${cb('peatEdge*Math.max(0,ndwi+0.2)*3',P.perm)};`)
},
{
  key:'pcei', acronym:'PCEI', domain:'permafrost',
  name:'Peat Carbon Exposure Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'(1−NDVI) × high_SWIR2 × (1−NDWI)',
  physics:'Exposed dark peat (thawed, not waterlogged) has distinctive spectral signature: low NIR (low NDVI), elevated SWIR2 from organic matter, and low surface moisture (low NDWI).',
  benefit:'Satellite proxy for peat carbon vulnerability — identifies zones at highest risk of rapid oxidation.',
  gradient: G.perm,
  bookmark:{lat:55.0, lng:-84.0, zoom:11, date:'2021-09-01', label:'Hudson Bay lowlands — peat exposure'},
  source: 'WCS Canada Hudson Bay Lowland peatland synthesis',
  sourceUrl: 'https://wcscanada.org/about/our-programs/forests-peatlands-and-climate-change/synthesis-of-peatland-knowledge-in-the-hudson-bay-lowland/',
  justification: 'Targets the massive peatland complex of the Hudson Bay Lowlands. September 1, 2021, represents a late-summer dry period exposing peat margins to air-driven oxidation.',
  evalscript: genEvalscript(['B03','B04','B08','B12'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let peat=sample.B12>0.08?1:0;
  let val=Math.max(0,0.5-ndvi)*Math.max(0,-ndwi)*peat;
  return ${cb('Math.min(1,val*6)',P.perm)};`)
},
{
  key:'sabsi', acronym:'SABSI', domain:'permafrost',
  name:'Snow/Ice Algae Bloom Severity Index',
  platform:'Sentinel-2 + Planet', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDSI_snow × algae_pigment_proxy (red-green shift on snow)',
  physics:'Snow algae (Chlamydomonas nivalis) creates "watermelon snow" — red pigmentation reduces snow B03 reflectance relative to B04, creating a distinctive spectral signature on otherwise bright snow.',
  benefit:'Maps snow algae proliferation accelerating melt — a climate feedback amplifier in Arctic regions.',
  gradient: G.perm,
  bookmark:{lat:67.0, lng:-45.0, zoom:11, date:'2021-08-01', label:'Greenland ice sheet — algae bloom'},
  source: 'Greenland Ice Sheet Algae Project / Nature',
  sourceUrl: 'https://www.nature.com/articles/s41561-020-0582-5',
  justification: 'Targets the western dark zone of the Greenland Ice Sheet. The August 1, 2021, date captures peak snow algae colonization that darkens the ice and increases melt rates.',
  evalscript: genEvalscript(['B02','B03','B04'],`
  let snow=sample.B02>0.4&&sample.B03>0.4?1:0;
  let algae=(sample.B04-sample.B03)/(sample.B04+sample.B03+0.001);
  let val=snow*Math.max(0,algae+0.05)*10;
  return ${cb('Math.min(1,val)',[[0,17,16,24],[0.3,240,80,80],[0.7,200,30,30],[1,140,0,0]])};`)
},
{
  key:'fgdci', acronym:'FGDCI', domain:'permafrost',
  name:'Frozen Ground Dielectric Change Index',
  platform:'Sentinel-1 SAR proof target pending', platformShort:'S1 · pending', novelty:'T1', canRender:false, wmsLayer:'SENTINEL1-GRD', minZoom:6,
  formula:'(VV_dB − VH_dB) − seasonal_mean(VV_dB − VH_dB)',
  physics:'Frozen soil dielectric ~4; thawed ~20–30. 3–6 dB shifts in C-band VV. VV-VH difference normalizes vegetation; anomaly from seasonal mean isolates freeze/thaw transition.',
  benefit:'Pan-Arctic freeze/thaw monitoring — tracks permafrost active layer dynamics from Sentinel-1 global coverage.',
  gradient: G.perm,
  bookmark:{lat:65.0, lng:80.0, zoom:10, date:'2021-10-01', label:'West Siberia — freeze/thaw transition'},
  legend:['Thawed (wet)', 'Frozen (dry)'],
  source:'C-band SAR freeze/thaw detection (Sentinel-1) — see ESA S1 user guide',
  sourceUrl:'https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar',
  justification:'Hotspot-loop QC found the single-scene VV−VH proxy too spatially uniform to serve as proof-grade evidence for a freeze/thaw anomaly. Keep this concept as proof-target pending until a true temporal seasonal-mean anomaly or a non-uniform documented freeze/thaw scene is implemented.',
  evalscript: genEvalscript(['VV','VH'], `var vv=10*Math.log(Math.max(sample.VV,1e-4))/Math.LN10;var vh=10*Math.log(Math.max(sample.VH,1e-4))/Math.LN10;var fzd=vv-vh;var fz=Math.max(0,Math.min(1,(fzd-2)/12));var edge=Math.max(0,1-Math.abs(fz-0.55)*2);if(edge<0.12)return[0,0,0,0];return ${cb('edge', P.perm)};`)
},
{
  key:'mepsi', acronym:'MEPSI', domain:'permafrost',
  name:'CH₄ Ebullition Pond Spectral Proxy',
  platform:'Sentinel-2 + Planet', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'high_NDWI × low_NDVI × low_macrophyte_index',
  physics:'Active ebullition ponds are open sediment-covered shallow water: high NDWI (water), low NDVI (no aquatic vegetation), and low chlorophyll index (bare water surface).',
  benefit:'Maps active methane-ebullition ponds — the largest unmonitored non-CO₂ greenhouse gas source in Arctic.',
  gradient: G.perm,
  bookmark:{lat:62.5, lng:76.0, zoom:10, date:'2021-08-15', label:'West Siberian Plain — methane pond'},
  source: 'High carbon emissions from thermokarst lakes of Western Siberia',
  sourceUrl: 'https://www.nature.com/articles/s41467-019-09592-1',
  justification: 'Targets the thermokarst-dense West Siberian Plain in mid-August 2021, isolating open sediment-laden ponds in the same Western Siberian lake region documented for high carbon and methane emissions.',
  evalscript: genEvalscript(['B03','B04','B05','B08','B11'],`
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndci=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let pond=ndwi>0.1&&ndvi<0.15&&ndci<0.05?1:0;
  return ${cb('pond*Math.max(0,ndwi)*3',P.perm)};`)
},
{
  key:'alsi', acronym:'ALSI', domain:'permafrost',
  name:'Active Layer Depth Thermal-Spectral Composite',
  platform:'ECOSTRESS + Sentinel-2', platformShort:'ECOSTRESS', novelty:'T1', canRender:false,
  formula:'0.6×(LST_anomaly/σ) + 0.4×[(B12−B11)/(B12+B11)]',
  physics:'Deeper active layers → warmer surface temperatures (ECOSTRESS LST) + greater clay mineral exposure from frost churning (SWIR B12/B11 ratio). Requires ECOSTRESS thermal.',
  benefit:'Satellite proxy for active layer depth — orders of magnitude denser than field probe networks.',
  gradient: G.perm,
  bookmark:{lat:69.5, lng:-148.0, zoom:10, date:'2021-08-01', label:'Alaska North Slope — active layer'},
  evalscript: TC
},

/* ─── 8. TROPICAL FOREST ───────────────────────────────────────────────── */
{
  key:'pdcsi', acronym:'PDCSI', domain:'tropicalforest',
  name:'Pre-Deforestation Canopy Stress Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'[(B06−B05)/(B06+B05)] − [(B8A−B08)/(B8A+B08)]',
  physics:'Early-stage canopy thinning shifts the red-edge toward 705 nm (B05 dominance over B06) — detectable 6–18 months before clear-cutting by selective logging or burning.',
  benefit:'Provides a 6–18 month warning before deforestation becomes visible — enables preventive enforcement.',
  gradient: G.forest,
  bookmark:{lat:-4.0, lng:-55.0, zoom:11, date:'2021-05-18', label:'Amazon deforestation front — Pará Brazil'},
  source: 'INPE TerraBrasilis PRODES and DETER data platform',
  sourceUrl: 'https://terrabrasilis.dpi.inpe.br/en/home-page/',
  justification: 'Targets the active agricultural deforestation frontier in Pará State, Brazil. WMS QC date sweep selected May 18, 2021, as a strong proof target with 14.309% high-signal coverage.',
  evalscript: genEvalscript(['B05','B06','B08','B8A'],`
  let pdcsi=((sample.B06-sample.B05)/(sample.B06+sample.B05+0.001))-((sample.B8A-sample.B08)/(sample.B8A+sample.B08+0.001));
  let val=Math.max(0,-pdcsi+0.1)*4;
  return ${cb('Math.min(1,val)',P.forest)};`)
},
{
  key:'lisi', acronym:'LISI', domain:'tropicalforest',
  name:'Liana Infestation Structural Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'2.5×[(B08−B11)/(B08+6B04−7.5B02+1)] × (B08/B11)',
  physics:'Lianas have higher SWIR1 absorption than tree canopies due to different leaf water content and structure. EVI-like combination × SWIR ratio discriminates vine-dominated from tree canopy.',
  benefit:'Maps liana infestation extent — lianas suppress forest carbon storage by 20–30%.',
  gradient: G.forest,
  bookmark:{lat:1.0, lng:113.0, zoom:11, date:'2021-08-01', label:'Borneo — liana-infested forest'},
  source: 'PMC review on remote sensing for liana infestation detection',
  sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12035525/',
  justification: 'Targets degraded secondary tropical forests in Central Kalimantan, Borneo, where lianas have choked the tree canopy following historic commercial selective logging.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let denom=sample.B08+sample.B11+6*sample.B04-7.5*sample.B02+1;
  let lisi=2.5*((sample.B08-sample.B11)/(denom+0.001))*(sample.B08/(sample.B11+0.001));
  return ${cb('Math.max(0,Math.min(1,lisi*0.5))',P.forest)};`)
},
{
  key:'ubcdi', acronym:'UBCDI', domain:'tropicalforest',
  name:'Understory vs. Canopy Burn Discrimination Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated burn target', novelty:'T1', canRender:false,
  formula:'NBR × SWIR2_elevation proxy (single-date)',
  physics:'Canopy burns cause NIR collapse (no green canopy). Understory fires leave canopy mostly intact but alter SWIR2. Single-date: low NBR + elevated SWIR2 indicates understory fire.',
  benefit:'Distinguishes fire type for tropical forest carbon accounting and recovery prognosis.',
  gradient: G.forest,
  bookmark:{lat:-9.0, lng:-52.0, zoom:11, date:'2021-09-01', label:'Amazon fire scar — Mato Grosso'},
  source: 'NASA Fire Information for Resource Management System (FIRMS)',
  sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
  justification: 'Context target only. Same-location date and zoom sweeps remained moderate or weak in WMS QC, so UBCDI needs a stronger measured understory/canopy burn target before live proof rendering.',
  evalscript: genEvalscript(['B04','B08','B11','B12'],`
  let nbr=(sample.B08-sample.B12)/(sample.B08+sample.B12+0.001);
  let swirElev=sample.B12-sample.B11;
  let canopyBurn=nbr<-0.1?1:0;
  let understory=nbr>-0.1&&nbr<0.1&&swirElev>0.03?1:0;
  return ${cb('canopyBurn*0.3+understory*0.8',[[0,0,0,0],[0.3,230,180,80],[0.6,217,134,79],[1,226,102,90]])};`)
},
{
  key:'fedgi', acronym:'FEDGI', domain:'tropicalforest',
  name:'Forest Edge Degradation Gradient Index',
  platform:'Sentinel-2 context; proof target pending', platformShort:'validated proof target', novelty:'T1', canRender:false,
  formula:'NDVI gradient magnitude from interior toward edge',
  physics:'Edge-effect degradation creates a systematic NDVI gradient from forest interior toward the clearcut boundary — the gradient magnitude encodes how severe and how far edge effects penetrate.',
  benefit:'Quantifies edge-effect fragmentation — estimates effective forest area accounting for border degradation.',
  gradient: G.forest,
  bookmark:{lat:-13.0, lng:-56.0, zoom:11, date:'2021-09-01', label:'Mato Grosso edge — forest fragmentation'},
  source: 'Hansen et al. Global Forest Change',
  sourceUrl: 'https://glads.umd.edu/dataset/global-forest-change',
  justification: 'Context target only. Rondonia and Mato Grosso candidate tests showed broad low-intensity context but no high-signal proof coverage, so a calibrated edge-gradient target is required before live detection claims.',
  evalscript: genEvalscript(['B04','B08'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let edgeStress=Math.max(0,0.7-ndvi)*Math.max(0,ndvi-0.3);
  return ${cb('Math.min(1,edgeStress*8)',P.forest)};`)
},
{
  key:'slsdi', acronym:'SLSDI', domain:'tropicalforest',
  name:'Selective Logging Scar Detection Index',
  platform:'Sentinel-2 + Planet', platformShort:'Planet/logging model', novelty:'T2', canRender:false,
  formula:'BSI_gap × NDVI_gap × canopy_context',
  physics:'Selective logging creates small-scale (<1 ha) gap openings within intact canopy — elevated BSI and reduced NDVI in a high-NDVI surrounding matrix signals logging scars.',
  benefit:'Monitors illegal selective logging in concessions — actionable for forest governance enforcement.',
  gradient: G.forest,
  bookmark:{lat:-5.0, lng:144.0, zoom:11, date:'2021-09-15', label:'Papua New Guinea — logging concession'},
  source: 'PNG Forest Authority Concession Audits',
  sourceUrl: 'http://www.forestry.gov.pg/',
  justification: 'Context target only. Candidate WMS QC reached only moderate signal at the Amazon logging frontier and weak signal elsewhere; sub-hectare selective logging proof requires Planet-class spatial support or a stronger measured Sentinel target.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let gap=ndvi<0.5&&bsi>0.0?1:0;
  return ${cb('gap*Math.max(0,bsi)*Math.max(0,0.6-ndvi)*6',P.forest)};`)
},
{
  key:'etcsi', acronym:'ETCSI', domain:'tropicalforest',
  name:'Emergent Tree Crown Stress Index',
  platform:'Planet + Sentinel-2', platformShort:'Planet', novelty:'T1', canRender:false,
  formula:'Per-crown red-edge stress from Planet 3 m delineation + S2 spectral',
  physics:'Individual emergent tree crown delineation requires Planet 3 m resolution; red-edge stress per delineated crown uses S2 spectral information. Requires Planet sensor, not available via SH WMS.',
  benefit:'Monitors individual emergent tree health — sentinels for whole-forest stress propagation.',
  gradient: G.forest,
  bookmark:{lat:9.15, lng:-79.85, zoom:12, date:'2021-08-01', label:'Barro Colorado Island Panama'},
  evalscript: TC
},

/* ─── 9. DRYLAND & ARID ────────────────────────────────────────────────── */
{
  key:'bscmci', acronym:'BSCMCI', domain:'dryland',
  name:'Biological Soil Crust Multi-Condition Index',
  platform:'PRISMA / DESIS', platformShort:'PRISMA', novelty:'T1', canRender:false,
  formula:'[(ρ680−ρ720)/(ρ680+ρ720)] × [(ρ550/ρ670)−1]',
  physics:'BSC development stages have distinctive pigment signatures: cyanobacteria (680 nm), green algae (550 nm), lichen (usnic acid). Requires sub-10 nm spectral resolution from PRISMA or DESIS.',
  benefit:'Maps biological soil crust condition — BSCs stabilize desert soils and prevent dust emission.',
  gradient: G.dry,
  bookmark:{lat:37.5, lng:-110.5, zoom:11, date:'2021-08-01', label:'Colorado Plateau — BSC context'},
  evalscript: TC
},
{
  key:'sbci', acronym:'SBCI', domain:'dryland',
  name:'Sabkha Brine Chemistry Index',
  platform:'EMIT', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'depth(2217nm) / depth(2175nm)',
  physics:'Gypsum at 2217 nm; anhydrite at 2175 nm. Anhydrite forms at higher brine concentration — ratio encodes brine concentration history. Requires EMIT 5 nm bands.',
  benefit:'Maps sabkha brine chemistry — tracks paleo-hydrological conditions in hyperarid environments.',
  gradient: G.dry,
  bookmark:{lat:23.0, lng:52.0, zoom:10, date:'2021-10-01', label:'Empty Quarter Saudi Arabia — sabkha'},
  evalscript: TC
},
{
  key:'cscai', acronym:'CSCAI', domain:'dryland',
  name:'Caliche Surface Carbonate Accumulation Index',
  platform:'EnMAP', platformShort:'EnMAP', novelty:'T1', canRender:false,
  formula:'depth(2335nm) / depth(2160nm)',
  physics:'Calcite CO₃²⁻ absorption at 2335 nm vs. weaker feature at 2160 nm. Ratio encodes carbonate accumulation grade (Stage I–VI caliche). Requires EnMAP 10 nm resolution.',
  benefit:'Maps caliche distribution — critical for water infiltration modeling in arid agriculture.',
  gradient: G.dry,
  bookmark:{lat:29.0, lng:-104.0, zoom:11, date:'2021-08-01', label:'Chihuahuan Desert — caliche surface'},
  evalscript: TC
},
{
  key:'defpi', acronym:'DEFPI', domain:'dryland',
  name:'Dust Emission Flux Proxy Index',
  platform:'EMIT + S2 + SMAP', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'mineral_erodibility(EMIT) × BSI(S2) × (1−soil_moisture(SMAP))',
  physics:'Three factors control dust emission: mineral erodibility (EMIT), bare soil fraction (BSI), and dry surface (SMAP inverted). Multi-sensor fusion required for accurate emission flux.',
  benefit:'Improves global dust emission inventories — critical for aerosol climate modeling.',
  gradient: G.dry,
  bookmark:{lat:15.0, lng:0.0, zoom:9, date:'2021-01-01', label:'Sahel — dust emission season'},
  evalscript: TC
},
{
  key:'dlpehi', acronym:'DLPEHI', domain:'dryland',
  name:'Desert Locust Pre-Emergence Habitat Index',
  platform:'Sentinel-2 + GPM', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDWI × (0.1<NDVI<0.3) × (NDTI>−0.2) — without rainfall gate',
  physics:'Oviposition habitat requires moist sandy soil + sparse vegetation + sandy loam texture. S2 approximation without rainfall gate; GPM data adds rainfall confirmation in operational use.',
  benefit:'2–4 week earlier warning of locust outbreak habitat — enables preventive treatment before swarm formation.',
  gradient: G.dry,
  bookmark:{lat:9.0, lng:42.0, zoom:10, date:'2020-02-01', label:'East Africa — 2020 locust outbreak region'},
  source: 'FAO desert locust crisis response page',
  sourceUrl: 'https://www.fao.org/emergencies/where-we-work/desert-locust-crisis/',
  justification: 'Targets the dry rangelands of eastern Ethiopia. The February 2020 date captures the critical green-up and soil moisture conditions that triggered the historic East African locust swarms.',
  evalscript: genEvalscript(['B02','B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let sparse=ndvi>0.05&&ndvi<0.35?1:0;
  let moist=ndwi>-0.3&&ndwi<0.1?1:0;
  let val=sparse*moist*Math.max(0,bsi+0.1)*5;
  return ${cb('Math.min(1,val)',P.dry)};`)
},
{
  key:'aibeai', acronym:'AIBEAI', domain:'dryland',
  name:'Arroyo Incision and Bank Erosion Activity Index',
  platform:'Sentinel-2 + Planet', platformShort:'Planet/erosion target', novelty:'T1', canRender:false,
  formula:'BSI_channel_bottom / NDVI_channel_margin',
  physics:'Active incision exposes fresh bright mineral soils (high BSI). Stable channels have established bank vegetation (positive NDVI at margins). Ratio encodes incision vs. stability state.',
  benefit:'Maps actively eroding arroyos — guides erosion control investment and predicts downstream sediment loads.',
  gradient: G.dry,
  bookmark:{lat:33.35, lng:-107.25, zoom:12, date:'2021-07-02', label:'New Mexico — arroyo incision'},
  source: 'USGS Arroyo Restoration / Bureau of Land Management',
  sourceUrl: 'https://www.blm.gov/new-mexico',
  justification: 'Context target only. Same-location date and zoom sweeps remained moderate or weak in WMS QC, so AIBEAI needs a stronger measured arroyo-incision target before live proof rendering.',
  evalscript: genEvalscript(['B02','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let bsi=((sample.B11+sample.B04)-(sample.B08+sample.B02))/((sample.B11+sample.B04)+(sample.B08+sample.B02)+0.001);
  let channel=sample.B11<0.15&&sample.B04>0.08?1:0;
  let val=channel*Math.max(0,bsi)*Math.max(0,-ndvi+0.2)*10;
  return ${cb('Math.min(1,val)',P.dry)};`)
},

/* ─── 10. WETLAND & PEATLAND ───────────────────────────────────────────── */
{
  key:'pwtdi', acronym:'PWTDI', domain:'wetland',
  name:'Peatland Water Table Depth Index',
  platform:'Sentinel-2 + S1', platformShort:'S1/S2 peat model', novelty:'T2', canRender:false,
  formula:'0.65×NDWI_1020 + 0.35×(VV−VH SAR) — S2-only proxy',
  physics:'Surface Sphagnum moss shows a distinctive 970 nm water absorption feature (B8A/B09 proxy). High NDWI + dark SWIR = shallow water table. SAR fusion improves accuracy; S2 alone is approximate.',
  benefit:'Global peatland water table monitoring — the most important unmeasured variable in wetland carbon accounting.',
  gradient: G.wetland,
  bookmark:{lat:53.55, lng:23.08, zoom:11, date:'2021-05-01', label:'Biebrza Marshes Poland — peatland WTD'},
  source: 'Biebrza National Park Research / Copernicus EMS',
  sourceUrl: 'https://www.biebrza.org.pl/',
  justification: 'Context target only. Same-location date and zoom sweeps remained moderate or weak in WMS QC, so proof-grade peat water-table rendering requires SAR fusion or a stronger measured Sentinel-2 target.',
  evalscript: genEvalscript(['B03','B04','B08','B8A','B11'],`
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let sphagnum=(sample.B8A-sample.B11)/(sample.B8A+sample.B11+0.001);
  let peat=sample.B04<0.06&&sample.B08<0.15?1:0;
  let val=Math.max(0,ndwi)*Math.max(0,sphagnum)*peat*5;
  return ${cb('Math.min(1,val)',P.wetland)};`)
},
{
  key:'mhssp', acronym:'MHSSP', domain:'wetland',
  name:'Methane Hotspot Surface Spectral Predictor',
  platform:'Sentinel-2 + TROPOMI', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDWI × (1−NDVI) × (1−CI_rededge/local_max)',
  physics:'Methane-emitting wetland surfaces are open water (positive NDWI), vegetation-free (low NDVI), and show reduced red-edge chlorophyll index from anoxic peat surface rather than vegetated mat.',
  benefit:'Prioritizes methane hotspot monitoring sites for drone or aircraft campaigns.',
  gradient: G.wetland,
  bookmark:{lat:29.0, lng:-89.5, zoom:10, date:'2021-07-01', label:'Mississippi River Delta — methane hotspot'},
  source: 'NASA DeltaX Project / USGS Wetlands Center',
  sourceUrl: 'https://deltax.jpl.nasa.gov/',
  justification: 'Targets coastal marshes in the Mississippi River Delta. July 2021 captures warm, saturated soil conditions associated with high organic decomposition and biogenic methane emissions.',
  evalscript: genEvalscript(['B03','B04','B05','B08','B11'],`
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ci=(sample.B05-sample.B04)/(sample.B05+sample.B04+0.001);
  let hot=Math.max(0,ndwi)*Math.max(0,0.3-ndvi)*Math.max(0,0.1-ci);
  return ${cb('Math.min(1,hot*20)',P.wetland)};`)
},
{
  key:'tfidi', acronym:'TFIDI', domain:'wetland',
  name:'Tidal Flat Inundation Dynamics Index',
  platform:'Sentinel-2 monthly', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'NDWI_variability proxy — high NDWI in mid-range = active tidal flat',
  physics:'Tidal flats are periodically inundated. High NDWI percentile spread = full tidal habitat. Mid-range NDWI in single date captures the transition zone most sensitive to tidal dynamics.',
  benefit:'Maps tidal flat habitat dynamics — critical for migratory shorebird populations and blue carbon.',
  gradient: G.wetland,
  bookmark:{lat:37.76, lng:119.18, zoom:11, date:'2021-10-01', label:'Yellow River Delta China — tidal flat'},
  source: 'Frontiers study of Yellow River Delta tidal-flat dynamics',
  sourceUrl: 'https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2023.1259081/full',
  justification: 'Targets the extensive tidal flats of the Yellow River Delta. October 2021 captures tidally active mudflats vital for migratory birds and coastal carbon research.',
  evalscript: genEvalscript(['B03','B08','B11'],`
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let tidalZone=ndwi>-0.1&&ndwi<0.4?1:0;
  let flat=sample.B11<0.1?1:0;
  return ${cb('tidalZone*flat*Math.max(0,ndwi+0.15)*2',P.wetland)};`)
},
{
  key:'wdptzi', acronym:'WDPTZI', domain:'wetland',
  name:'Wet-Dry Peatland Transition Zone Index',
  platform:'Sentinel-2', platformShort:'S2', novelty:'T1', canRender:true,
  formula:'Gradient magnitude of (B11−B8A)/(B11+B8A) — Sobel edge proxy',
  physics:'Wet-dry peatland boundary creates a sharp SWIR1/NIR gradient — detectable as an abrupt spatial change in the moisture index. Edge detection approximated by threshold on SWIR/NIR ratio.',
  benefit:'Maps peat carbon vulnerability boundaries — where lowered water table exposes peat to oxidation.',
  gradient: G.wetland,
  bookmark:{lat:61.5, lng:69.0, zoom:11, date:'2021-07-15', label:'West Siberia — peatland transition zone'},
  source: 'The Cryosphere study of Western Siberian thermokarst lake waters',
  sourceUrl: 'https://tc.copernicus.org/articles/8/1177/2014/tc-8-1177-2014.pdf',
  justification: 'Targets the vast peatlands of the West Siberian Lowlands. Mid-July 2021 captures high-contrast vegetation moisture differences at wet-dry peatland margins, now tied to a Western Siberian thermokarst and peatland-lake source.',
  evalscript: genEvalscript(['B03','B08','B8A','B11'],`
  let swirNir=(sample.B11-sample.B8A)/(sample.B11+sample.B8A+0.001);
  let transition=Math.abs(swirNir)>0.05&&Math.abs(swirNir)<0.3?1:0;
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let val=transition*Math.abs(ndwi)*3;
  return ${cb('Math.min(1,val)',P.wetland)};`)
},
{
  key:'ipvsi', acronym:'IPVSI', domain:'wetland',
  name:'Invasive Phragmites vs. Native Vegetation Discrimination',
  platform:'Sentinel-2 seasonal', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'Red-edge structural proxy for dense monoculture vs. diverse native marsh',
  physics:'Invasive Phragmites forms dense monocultures with distinctive high NIR and low red-edge separation. Native wetland diversity creates more spectrally heterogeneous signals.',
  benefit:'Maps invasive Phragmites extent — guides targeted herbicide treatment to restore native wetlands.',
  gradient: G.wetland,
  bookmark:{lat:41.9, lng:-83.2, zoom:11, date:'2021-10-01', label:'Detroit River marshes — Phragmites invasion'},
  source: 'Great Lakes Phragmites Collaborative',
  sourceUrl: 'https://www.greatlakesphragmites.net/',
  justification: 'Targets the Detroit River coastal marshes. October 1, 2021, represents the late-fall senescence period when Phragmites remains green longer than diverse native marsh grasses, enhancing spectral contrast.',
  evalscript: genEvalscript(['B04','B05','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndre=(sample.B08-sample.B05)/(sample.B08+sample.B05+0.001);
  let dense=ndvi>0.6&&ndre>0.3?1:0;
  let mono=ndre/(ndvi+0.001);
  let val=dense*Math.max(0,mono-0.5)*3;
  return ${cb('Math.min(1,val)',P.algae)};`)
},
{
  key:'wvtdi', acronym:'WVTDI', domain:'wetland',
  name:'Wetland Vegetation Type Discrimination Index',
  platform:'Sentinel-2 time series', platformShort:'S2', novelty:'T2', canRender:true,
  formula:'NDWI + NDVI composite for vegetation-water ratio classification',
  physics:'Different wetland vegetation types (sedge, rush, forb, reed) have distinct NDWI/NDVI combinations reflecting moisture holding and canopy structure. Single-date approximation shows dominant type.',
  benefit:'Baseline wetland vegetation mapping — essential for carbon stock estimation and restoration planning.',
  gradient: G.wetland,
  bookmark:{lat:43.47, lng:4.58, zoom:11, date:'2021-05-02', label:'Camargue France — wetland diversity'},
  source: 'Tour du Valat Research Institute / Camargue',
  sourceUrl: 'https://tourduvalat.org/en/',
  justification: 'Targets the Camargue delta in southern France. WMS QC selected May 2, 2021, as the stronger same-location wetland vegetation discrimination scene.',
  evalscript: genEvalscript(['B03','B04','B08','B11'],`
  let ndvi=(sample.B08-sample.B04)/(sample.B08+sample.B04+0.001);
  let ndwi=(sample.B03-sample.B08)/(sample.B03+sample.B08+0.001);
  let wet=ndwi>-0.2&&ndvi>0.2?1:0;
  return ${cb('wet*(ndvi*0.6+Math.max(0,ndwi+0.2)*0.4)',P.wetland)};`)
},

/* ─── 11. HYPERSPECTRAL-ENABLED ─────────────────────────────────────────── */
{
  key:'cmsti', acronym:'CMSTI', domain:'hyperspectral',
  name:'Clay Mineral Stress Transition Index',
  platform:'EMIT', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'position_minimum(2190–2220nm) − 2200',
  physics:'Smectite Al-OH at 2200 nm; illite at 2208 nm. This 8 nm shift requires EMIT 5 nm bands — invisible to Sentinel-2, Landsat, or EnMAP (10 nm).',
  benefit:'Maps irreversible soil degradation (smectite→illite) — permanent loss taking centuries to reverse.',
  gradient: G.dry,
  bookmark:{lat:35.0, lng:-110.7, zoom:11, date:'2021-09-01', label:'Painted Desert AZ — clay mineral diversity'},
  evalscript: TC
},
{
  key:'mpssfi', acronym:'MPSSFI', domain:'hyperspectral',
  name:'Methane Plume Spectral Shape Feature Index',
  platform:'EMIT', platformShort:'EMIT', novelty:'T2', canRender:false,
  formula:'1 − ρ(1667nm) / [0.5×(ρ(1640nm)+ρ(1700nm))]',
  physics:'CH₄ has a strong absorption feature at 1667 nm. Band depth relative to 1640/1700 nm continuum isolates methane from water vapor and CO₂. Requires EMIT 7.4 nm SWIR resolution.',
  benefit:'Point-source methane plume mapping from individual facility emitters.',
  gradient: G.perm,
  bookmark:{lat:31.8, lng:-102.3, zoom:11, date:'2021-09-01', label:'Permian Basin TX — methane super-emitter context'},
  evalscript: TC
},
{
  key:'afcdi', acronym:'AFCDI', domain:'hyperspectral',
  name:'Asbestos Fiber Chrysotile Detection Index',
  platform:'EMIT + PRISMA', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'depth(2317nm) / depth(2387nm)',
  physics:'Chrysotile Mg-OH doublet at 2317/2387 nm discriminated from antigorite (2320/2100 nm) and lizardite (2320/2390 nm). EMIT 5 nm sampling resolves the 70 nm separation.',
  benefit:'Natural asbestos zone mapping near communities — eliminates the highest-uncertainty step in exposure assessment.',
  gradient: G.mine,
  bookmark:{lat:36.47, lng:-120.65, zoom:12, date:'2021-08-01', label:'New Idria CA — natural asbestos zone'},
  evalscript: TC
},
{
  key:'scfgosi', acronym:'SCFGOSI', domain:'hyperspectral',
  name:'Soil Carbon Functional Group Oxidation State Index',
  platform:'EMIT + EnMAP', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'depth(1730nm) / (1−mean_reflectance_400-2500nm)',
  physics:'Labile C (lipids, proteins) → C-H overtone at 1730 nm. Recalcitrant C (aromatic humus, char) → broad spectral darkness. Ratio encodes labile vs. recalcitrant proportion.',
  benefit:'Distinguishes stable carbon from labile — critical for understanding which soils store carbon permanently.',
  gradient: G.forest,
  bookmark:{lat:42.0, lng:-93.0, zoom:11, date:'2021-07-01', label:'Iowa farmland — soil carbon context'},
  evalscript: TC
},
{
  key:'reenbi', acronym:'REENBI', domain:'hyperspectral',
  name:'REE Neodymium Band Depth Index',
  platform:'EnMAP', platformShort:'EnMAP', novelty:'T1', canRender:false,
  formula:'1−ρ(803nm)/[ρ(780nm)+interpolated_continuum]',
  physics:'Nd³⁺ f-f transitions at 583, 740, 803 nm in REE carbonate/phosphate minerals. Requires EnMAP precision to resolve the 803 nm feature against soil continuum.',
  benefit:'Global REE deposit prospecting from EnMAP — satellite-first screening transforms exploration economics.',
  gradient: G.mine,
  bookmark:{lat:35.47, lng:-115.52, zoom:11, date:'2021-08-01', label:'Mountain Pass CA — REE mine'},
  evalscript: TC
},
{
  key:'epcase', acronym:'EPCASE', domain:'hyperspectral',
  name:'EnMAP Porphyry Cu Alteration Sequence Index',
  platform:'EnMAP', platformShort:'EnMAP', novelty:'T1', canRender:false,
  formula:'SAM distance to porphyry alteration sequence endmember',
  physics:'Porphyry Cu deposits have phyllic → potassic → propylitic alteration zones with diagnostic mineral assemblages in SWIR. EnMAP L2A provides the spectral resolution for alteration mapping.',
  benefit:'Transforms Cu exploration — reduces discovery cost for critical battery mineral.',
  gradient: G.mine,
  bookmark:{lat:-22.3, lng:-68.9, zoom:11, date:'2021-09-01', label:'Atacama Chile — Chuquicamata Cu mine'},
  evalscript: TC
},
{
  key:'dpcci', acronym:'DPCCI', domain:'hyperspectral',
  name:'DESIS Phycocyanin Column Concentration Index',
  platform:'DESIS + PACE', platformShort:'DESIS', novelty:'T2', canRender:false,
  formula:'depth(621nm) / continuum from DESIS 2.55 nm resolution',
  physics:'Phycocyanin has a sharp absorption at 621 nm. DESIS 2.55 nm resolution resolves this feature precisely — interpolated continuum removes background water-leaving radiance.',
  benefit:'Accurate phycocyanin concentration mapping for drinking water reservoir management.',
  gradient: G.algae,
  bookmark:{lat:41.7, lng:-82.5, zoom:10, date:'2021-08-01', label:'Lake Erie — phycocyanin bloom'},
  evalscript: TC
},
{
  key:'pftib', acronym:'PFTIB', domain:'hyperspectral',
  name:'Phytoplankton Functional Type Index Battery',
  platform:'PACE OCI', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'PFT_diatom=Abs(490)/Abs(440) | PFT_hapto=Abs(453)/Abs(490) | etc.',
  physics:'PACE OCI 5 nm bands resolve diatom (fucoxanthin 490–510 nm), haptophyte (19-hex-fucoxanthin 453 nm), and cyanobacteria (divinyl chlorophyll 440 nm shift) pigment packages simultaneously.',
  benefit:'Global phytoplankton community composition — enables carbon export estimates and HAB species prediction.',
  gradient: G.marine,
  bookmark:{lat:38.5, lng:-76.0, zoom:10, date:'2021-07-01', label:'Chesapeake Bay — phytoplankton community'},
  evalscript: TC
},

/* ─── 12. CROSS-SENSOR FUSION ───────────────────────────────────────────── */
{
  key:'tseai', acronym:'TSEAI', domain:'crosssensor',
  name:'TROPOMI–Sentinel-2 Emission Attribution Index',
  platform:'S5P TROPOMI + S2', platformShort:'TROPOMI', novelty:'T1', canRender:false,
  formula:'XCH4_anomaly / Σ(source_fraction × emission_factor)',
  physics:'S2 maps source type fractions within each 5.5×7 km TROPOMI pixel. Ratio of observed to predicted CH₄ enhancement identifies unaccounted emission sources.',
  benefit:'Transforms TROPOMI from "where is methane enhanced" to "what is emitting that methane."',
  gradient: G.perm,
  bookmark:{lat:31.8, lng:-102.3, zoom:10, date:'2021-08-01', label:'Permian Basin TX — methane attribution'},
  evalscript: TC
},
{
  key:'issai', acronym:'ISSAI', domain:'crosssensor',
  name:'ICESat-2 + Sentinel-1 Subsidence Attribution Index',
  platform:'ICESat-2 + S1 + S2', platformShort:'ICESat-2', novelty:'T1', canRender:false,
  formula:'(ICESat2_dZ/dt − InSAR_LOS_vertical) / ICESat2_dZ/dt',
  physics:'ICESat-2 measures absolute elevation change; InSAR measures relative deformation. Discrepancy identifies rapid incoherent subsidence or different temporal sampling.',
  benefit:'Subsidence cause attribution for tens of millions in sinking coastal cities.',
  gradient: G.urban,
  bookmark:{lat:-6.2, lng:106.8, zoom:11, date:'2021-08-01', label:'Jakarta Indonesia — subsidence context'},
  evalscript: TC
},
{
  key:'geawsi', acronym:'GEAWSI', domain:'crosssensor',
  name:'GRACE-FO + ECOSTRESS Agricultural Water Stress Index',
  platform:'GRACE-FO + ECOSTRESS', platformShort:'GRACE', novelty:'T1', canRender:false,
  formula:'(ET_ecostress / PET_estimate) × TWS_anomaly_sign',
  physics:'ET/PET < 1 = crop water stress. Negative TWS anomaly simultaneously = groundwater drawdown. Co-occurrence identifies the most urgent water security scenario.',
  benefit:'Identifies irrigation systems where crop stress AND aquifer depletion co-occur.',
  gradient: G.wetland,
  bookmark:{lat:38.0, lng:-100.0, zoom:9, date:'2021-07-01', label:'Ogallala aquifer region — water stress'},
  evalscript: TC
},
{
  key:'emsmmi', acronym:'EMSMMI', domain:'crosssensor',
  name:'EMIT Mineral + Sentinel-1 Soil Moisture Index',
  platform:'EMIT + S1', platformShort:'EMIT', novelty:'T1', canRender:false,
  formula:'VWC_S1_raw / (1 + clay_fraction_EMIT × clay_dielectric_correction)',
  physics:'Smectite clay inflates C-band backscatter-to-moisture retrieval. EMIT mineral fraction maps provide the clay correction enabling mineralogy-specific VWC retrieval.',
  benefit:'Improved soil moisture accuracy at global scale — particularly in high-clay agricultural regions.',
  gradient: G.wetland,
  bookmark:{lat:-34.0, lng:142.0, zoom:10, date:'2021-01-01', label:'Murray-Darling Basin Australia — clay soils'},
  evalscript: TC
},
{
  key:'nfcai', acronym:'NFCAI', domain:'crosssensor',
  name:'NISAR + Sentinel-2 Forest Carbon Accumulation Index',
  platform:'NISAR + S2', platformShort:'NISAR', novelty:'T3', canRender:false,
  formula:'L-band_HV × (1−canopy_cover_S2) + L-band_HH × age_proxy_NDVI_trend',
  physics:'NISAR L-band (24 cm) penetrates canopy, encoding woody volume. NDVI time series provides stand age context. NISAR launched 2024 — first operational L-band global SAR.',
  benefit:'Global 10 m forest carbon monitoring — supports national Paris Agreement reporting.',
  gradient: G.forest,
  bookmark:{lat:-2.0, lng:24.0, zoom:10, date:'2021-07-01', label:'Congo Basin — tropical forest carbon'},
  evalscript: TC
},
{
  key:'snuvqi', acronym:'SNUVQI', domain:'crosssensor',
  name:'NO₂ + Sentinel-2 Urban Vegetation Air Quality Index',
  platform:'TROPOMI + S2 + ERA5', platformShort:'TROPOMI', novelty:'T1', canRender:false,
  formula:'NO2_TROPOMI_downscaled − f(NDVI_S2, wind_ERA5)',
  physics:'S2 NDVI at 10 m constrains tree deposition capacity; ERA5 wind constrains dispersion. Residual NO₂ after tree-deposition model reveals neighborhoods with air quality benefit from urban forest.',
  benefit:'Maps which neighborhoods receive NO₂ benefit from urban trees — environmental justice analysis.',
  gradient: G.urban,
  bookmark:{lat:34.05, lng:-118.24, zoom:11, date:'2021-08-01', label:'Los Angeles CA — urban vegetation AQ'},
  evalscript: TC
},
{
  key:'puenpi', acronym:'PUENPI', domain:'crosssensor',
  name:'PACE + ECOSTRESS Coastal Wetland NEP Index',
  platform:'PACE OCI + ECOSTRESS', platformShort:'PACE', novelty:'T1', canRender:false,
  formula:'GPP_ECOSTRESS − NPP_PACE_aquatic − R_temperature_model',
  physics:'Coastal NEP = terrestrial GPP (ECOSTRESS) minus aquatic NPP (PACE phytoplankton) minus respiration (temperature model). First index enabling combined land-sea NEP at ecosystem scale.',
  benefit:'Global coastal blue-carbon accounting — enables national carbon inventories to include coastal wetland fluxes.',
  gradient: G.marine,
  bookmark:{lat:29.5, lng:-90.5, zoom:10, date:'2021-07-01', label:'Louisiana coast — coastal wetland NEP'},
  evalscript: TC
},

];

// ---------------------------------------------------------------------------
// Atlas v2 scientific reconciliation
// ---------------------------------------------------------------------------
// The raw records above retain the May 2026 catalog for traceability. Public
// consumers receive the reconciled records below. No override is evidence of
// target accuracy: live formulas are displayable screening features, while
// non-live workflows remain specifications until their declared data and
// calibration exist.

const EXECUTABLE_NONLIVE_KEYS = new Set([
  'swri', 'dwci', 'gmcpi', 'mdspi', 'spei', 'scspi', 'trsi', 'ccrbi',
  'ierpi', 'spsri', 'fgdci', 'ubcdi', 'fedgi', 'slsdi', 'aibeai', 'pwtdi',
]);

const CONTRIBUTION_FROM_LEGACY_TIER = {
  T1: 'C1',
  T2: 'C2',
  T3: 'C3',
};

const FORMULA_V2_OVERRIDES = {
  bhdfsi: {
    name: 'Burned Hillside Surface Context Score',
    formula: 'max(0, 0.15 − NBR) × max(0, BSI + 0.1) × max(0, 0.35 − NDVI)',
    proposedFormula: 'Calibrated debris-flow model f(ΔNBR, slope, flow accumulation, soil, rainfall intensity and duration)',
    physics: 'The live layer combines low NBR, exposed-soil context, and low vegetation cover in one Sentinel-2 scene. It does not compute slope, rainfall, soil moisture, drainage, or debris-flow susceptibility.',
    benefit: 'Post-fire surface-context screening. Debris-flow or evacuation decisions require terrain, rainfall, soils, inventories, and held-out watershed evaluation.',
    requiredInputs: ['Sentinel-2 L2A'],
    temporalOperator: 'Single-scene live proxy; proposed model requires pre/post fire and rainfall windows',
    spatialOperator: 'Per-pixel live proxy; proposed model requires terrain and flow-network context',
  },
  sfeii: {
    name: 'Canopy Moisture Deficit Calibration Specification',
    canRender: false,
    platform: 'Sentinel-2 formula specified; field calibration pending',
    platformShort: 'S2 · calibration pending',
    formula: 'FuelMask × scaled seasonal NDMI deficit',
    proposedFormula: 'FuelMask × clip[(NDMI_reference − NDMI_t) / scale_reference, 0, 1]',
    implementedFormula: 'Legacy [(B8A−B11)/(B8A+B11)] × [1−(B08/B12)] retained in source history only',
    formulaStatus: 'Rebuild required',
    physics: 'The prior multiplicative expression has an unstable physical direction because 1−B08/B12 is commonly negative over vegetation. A seasonal NDMI deficit is the defensible starting feature; LFMC requires field calibration.',
    benefit: 'Defines a canopy-moisture calibration experiment rather than a pre-ignition hazard product.',
    requiredInputs: ['Sentinel-2 L2A', 'seasonal reference distribution', 'field LFMC for stronger inference'],
    temporalOperator: 'Seasonal anomaly',
  },
  lfmpi: {
    name: 'Live Fuel Moisture Deficit Proxy',
    legacyFormula: 'FuelGate × WaterReject × [1 − scaled live-fuel moisture proxy]',
    formula: 'FuelGate × WaterReject × (1 − NDMI) / 2',
    implementedFormula: 'FuelGate × WaterReject × (1 − NDMI) / 2',
    proposedFormula: 'Field-calibrated LFMC = f(Sentinel-2 moisture features, vegetation type, season)',
    physics: 'The live layer displays a normalized NDMI deficit over live vegetation after water rejection. It is not calibrated in percent LFMC.',
    benefit: 'Canopy-moisture context for selecting field-calibration targets.',
    units: 'Dimensionless moisture-deficit proxy',
  },
  saci: {
    name: 'UV Absorbing Aerosol Context',
    formula: 'clip(AER_AI_340_380 / 3.5, 0, 1)',
    implementedFormula: 'clip(AER_AI_340_380 / 3.5, 0, 1)',
    proposedFormula: 'Aerosol-composition classifier f(UVAI, AOD, absorption AOD, Ångström exponent, plume height, meteorology)',
    physics: 'The live layer displays the TROPOMI 340/380 nm UV Absorbing Aerosol Index. It does not calculate AOD340/AOD550 or distinguish smoldering from flaming combustion.',
    benefit: 'Documents absorbing-aerosol plume context; composition and fire-type inference require additional aerosol products and labels.',
    units: 'Scaled native UV aerosol-index value',
  },
  peti: {
    name: 'Phytoplankton Bloom Context Proxy',
    formula: 'WaterGate × max[0, NDCI × RedEdgeContrast × 8]',
    implementedFormula: 'WaterGate × max[0, NDCI × RedEdgeContrast × 8]',
    proposedFormula: 'Field-calibrated bloom model with temporal persistence and toxin assays',
    physics: 'The live formula combines red/red-edge contrasts over water. Sentinel-2 has no 620 nm phycocyanin band, and this output does not establish cyanobacterial toxicity.',
    benefit: 'Bloom-context screening for field sampling, not toxin or drinking-water safety determination.',
  },
  csrc: {
    name: 'Surface Scum Context Composite',
    formula: 'WaterGate × max(0, NDCI + NIRScumBoost) × (1 − TurbidityReject)',
    implementedFormula: 'WaterGate × max(0, NDCI + NIRScumBoost) × (1 − TurbidityReject)',
    proposedFormula: 'Temporal surface-scum model with repeated clear observations and toxin assays',
    physics: 'The live formula combines a red-edge bloom feature, elevated NIR, and a turbidity rejection term. It does not calculate persistence or cyanotoxin risk.',
    benefit: 'Locates surface-scum-like optical conditions for review and sampling.',
  },
  rrfi: {
    name: 'Riparian Dry-Bare Context Composite',
    formula: 'max(0, 0.3−NDVI) × max(0, −NDWI) × max(0, BSI) × 40',
    implementedFormula: 'max(0, 0.3−NDVI) × max(0, −NDWI) × max(0, BSI) × 40',
    proposedFormula: 'ΔNDVI_riparian × ΔNDWI_channel × ΔBSI_bank with mapped riparian and channel zones',
    physics: 'The live layer is a single-scene dry, sparsely vegetated, bare-surface feature. It does not measure riparian loss or channel decline without a baseline and spatial masks.',
    benefit: 'Surfaces candidate dry/bare riparian context for time-series analysis.',
  },
  epdi: {
    name: 'Bare-Surface and Water-Turbidity Context',
    formula: '0.5 × BareSurfaceHeuristic + 3 × TurbidityContrast × WaterGate',
    implementedFormula: '0.5 × BareSurfaceHeuristic + 3 × TurbidityContrast × WaterGate',
    proposedFormula: 'ΔBSI_upslope × TurbidityAnomaly_downstream × Persistence with flow-network linkage',
    physics: 'The live formula adds same-pixel bare-surface and water-turbidity features. It does not compute upslope/downstream linkage, change, or persistence.',
    benefit: 'Context layer for designing an erosion-delivery time-series study.',
    // 2026-07-23 QC: this WMS response has a smaller no-data gap at the bookmarked date. Swept
    // ±60 days/step 15; every date before 2023-03-17 is before the levee breach this bookmark
    // documents, and both tested post-breach alternatives (04-01, 05-16) still showed a gap (or a
    // larger one). Keeping the current date; mitigate by cropping tight when using this as a
    // lead image rather than the full bookmark extent.
  },
  rdoci: {
    name: 'CDOM Spectral-Slope Research Specification',
    formula: 'S(λ1,λ2) = [ln aCDOM(λ1) − ln aCDOM(λ2)] / (λ2 − λ1)',
    proposedFormula: 'DOC_estimate = f[aCDOM, spectral slope, optical water type] calibrated to field DOC',
    formulaStatus: 'Retrieval workflow required',
    physics: 'CDOM spectral slope is defined from absorption after atmospheric and aquatic retrieval, not directly from raw 320/412 nm reflectance. DOC inference requires field calibration and water-type controls.',
    benefit: 'Specifies the measurements needed to test a PACE-enabled DOC/CDOM relationship.',
    requiredInputs: ['PACE OCI water-leaving reflectance', 'atmospheric correction', 'in-water absorption', 'field DOC/CDOM'],
    units: 'Spectral slope: inverse wavelength; DOC units depend on calibration',
  },
  ctpsti: {
    name: 'Phytoplankton Pigment Contrast Feature',
    formula: '[ρ(560 nm) − ρ(620 nm)] / [ρ(560 nm) + ρ(620 nm)]',
    physics: 'The contrast may respond to pigment composition after aquatic atmospheric correction. It cannot determine species, toxin genes, or toxin concentration.',
    benefit: 'Candidate pigment-balance feature for studies with taxonomy and toxin assays.',
  },
  fcli: {
    name: 'Floodplain SWIR-Vegetation Context',
    formula: 'max(0, B12−0.18) × max(0, 0.4−NDVI) × 8',
    implementedFormula: 'max(0, B12−0.18) × max(0, 0.4−NDVI) × 8',
    proposedFormula: 'SWIR2 anomaly after inundation × next-season vegetation suppression',
    physics: 'The live layer is a single-scene SWIR2 and low-vegetation feature. It does not compute an anomaly, flood history, contamination, or next-season response.',
    benefit: 'Identifies candidate floodplain surface context for a longitudinal contamination study.',
  },
  smpdi: {
    name: 'Floating-Material Spectral Contrast',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    implementedFormula: 'WaterGate × LandReject × [FAI_B12baseline − ((B8A−B11)/(B8A+B11))]',
    proposedFormula: 'Polymer-versus-biomass discrimination using imaging spectroscopy (e.g. EMIT) with labeled floating-material references',
    physics: 'The live feature combines a floating-algae-style baseline residual with NIR/SWIR contrast and water/land gates. The baseline is interpolated B04→B12 rather than the B04→B11 pairing used in common Sentinel-2 FAI implementations, so it is an FAI variant and not the canonical index. Sargassum-versus-plastic discrimination has not been independently evaluated, and the live layer uses no EMIT data.',
    benefit: 'Candidate feature for labeled floating-material classification against established FDI baselines (Biermann et al., 2020).',
  },
  owsi: {
    name: 'Oil-Related Surface Contrast Proxy',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'max(0, NDOI) × max(0, B11/B12 − 0.8) × 2',
    implementedFormula: 'max(0, (B02−B12)/(B02+B12)) × max(0, B11/B12 − 0.8) × 2',
    proposedFormula: 'Weathering-stage classification from imaging spectroscopy (e.g. EMIT) with sampled oil-age references',
    physics: 'The live layer is a blue/SWIR2 contrast scaled by a SWIR1:SWIR2 ratio. "NDOI" is a legacy broad-band contrast name, not a hydrocarbon retrieval, and the ratio term is not a calibrated weathering clock. The live layer uses no EMIT data.',
    benefit: 'Surface-contrast context over water for selecting oil-incident scenes for review; it does not establish oil presence, thickness, or age.',
  },
  npdefi: {
    name: 'Red-Edge and SWIR Crop Contrast Proxy',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'VegGate × {[(B04−B05)/(B04+B05)] − [(B12−B11)/(B12+B11)]}',
    implementedFormula: 'I[NDVI>0.2] × clip({[(B04−B05)/(B04+B05)] − [(B12−B11)/(B12+B11)]} + 0.5, 0, 1)',
    proposedFormula: 'Nitrogen-versus-phosphorus discrimination calibrated to measured tissue nutrient concentrations, with crop, cultivar, phenology, and soil-background strata',
    physics: 'The live layer differences a red/red-edge contrast against a SWIR2/SWIR1 contrast over vegetated pixels. The red-edge term responds to chlorophyll status, but the SWIR term tracks canopy water and dry-matter (cellulose/lignin) absorption — it is not an anthocyanin signal, because anthocyanins absorb near 500–550 nm and have no SWIR2 feature. The separation of nitrogen from phosphorus limitation is therefore hypothesized, not demonstrated, and the live layer uses no EnMAP data.',
    benefit: 'Candidate crop-stress contrast for experiments with measured nutrient data; it does not identify which nutrient is limiting.',
  },
  cbsdi: {
    name: 'Coral Brightness Context Proxy',
    formula: 'BlueBrightnessGate × GreenRedContrastGate',
    implementedFormula: 'I[(B03−B04)/(B03+B04) < 0.05 and B02 > 0.06] × (0.5 + 3B02)',
    proposedFormula: 'Multi-date, depth-corrected benthic change model with field coral-condition labels',
    physics: 'The live code implements one brightness/green-red condition only. It does not implement the advertised three stages or determine bleaching, mortality, or algal colonization.',
    benefit: 'Single-scene shallow-water brightness context for selecting field-reviewed change targets.',
  },
  kcdsi: {
    name: 'Floating or Shallow-Water Vegetation Context',
    formula: 'max(0, NDVI) × WaterVegetationGate',
    implementedFormula: 'max(0, NDVI) × I[B11<0.04 and B03<0.16]',
    proposedFormula: 'Depth-corrected multi-date kelp-canopy condition model',
    physics: 'The live layer displays positive NDVI under a simple low-SWIR water-context gate. It does not correct bathymetry or measure kelp stress.',
    benefit: 'Candidate floating/shallow vegetation context for labeled kelp mapping.',
  },
  cduai: {
    name: 'Coastal Water Turbidity Context',
    formula: 'max(0, RedGreenContrast + 0.05) × WaterGate × 6',
    implementedFormula: 'max(0, RedGreenContrast + 0.05) × WaterGate × 6',
    proposedFormula: 'Turbidity anomaly with cloud mask, plume morphology, source context, and multi-date persistence',
    physics: 'The live formula is a red/green water-contrast feature. It does not contain an explicit cloud mask or establish dredging as the cause.',
    benefit: 'Highlights turbid coastal-water context for source and time-series review.',
  },
  mppdi: {
    name: 'Floating-Debris Candidate Feature',
    formula: 'max(0, FAI) × NonVegetationGate × LowTurbidityGate × 10',
    implementedFormula: 'max(0, FAI) × NonVegetationGate × LowTurbidityGate × 10',
    proposedFormula: 'Labeled floating-material classifier with explicit natural-debris, foam, Sargassum, cloud, glint, and turbidity controls',
    physics: 'The live formula does not implement explicit foam or Sargassum terms and cannot identify polymer composition from Sentinel-2 alone.',
    benefit: 'Candidate floating-debris feature for comparison with FDI-based classification.',
  },
  pdsdi: {
    name: 'Crop Red-Edge and Dryness Context',
    formula: 'max(0, 0.6−NDRE) × max(0, B11/B08−0.5) × 4',
    implementedFormula: 'max(0, 0.6−NDRE) × max(0, B11/B08−0.5) × 4',
    proposedFormula: 'Spatial NDVI texture normalized by crop, phenology, moisture, and management baselines',
    physics: 'The live layer contains no texture or spatial variance and cannot distinguish pesticide stress from drought, disease, nutrient limitation, or management.',
    benefit: 'Crop stress context for a labeled causal-discrimination study.',
  },
  wdacsi: {
    name: 'Wetland-Agriculture Edge Context',
    formula: 'max(0, NDCI) × max(0, −NDWI) × OrganicSurfaceHeuristic × 10',
    implementedFormula: 'max(0, NDCI) × max(0, −NDWI) × OrganicSurfaceHeuristic × 10',
    proposedFormula: 'Multi-date crop-green anomaly × wetland drainage change × mapped peat disturbance',
    physics: 'The live formula is a single-scene optical conjunction. It does not measure drainage, NDWI loss, nitrogen addition, or agricultural intrusion.',
    benefit: 'Context for reviewing wetland edges before land-cover and hydrologic analysis.',
  },
  tdrasi: {
    name: 'Mining Iron-SWIR Context Proxy',
    formula: 'max(0, RedBlueContrast−0.05) × max(0, B11/B12−1) × 3',
    implementedFormula: 'max(0, RedBlueContrast−0.05) × max(0, B11/B12−1) × 3',
    proposedFormula: 'Field-informed mineral/turbidity anomaly with mine, channel, and time-series context',
    physics: 'The live formula contains no mine-proximity term and cannot uniquely identify jarosite, sulfate, or a tailings release from Sentinel-2 ratios.',
    benefit: 'Mining-area iron/SWIR context for field-informed mineral analysis.',
  },
  ecaci: {
    name: 'Urban Canopy-Loss & Dry-Surface Context Index',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    formula: 'max(0, 0.4 − NDVI) × max(0, MSI − 0.8) × 3',
    implementedFormula: 'max(0, 0.4 − NDVI) × max(0, MSI − 0.8) × 3',
    proposedFormula: 'LST-based heat-island model = f(ECOSTRESS/thermal LST, NDVI, surface moisture, urban morphology, time-of-day)',
    physics: 'The live layer combines an NDVI deficit with a SWIR/NIR moisture-stress ratio (MSI = B11/B08) over Sentinel-2 optical bands only. It does not read ECOSTRESS or any thermal data, and the output is not a land-surface-temperature or heat-island-intensity measurement.',
    benefit: 'Screens neighborhoods for low-canopy, dry-surface context associated with urban heat exposure. Measuring heat-island intensity itself requires thermal/LST data this layer does not use.',
    requiredInputs: ['Sentinel-2 L2A'],
    units: 'Uncalibrated dimensionless screening score',
    // 2026-07-23 QC: the 2021-07-20 bookmark had a large no-data gap covering roughly a third of
    // the tile in this layer's WMS response. 2021-07-05 renders full-frame with no gap and a
    // stronger urban/desert contrast, while staying inside the same extreme-heat summer window.
    bookmark: { date: '2021-07-05' },
  },
  amdphi: {
    name: 'AMD Iron-Mineral Calibration Specification',
    canRender: false,
    platform: 'Sentinel-2 + field mineralogy; calibration pending',
    platformShort: 'S2 · field calibration',
    formula: 'Mineral features = continuum-removed band depths or field-guided spectral unmixing',
    proposedFormula: 'pH_estimate = f(mineral features, field pH, water/soil context) with held-out sites',
    implementedFormula: 'Legacy visible ratio-of-ratios retired from live display because its denominator is unstable near zero',
    formulaStatus: 'Rebuild required',
    physics: 'Iron-mineral assemblages can be associated with acidity, but the prior ratio was numerically unstable and not a direct pH measurement.',
    benefit: 'Defines a mineral and field-chemistry calibration study; no current pH retrieval is claimed.',
    requiredInputs: ['surface reflectance', 'field pH', 'XRD/mineralogy', 'spectral library', 'held-out sites'],
  },
  tdsii: {
    name: 'Tailings Change-Risk Calibration Model',
    formula: 'Risk = logistic[β0 + β1z(seepage anomaly) + β2z(subsidence rate) + β3z(vegetation change)]',
    proposedFormula: 'Coefficients fitted to documented incidents and stable control facilities',
    formulaStatus: 'Calibrated model required',
    physics: 'Optical indices and deformation rates have different units and cannot be added with arbitrary weights. Predictors require normalization, temporal alignment, labels, and learned coefficients.',
    benefit: 'Specifies a prospective multi-sensor risk experiment, not a deployed failure-warning system.',
    units: 'Calibrated event probability or declared risk score',
  },
  hsai: {
    name: 'Low-Vegetation Bare-Surface Context',
    formula: 'max(0, 0.3−NDVI) × max(0, BSI+0.05) × 6',
    implementedFormula: 'max(0, 0.3−NDVI) × max(0, BSI+0.05) × 6',
    proposedFormula: 'Tree-canopy and shade-access model inside an explicit urban residential mask',
    physics: 'The live formula contains no urban, residential, tree-crown, or shade mask. It is a generic low-vegetation/bare-surface feature.',
    benefit: 'Input feature for an urban shade-access model with canopy and population data.',
  },
  pcadi: {
    name: 'Dark Paved-Surface Context',
    formula: 'LowVisibleReflectanceGate × LowNDVIGate × (1−8×VisibleAlbedo)',
    implementedFormula: 'I[B02,B03,B04<0.15 and NDVI<0.05] × (1−8×mean(B02,B03,B04))',
    proposedFormula: 'RoadMask × (B02_t−B02_baseline)/B02_baseline with material and maintenance controls',
    physics: 'The live formula has neither a road mask nor a temporal baseline and therefore cannot retrieve pavement age or condition.',
    benefit: 'Dark, low-vegetation surface context for a road-condition change study.',
  },
  lfgvi: {
    name: 'Landfill Vegetation-Stress Context',
    formula: 'max(0,0.5−NDVI) × max(0,0.2−RedEdgeContrast) × max(0,0.3−NDMI) × 20',
    implementedFormula: 'max(0,0.5−NDVI) × max(0,0.2−RedEdgeContrast) × max(0,0.3−NDMI) × 20',
    proposedFormula: 'LandfillMask × temporal vegetation anomaly × spatial-pattern features × field gas measurements',
    physics: 'The live code contains no annular/ring-pattern operator and vegetation stress is not specific to landfill gas.',
    benefit: 'Vegetation-stress context for landfill inspection when combined with geology and field gas measurements.',
  },
  lrdvsi: {
    name: 'Vegetation-Moisture Anomaly Context',
    formula: 'max(0,0.4−NDVI) × max(0,NDWI+0.2) × 5',
    implementedFormula: 'max(0,0.4−NDVI) × max(0,NDWI+0.2) × 5',
    proposedFormula: 'LandfillMask × downslope flow path × temporal vegetation and water anomaly',
    physics: 'The live formula contains no landfill boundary, downslope channel, baseline, or source attribution.',
    benefit: 'Wet, low-vegetation context for designing a field-verified leachate study.',
  },
  ttapi: {
    name: 'Wet Exposed-Peat Context',
    formula: 'PeatReflectanceHeuristic × max(0,0.3−NDVI) × max(0,NDWI+0.3) × 8',
    implementedFormula: 'PeatReflectanceHeuristic × max(0,0.3−NDVI) × max(0,NDWI+0.3) × 8',
    proposedFormula: 'Multi-date peat exposure × mapped slump-edge displacement × terrain context',
    physics: 'The live code contains no edge-collapse or change operator and cannot establish active thermokarst expansion.',
    benefit: 'Wet exposed-organic-surface context for time-series thermokarst mapping.',
  },
  tperi: {
    name: 'Thermokarst Pond-Edge Context',
    formula: 'PeatEdgeGate × max(0, NDWI+0.2) × 3',
    implementedFormula: 'I[B12>0.08 and −0.2<NDWI<0.4] × max(0,NDWI+0.2) × 3',
    proposedFormula: 'Expansion rate = [Area(t2)−Area(t1)] / [t2−t1], with boundary-registration uncertainty',
    physics: 'The live layer is a single-scene wet peat-edge feature. Rate and expansion require registered dates and mapped boundaries.',
    benefit: 'Selects candidate pond margins for a reproducible change-rate workflow.',
    units: 'Live: dimensionless context; proposed rate: area/time or distance/time',
  },
  sabsi: {
    name: 'Bright-Snow Red-Green Context',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'BrightSnowGate × max[0, (B04−B03)/(B04+B03)+0.05] × 10',
    implementedFormula: 'I[B02>0.4 and B03>0.4] × max[0, (B04−B03)/(B04+B03)+0.05] × 10',
    proposedFormula: 'SnowMask × pigment model calibrated to algae abundance and impurities, with higher-cadence imagery (e.g. Planet) for bloom timing',
    physics: 'The live code uses visible-band brightness rather than NDSI and cannot uniquely attribute red snow to algae. The absolute brightness gates (B02, B03 > 0.4) assume offset-corrected surface reflectance. The live layer uses no Planet data.',
    benefit: 'Red/green spectral context over bright snow for field-reviewed algae studies.',
  },
  pwtdi: {
    name: 'Peatland Water-Table Calibration Model',
    formula: 'WTD_estimate = f(S1 VV, VH, polarization ratios, optical moisture features, vegetation, season, site)',
    proposedFormula: 'Logger-calibrated regression with geographic and temporal holdouts',
    formulaStatus: 'Field calibration required',
    physics: 'Sentinel-2 B09 is a coarse atmospheric-water-vapor band, not a direct 970/1020 nm Sphagnum water-content channel. Water-table depth must be calibrated to in-situ loggers.',
    benefit: 'Defines a radar-optical water-table experiment rather than an operational WTD product.',
    requiredInputs: ['Sentinel-1 GRD', 'Sentinel-2 L2A', 'water-table loggers', 'vegetation and seasonal covariates'],
    units: 'Estimated depth after calibration',
  },
  mhssp: {
    name: 'Open Anoxic-Surface Context Proxy',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'max(0,NDWI) × max(0, 0.3−NDVI) × max(0, 0.1−CI_rededge) × 20',
    implementedFormula: 'max(0,NDWI) × max(0, 0.3−NDVI) × max(0, 0.1−(B05−B04)/(B05+B04)) × 20',
    proposedFormula: 'Surface-context features combined with an atmospheric methane retrieval (e.g. TROPOMI) and plume-transport modelling',
    physics: 'The live formula identifies wet, low-vegetation, low-red-edge surfaces. The red-edge term is a fixed threshold, not the advertised normalization against a local maximum. It does not measure methane flux or identify emission hotspots, and the live layer uses no TROPOMI data.',
    benefit: 'Candidate surface-context feature for studies with chamber, tower, or atmospheric methane measurements.',
  },
  mepsi: {
    name: 'Open Shallow-Water Pond Context',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'PondGate × max(0, NDWI) × 3',
    implementedFormula: 'I[NDWI>0.1 and NDVI<0.15 and NDCI<0.05] × max(0, NDWI) × 3',
    proposedFormula: 'Ebullition-pond identification calibrated to measured methane flux, with higher-cadence imagery (e.g. Planet) for pond dynamics',
    physics: 'The live layer gates on open water with low vegetation and low red-edge chlorophyll contrast. The third term is NDCI, a chlorophyll-a water index, used here as a bare-water proxy rather than a macrophyte measurement. Ebullition is not observed, and the live layer uses no Planet data.',
    benefit: 'Selects open, low-productivity ponds as candidate sites for flux measurement.',
  },
  tfidi: {
    name: 'Single-Date Tidal-Zone Wetness Context',
    formula: 'I[−0.1<NDWI<0.4] × I[B11<0.1] × max(0,NDWI+0.15) × 2',
    implementedFormula: 'I[−0.1<NDWI<0.4] × I[B11<0.1] × max(0,NDWI+0.15) × 2',
    proposedFormula: 'Clear-observation NDWI percentile spread across a tidal time series',
    physics: 'The live layer contains no variability calculation. It displays a single-date intermediate wetness condition.',
    benefit: 'Selects likely tidal-transition surfaces for a hydroperiod time-series analysis.',
    bookmark: { date: '2021-08-17' },
  },
  dlpehi: {
    name: 'Sparse-Vegetation and Bare-Soil Dryland Context',
    platform: 'Sentinel-2',
    platformShort: 'S2',
    requiredInputs: ['Sentinel-2 L2A'],
    formula: 'SparseVegGate × MoistureGate × max(0, BSI + 0.1) × 5',
    implementedFormula: 'I[0.05<NDVI<0.35] × I[−0.3<NDWI<0.1] × max(0, BSI + 0.1) × 5',
    proposedFormula: 'Oviposition-habitat model combining soil moisture, sparse-vegetation cover, and soil texture with a rainfall gate (e.g. GPM) and validated against ground locust survey records',
    physics: 'The live layer gates on a sparse-vegetation NDVI window and an intermediate NDWI window, then scales a standard bare-soil index. The advertised NDTI texture term is NOT implemented — NDTI requires B12, which this script does not load — and a BSI bare-soil contrast stands in for it. The NDVI window is 0.05–0.35 as coded, not the 0.1–0.3 previously advertised, and NDWI acts as a gate rather than a multiplicative factor. There is no rainfall input, so no GPM data is used.',
    benefit: 'Dryland surface-context screening. Locust habitat or outbreak warning requires rainfall history, soil texture, and ground survey confirmation.',
  },
  lisi: {
    name: 'Canopy NIR/SWIR Structural Contrast',
    formula: '2.5 × [(B08−B11)/(B08+B11+6B04−7.5B02+1)] × (B08/B11)',
    implementedFormula: '2.5 × [(B08−B11)/(B08+B11+6B04−7.5B02+1)] × (B08/B11)',
    proposedFormula: 'Liana-infestation mapping calibrated to crown-level infestation labels with geographically blocked evaluation',
    physics: 'The live layer scales a NIR/SWIR difference by an EVI-style denominator and a NIR:SWIR1 ratio. The denominator includes a B11 term that earlier documentation omitted, so it is not the EVI denominator despite the similar shape; the expression is an EVI-inspired structural contrast rather than EVI applied to lianas. Liana-versus-tree separation is hypothesized, not demonstrated.',
    benefit: 'Low-cost canopy-structure contrast to be evaluated against crown-level liana labels and prior UAV/airborne work (Waite et al., 2019; Chandler et al., 2021).',
  },
  ipvsi: {
    name: 'Dense-Canopy Red-Edge Ratio Context',
    formula: 'DenseCanopyGate × max(0, NDRE/NDVI − 0.5) × 3',
    implementedFormula: 'I[NDVI>0.6 and NDRE>0.3] × max(0, NDRE/NDVI − 0.5) × 3',
    proposedFormula: 'Seasonal multi-date Phragmites discrimination calibrated to mapped stands of invasive and native marsh vegetation',
    physics: 'The live layer is single-date, not seasonal. It gates on dense green canopy and displays the red-edge-to-NDVI ratio above a fixed offset. Dense monoculture and species-diverse marsh are not separated by this expression alone; the ratio responds to canopy density and chlorophyll, which many wetland species share.',
    benefit: 'Selects dense-canopy wetland patches for field or multi-date review; it does not identify Phragmites or any other species.',
    temporalOperator: 'Single-scene; proposed workflow requires a seasonal series',
    bookmark: { date: '2021-09-01' },
  },
  wvtdi: {
    name: 'Wetland Vegetation-Water Balance Context',
    formula: 'WetVegGate × [0.6 × NDVI + 0.4 × max(0, NDWI + 0.2)]',
    implementedFormula: 'I[NDWI>−0.2 and NDVI>0.2] × [0.6 × NDVI + 0.4 × max(0, NDWI + 0.2)]',
    proposedFormula: 'Multi-date wetland vegetation-type classification calibrated to surveyed sedge, rush, forb, and reed communities',
    physics: 'The live layer is a single-date weighted sum of greenness and wetness inside a wet-vegetation gate. It produces a continuous vegetation-water balance score, not a vegetation-type class, and the weights are unfitted design choices rather than calibrated coefficients.',
    benefit: 'Continuous wetland vegetation-water context for stratifying field survey effort.',
    temporalOperator: 'Single-scene; proposed workflow requires a multi-date series',
  },
  wdptzi: {
    name: 'Peat Moisture Transition Proxy',
    formula: 'TransitionGate[(B11−B8A)/(B11+B8A)] × |NDWI| × 3',
    implementedFormula: 'I[0.05<|(B11−B8A)/(B11+B8A)|<0.3] × |NDWI| × 3',
    proposedFormula: 'Spatial gradient magnitude or edge detector applied to a co-registered peat-moisture surface',
    physics: 'The live evalscript is per-pixel and does not calculate a Sobel operator or neighborhood gradient.',
    benefit: 'Moisture-transition context for a later spatial edge-analysis workflow.',
  },
  cmsti: {
    name: 'Clay-Mineral Absorption-Position Model',
    formula: 'λ_min = fitted continuum-removed Al−OH absorption position with wavelength uncertainty',
    proposedFormula: 'Mineral classification f(λ_min, feature shape, spectral library, mixture model, uncertainty)',
    formulaStatus: 'Spectral fitting required',
    physics: 'An approximately 8 nm target shift is comparable to EMIT sampling and cannot be treated as a direct one-channel minimum. Spectral fitting, signal-to-noise, mixtures, and wavelength uncertainty are required.',
    benefit: 'Defines a falsifiable clay-mineral separability experiment.',
    units: 'Fitted wavelength and classification uncertainty',
  },
  mpssfi: {
    name: 'Methane Matched-Filter Research Specification',
    formula: 'Methane enhancement = matched-filter or radiative-transfer retrieval across the CH₄ absorption complex',
    proposedFormula: 'Plume/background retrieval followed by wind-informed flux estimation and uncertainty',
    formulaStatus: 'Atmospheric retrieval required',
    physics: 'A three-band surface-reflectance depth at 1667 nm is not a robust atmospheric methane retrieval and does not isolate water vapor or carbon dioxide by itself.',
    benefit: 'Specifies an imaging-spectroscopy methane workflow consistent with plume retrieval practice.',
    units: 'Column enhancement; flux only after wind-informed inversion',
  },
  reenbi: {
    name: 'REE Neodymium Band-Depth Feature',
    formula: 'BD803 = 1 − R803 / Rc803',
    proposedFormula: 'Rc803 = linearly interpolated continuum between validated shoulders; interpret through mixture and field tests',
    formulaStatus: 'Continuum-removal specification',
    physics: 'The prior denominator incorrectly added a shoulder reflectance to an interpolated continuum. Standard continuum removal uses the continuum value at the feature center.',
    benefit: 'Candidate neodymium absorption feature for spectral-library and field validation.',
    units: 'Dimensionless continuum-removed band depth',
  },
  tseai: {
    name: 'Methane Inventory Residual Research Model',
    formula: 'Residual = ΔXCH4_observed − H(emissions inventory, wind, boundary layer, retrieval averaging kernel)',
    proposedFormula: 'Source posterior p(source | residual, transport, inventory, land-cover prior, uncertainty)',
    formulaStatus: 'Transport inversion required',
    physics: 'XCH4 concentration cannot be divided by land-cover fractions and emission factors with incompatible units. Land cover is a prior; attribution requires transport and uncertainty.',
    benefit: 'Defines the residual and evidence required for methane-source attribution.',
    units: 'Concentration residual; source flux only after inversion',
  },
  nfcai: {
    name: 'NISAR-Optical Biomass Calibration Model',
    formula: 'AGB_estimate = f(L-HV, L-HH, coherence, canopy cover, topography)',
    proposedFormula: 'Carbon = AGB_estimate × carbon_fraction with plot, allometric, saturation, and model uncertainty',
    formulaStatus: 'Field calibration required',
    physics: 'Radar backscatter and NDVI trend cannot be combined as an uncalibrated carbon equation, and NDVI trend is not a stand-age measurement. NISAR launched in 2025.',
    benefit: 'Defines a plot-calibrated biomass and carbon experiment using NISAR science data.',
    requiredInputs: ['NISAR L-band products', 'Sentinel-2 canopy features', 'topography', 'biomass plots', 'allometry'],
    units: 'Biomass or carbon per area after calibration',
  },
  puenpi: {
    name: 'Coastal Wetland Carbon-Budget Research Model',
    formula: 'NEP_total = consistently defined land and aquatic production − total ecosystem respiration and export terms',
    proposedFormula: 'All components harmonized to common carbon units, spatial support, interval, and system boundary',
    formulaStatus: 'Carbon-budget model required',
    physics: 'The prior expression subtracted aquatic primary production and mixed products with incompatible meanings and supports. A coastal carbon budget requires an explicit system boundary and sign convention.',
    benefit: 'Defines the accounting structure needed before combining PACE and thermal/ecosystem products.',
    units: 'Carbon per area per time after harmonization',
  },
};

const ARTICLE_LEADS = {
  bhdfsi: {
    articleAngle: 'Post-fire surface conditions below the Thomas Fire burn scar after the Montecito debris-flow event.',
    acquisitionTimestamp: '2018-01-22T18:54:21.026Z',
    acquisitionCloudCover: '0.00%',
  },
  lfmpi: {
    articleAngle: 'A transparent NDMI-deficit proxy over drought-stressed Angeles National Forest chaparral.',
    acquisitionTimestamp: '2021-08-01T18:29:21.024Z',
    acquisitionCloudCover: '0.09%',
  },
  peti: {
    articleAngle: 'Western Lake Erie bloom context without implying species identity or toxin concentration.',
    acquisitionTimestamp: '2019-08-01T16:28:39.024Z',
    acquisitionCloudCover: '0.00%',
  },
  epdi: {
    articleAngle: 'Pajaro levee-breach sediment context, described as a same-scene proxy rather than routed sediment delivery.',
    acquisitionTimestamp: '2023-03-15T18:51:39.024Z',
    acquisitionCloudCover: '6.90%',
  },
  ecaci: {
    articleAngle: 'Phoenix exposed-surface and low-canopy context during extreme summer heat.',
    // Bookmark moved from 2021-07-20 to 2021-07-05 (see FORMULA_V2_OVERRIDES.ecaci) to drop a
    // large no-data gap in the WMS response. The prior timestamp/cloud-cover pair belonged to the
    // old date; left null rather than re-asserting unverified numbers for the new one.
    acquisitionTimestamp: null,
    acquisitionCloudCover: null,
  },
  tdrasi: {
    articleAngle: 'Cerro de Pasco mining-area iron/SWIR context without mineral or spill-boundary attribution.',
    acquisitionTimestamp: '2021-07-24T15:17:09.024Z',
    acquisitionCloudCover: '0.00%',
  },
};

const STRONG_ARTICLE_QC_KEYS = new Set([
  'bhdfsi', 'lfmpi', 'saci', 'peti', 'csrc', 'epdi', 'fcli', 'smpdi',
  'cbsdi', 'kcdsi', 'owsi', 'cduai', 'npdefi', 'pdsdi', 'cctti', 'wdacsi',
  'tdrasi', 'ecaci', 'hsai', 'pcadi', 'lfgvi', 'lrdvsi', 'ttapi', 'tperi',
  'pcei', 'sabsi', 'mepsi', 'pdcsi', 'lisi', 'dlpehi', 'mhssp', 'tfidi',
  'wdptzi', 'ipvsi', 'wvtdi',
]);

function maturityFor(index) {
  if (index.canRender) return 'M3';
  if (EXECUTABLE_NONLIVE_KEYS.has(index.key)) return 'M2';
  return 'M1';
}

function reconcileAtlasIndex(index) {
  const override = FORMULA_V2_OVERRIDES[index.key] || {};
  const [capability, methodRole] = CAPABILITY_CLASSIFICATION[index.key] || [];
  const merged = {
    ...index,
    ...override,
    bookmark: { ...index.bookmark, ...(override.bookmark || {}) },
  };
  const maturity = override.maturity || maturityFor(merged);
  const contribution = override.contribution || CONTRIBUTION_FROM_LEGACY_TIER[index.novelty] || 'C1';
  const platform = String(merged.platform || '')
    .replace(/proof target pending/gi, 'implementation target pending');
  const platformShort = String(merged.platformShort || '')
    .replace(/validated proof target/gi, 'context target')
    .replace(/validated ([a-z-]+) target/gi, '$1 context target');
  const implementedFormula = Object.prototype.hasOwnProperty.call(override, 'implementedFormula')
    ? override.implementedFormula
    : (merged.canRender ? merged.formula : null);
  const articleLead = ARTICLE_LEADS[index.key] || null;
  const articleSuitability = articleLead
    ? 'Recommended G&A article lead'
    : (merged.canRender
      ? (STRONG_ARTICLE_QC_KEYS.has(index.key) ? 'Secondary article candidate' : 'Context candidate; overlay QC is moderate')
      : 'Context-only; no implemented Atlas overlay');

  return {
    ...merged,
    platform,
    platformShort,
    legacyAcronym: index.acronym,
    legacyFormula: override.legacyFormula || index.formula,
    legacyPlatform: index.platform,
    legacyPlatformShort: index.platformShort,
    legacyNovelty: index.novelty,
    proposedFormula: override.proposedFormula || index.formula,
    implementedFormula,
    formulaStatus: override.formulaStatus || (merged.canRender ? 'Live screening proxy' : (maturity === 'M2' ? 'Executable but non-live' : 'Formula specified; not implemented in Atlas')),
    capability,
    methodRole,
    contribution,
    contributionStatus: 'Provisional; entry-level prior-art review pending',
    maturity,
    requiredInputs: override.requiredInputs || [merged.platform],
    temporalOperator: override.temporalOperator || (merged.canRender ? 'Single-scene' : 'Declared workflow; not implemented in Atlas'),
    spatialOperator: override.spatialOperator || (merged.canRender ? 'Per-pixel' : 'Declared workflow; not implemented in Atlas'),
    units: override.units || 'Uncalibrated dimensionless screening score',
    calibrationStatus: override.calibrationStatus || 'Uncalibrated',
    validationStatus: 'Not independently evaluated (below V1)',
    eventEvidenceStatus: merged.canRender ? 'Reviewed event context; not performance evidence' : 'Context location only',
    articleSuitability,
    articleAngle: articleLead?.articleAngle || 'Use only with the formula, maturity, and validation caveats shown in Atlas.',
    bookmarkDateRole: 'End of the Atlas WMS search window; not an acquisition timestamp',
    acquisitionTimestamp: articleLead?.acquisitionTimestamp || null,
    acquisitionCloudCover: articleLead?.acquisitionCloudCover || null,
    articleQcStatus: merged.canRender
      ? (STRONG_ARTICLE_QC_KEYS.has(index.key) ? 'Strong overlay at the current bookmark/date in 2026-07-20 WMS QC' : 'Moderate overlay in 2026-07-20 WMS QC')
      : 'Not pixel-QC eligible because the proposed workflow is not implemented',
    formulaVersion: '2.0',
  };
}

export const ATLAS_INDICES = RAW_ATLAS_INDICES.map(reconcileAtlasIndex);
