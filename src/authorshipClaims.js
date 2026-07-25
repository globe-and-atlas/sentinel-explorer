// Authorship notes for Atlas records that have an explicit claim written.
//
// Alignment with GSIA preprint v2 (ESS Open Archive, July 2026):
//   * Priority is recorded as NOT ESTABLISHED for every record until an
//     entry-level prior-art dossier exists. The `level` and `strength` fields
//     below are the author's private confidence notes from the v1 era. They are
//     NOT rendered in the interface and must not be quoted as priority
//     evidence — see `renderAuthorshipClaim()` in src/atlas-app.js.
//   * Several `claim` strings describe the PROPOSED workflow (persistence,
//     proximity weighting, ring-pattern scoring, multi-date change). The live
//     layers are single-scene and per-pixel. Read each claim against the
//     record's `implementedFormula`, not its `proposedFormula`.
//   * Records without an entry here render the registry-wide default claim, so
//     all 91 are covered without inventing per-record claims.
export const authorshipClaims = {
  bhdfsi: {
    level: "Strong workflow claim",
    strength: "High",
    claim: "The original contribution is BH-DFSI as a named post-fire debris-flow triage workflow that combines burn severity change, bare-slope gain, root/canopy loss, drainage context, and rainfall-readiness into one civic inspection score.",
    doNotClaim: "This composite does not assert invention of burn severity mapping, NBR/dNBR, BSI, landslide susceptibility mapping, or post-fire debris-flow science.",
    why: "The novelty is the packaged decision logic and civic triage framing, not the individual spectral ingredients."
  },
  peti: {
    level: "Careful proxy claim",
    strength: "Medium",
    claim: "The original contribution is PETI as a Sentinel-2 virtual-phycocyanin decision proxy that uses red/red-edge behavior with turbidity and persistence gates for freshwater bloom triage.",
    doNotClaim: "This composite does not assert direct phycocyanin retrieval, toxin measurement, or first use of red-edge bands for algal bloom monitoring.",
    why: "The original contribution sits in the honest proxy framing and gate logic for sensors without a true phycocyanin band."
  },
  mppdi: {
    level: "Strong rejection-gate claim",
    strength: "High",
    claim: "The original contribution is MP-PDI as a polymer-selective floating-debris screening workflow that pairs debris brightness with explicit Sargassum, vegetation, foam, and turbidity rejection gates.",
    doNotClaim: "This composite does not assert invention of the Floating Debris Index, marine debris mapping, or plastic detection from satellites in general.",
    why: "The original piece is the operational differentiation workflow: polymer-like debris versus common floating false positives."
  },
  // Retained for traceability only. MVPI is a Limn legacy record and is not one
  // of the 91 GSIA entries. Its former "Very High" strength contradicted two
  // things the project already recorded: the July 2026 threshold sweep found no
  // useful produced-water/caliche separation at the tested single-scene support,
  // and Varon et al. (2021) is established prior art for Sentinel-2 methane
  // plume retrieval. Downgraded rather than deleted, per the registry rule that
  // negative and superseded results stay visible.
  mvpi: {
    level: "Superseded claim; retained for traceability",
    strength: "Not asserted",
    claim: "MVPI is a legacy single-scene SWIR ratio screen (B11/B12) with brightness and water/vegetation rejection gates. No priority or performance claim is made for it.",
    doNotClaim: "This composite does not measure methane concentration, detect plumes, identify super-emitters, or establish priority over published Sentinel-2 methane retrieval methods (Varon et al., 2021). A threshold sweep found no useful separation at the tested support.",
    why: "Superseded by the negative result recorded in the project's scientific-status notes; kept so the failure stays inspectable rather than disappearing."
  },
  ttapi: {
    level: "Distinct synthesis claim",
    strength: "Medium-High",
    claim: "The original contribution is TT-API as a named Sentinel-2 triage composite linking thaw exposure, wet anoxic peat darkening, vegetation-edge collapse, and expansion behavior.",
    doNotClaim: "This composite does not assert invention of thermokarst mapping, thaw-slump detection, peatland monitoring, or methane detection.",
    why: "The defensible authorship is the combined anoxic-peat thaw-risk framing, especially the refusal to call it methane retrieval."
  },
  ecaci: {
    level: "Framing claim",
    strength: "Medium",
    claim: "The original contribution is EC-ACI as an optical microclimate-shelter contrast score for comparing evapotranspirative canopy presence against dry impervious exposure.",
    doNotClaim: "This composite does not assert measured air temperature, land-surface temperature, urban heat island discovery, or ownership of impervious-surface mapping.",
    why: "Urban heat remote sensing is crowded; the original contribution is the 10 m shelter-contrast interpretation and communication layer."
  },
  lrdvsi: {
    level: "Strong boundary-zone claim",
    strength: "High",
    claim: "The original contribution is LRD-VSI as a landfill boundary/downstream vegetation-stress workflow focused on chlorosis, moisture loss, red-edge stress, and persistence near waste sites.",
    doNotClaim: "This composite does not assert that Sentinel-2 confirms leachate chemistry, detects landfill gas directly, or invents vegetation stress remote sensing.",
    why: "The original contribution is the waste-boundary decision product and its explicit caution around causation."
  },
  tdrasi: {
    level: "Operational runout claim",
    strength: "Medium-High",
    claim: "The original contribution is TDR-ASI as a mine-runout acid-silt triage composite that scores ferric color, silt behavior, SWIR mineral/mud context, and downstream persistence.",
    doNotClaim: "This composite does not assert invention of acid mine drainage mapping, iron oxide spectral mapping, or tailings-spill detection.",
    why: "The original move is packaging established spectral signals into a runout-path emergency-screening score."
  },
  sfeii: {
    level: "Framing claim",
    strength: "Medium",
    claim: "The original contribution is SF-EII as a tinderbox-style fuel condition workflow: biomass still present, canopy moisture falling, red-edge vitality weakening, and fuel continuity intact.",
    doNotClaim: "This composite does not assert wildfire prediction, live fuel moisture invention, or fire-behavior modeling.",
    why: "The field is mature; the original contribution is the plain-language fuel-readiness composite and conservative interpretation."
  },
  wdacsi: {
    level: "Decision-framing claim",
    strength: "Medium",
    claim: "The original contribution is WDA-CSI as a wetland-edge conflict composite for screening drainage, water loss, crop-green spikes, bare disturbance, and peat-disturbance pressure.",
    doNotClaim: "This composite does not assert invention of wetland classification, agricultural encroachment mapping, or legal violation detection.",
    why: "The novelty is the intrusion-pressure decision frame rather than a static land-cover class."
  },
  cduai: {
    level: "Applied triage claim",
    strength: "Medium",
    claim: "The original contribution is CD-UAI as a reef-proximal siltation triage workflow with shallow-water, cloud/land, deep-water, and benthic-context rejection gates.",
    doNotClaim: "This composite does not assert invention of turbidity mapping, dredging plume mapping, or reef-health assessment.",
    why: "The crowded prior art makes the safe claim an applied sensitive-habitat screening workflow."
  },
  csrc: {
    level: "Strongly defensible public-health claim",
    strength: "Very High",
    claim: "The original contribution is CSRC as a small-water cyanotoxin scum-risk workflow: NDCI plus NIR scum boost, turbidity rejection, floating-vegetation rejection, and persistence for under-monitored ponds, lakes, and reservoirs.",
    doNotClaim: "This composite does not assert toxin measurement, first chlorophyll index, first HAB mapping method, or proof of cyanotoxins from Sentinel-2 alone.",
    why: "This is one of the strongest authorship claims because the public-health decision product is narrow, memorable, and underserved at small-water scale."
  },
  trsi: {
    level: "Strongly defensible emergency-screening claim",
    strength: "Very High",
    claim: "The original contribution is TRSI as a downstream tailings river-shock workflow combining turbidity jump, ferric color shift, mine proximity, and persistence into an emergency screening signal.",
    doNotClaim: "This composite does not assert definitive chemical identification, invention of turbidity mapping, or automated attribution of a mine as the cause.",
    why: "The strength is the decision product: a reusable, transparent river-shock alarm for journalists, NGOs, regulators, and communities."
  },
  lfgvi: {
    level: "Strongly defensible boundary-pattern claim",
    strength: "Very High",
    claim: "The original contribution is LFGVI as a radial landfill-boundary vegetation intrusion workflow using red-edge stress, moisture loss, chlorosis, and ring-pattern scoring around known landfill boundaries.",
    doNotClaim: "This composite does not assert direct methane detection, proof of gas migration, or invention of vegetation stress monitoring.",
    why: "The claim is unusually specific: a modern Sentinel-2 boundary-ring decision product for neglected local environmental health."
  },
  swri: {
    level: "Strongly defensible sanitation claim",
    strength: "Very High",
    claim: "The original contribution is SWRI as a sewage-water release screening workflow that separates suspicious urban-channel discharge behavior from ordinary muddy water using turbidity shock, organic bloom proxy, context, and persistence gates.",
    doNotClaim: "This composite does not assert biochemical confirmation of sewage, pathogen detection, or first water-quality index from Sentinel-2.",
    why: "Sewage-specific optical screening is less standardized than generic turbidity or chlorophyll work, making the named decision workflow strongly original."
  },
  dwci: {
    level: "Strong civic decision claim",
    strength: "High",
    claim: "The original contribution is DWCI as a source-water catchment injury workflow linking upstream bare-soil change, riparian loss, reservoir turbidity, and runoff-path context for small utilities and public-health triage.",
    doNotClaim: "This composite does not assert invention of watershed monitoring, turbidity retrieval, or treatment-plant risk modeling.",
    why: "The original contribution is the source-to-reservoir decision linkage and the civic use case, not the individual layers."
  },
  rrfi: {
    level: "Strong ecological framing claim",
    strength: "High",
    claim: "The original contribution is RRFI as a riparian refuge failure concept: a named ecological warning score for drought collapse of riverbank vegetation, channel water, and bare-bank protection.",
    doNotClaim: "This composite does not assert invention of riparian vegetation monitoring, drought indices, or fish/refuge ecology.",
    why: "The phrase and decision frame are memorable and defensible because they focus on life-support function rather than generic vegetation health."
  },
  epdi: {
    level: "Strong source-to-delivery claim",
    strength: "High",
    claim: "The original contribution is EPDI as an erosion pulse delivery workflow linking newly exposed slopes to downstream sediment pulses and persistence after storms.",
    doNotClaim: "This composite does not assert invention of erosion mapping, bare-soil indices, or turbidity indices.",
    why: "The original part is the delivery chain: source disturbance plus actual downstream expression."
  },
  hsai: {
    level: "Honest vulnerability claim",
    strength: "Medium-High",
    claim: "The original contribution is HSAI as an optical heat-shelter absence score for shade, canopy, surface dryness, imperviousness, and park-access context.",
    doNotClaim: "This composite does not assert retrieved air or surface temperature, heat index, or thermal remote sensing from Sentinel-2.",
    why: "The honesty makes it stronger: it claims vulnerability and shelter absence, not heat measurement."
  }
};
