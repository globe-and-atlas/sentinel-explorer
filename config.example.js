// Copy this file to config-v1.js and fill in your real credentials.
// config-v1.js is gitignored — never commit real credentials.
//
// COG is the default imagery provider because Limn demos should not spend
// Sentinel Hub credits and should avoid GEE's interactive tile latency.
// Keep real Earth Engine service-account credentials on your backend only
// if you opt into IMAGE_PROVIDER: "gee".
window.CONFIG = {
    IMAGE_PROVIDER: "cog", // "cog", "gee", or "sentinelhub" with ALLOW_SENTINEL_FALLBACK=true
    GEE_TILE_ENDPOINT: "/api/gee/tiles",
    COG_TILE_ENDPOINT: "/api/cog/tiles",
    ATLAS_GEE_TILE_ENDPOINT: "/api/gee/tiles",
    GEE_API_KEY: "YOUR_OPTIONAL_GEE_BROWSER_API_KEY_HERE",
    ALLOW_SENTINEL_FALLBACK: false,
    SENTINEL_CREDIT_GUARD: true,
    SENTINEL_LIVE_TILES: false,
    SENTINEL_MIN_ZOOM: 14,
    // The bundled AGRICULTURE WMS layer is S2 L1C and does not expose SCL.
    // Set true only for a Sentinel Hub WMS configuration backed by S2 L2A.
    SENTINEL_WMS_SUPPORTS_SCL: false,
    // Optional Atlas-specific overrides. If omitted, Atlas uses the shared
    // Sentinel guard settings above.
    ATLAS_SENTINEL_CREDIT_GUARD: true,
    ATLAS_SENTINEL_LIVE_TILES: false,
    ATLAS_SENTINEL_MIN_ZOOM: 14,
    ATLAS_WMS_SOURCE: "configured", // "configured" or "viewer"; the Atlas HUD can switch this per session
    // Optional alternate WMS source. Blank uses Limn's built-in alternate
    // Sentinel Hub OGC WMS configuration id. Override with a real WMS
    // configuration instance id or full WMS URL; Copernicus Browser/Viewer ids
    // that begin with "sh-" are not accepted by the OGC WMS endpoint.
    ATLAS_VIEWER_INSTANCE_ID: "",
    ATLAS_VIEWER_WMS_URL: "",

    // Optional Sentinel Hub / CDSE fallback credentials.
    // Get credentials at: https://dataspace.copernicus.eu/ → Dashboard → OAuth Clients
    CDSE_CLIENT_ID: "YOUR_COPERNICUS_CLIENT_ID_HERE",
    CDSE_CLIENT_SECRET: "YOUR_COPERNICUS_CLIENT_SECRET_HERE",

    // Optional Sentinel Hub WMS settings (shared by Limn and Atlas).
    // Leave blank to use the built-in Limn Atlas fallback WMS endpoint.
    SH_WMS_URL: "",
    // Layer name to request from your Sentinel Hub instance. The bundled default,
    // "AGRICULTURE", is Sentinel-2 L1C (no SCL band, top-of-atmosphere reflectance).
    // If you add your own Sentinel-2 L2A layer in the Sentinel Hub Configuration
    // Utility (Source: "Sentinel-2 - L2A"), set its layer name here AND flip
    // SENTINEL_WMS_SUPPORTS_SCL above to true — L2A surface reflectance is what the
    // produced-water/salinity index formulas are actually defined on.
    SH_WMS_LAYER: "AGRICULTURE",
    ATLAS_WMS_LAYER: "AGRICULTURE"
};
