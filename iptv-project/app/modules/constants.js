// ─── 常量定义 ─────────────────────────────────────────
export const CONFIG = { remote_json_url: '../data/channels.json' };

export const DATA_FALLBACK_URL = '../data/channels.json';
export const LOCAL_OVERRIDES_KEY = 'owl_iptv_local_overrides';
export const WATCH_STATS_KEY = 'owl_iptv_watch_stats';
export const RECOMMENDATION_LIMIT = 10;
export const VALID_VIEW_DELAY_MS = 10_000;
export const DURATION_TICK_MS = 5_000;
export const AUTOPLAY_DELAY_MS = 0;
export const HLS_CONNECTION_TIMEOUT_MS = 1_500;
export const ROUTE_FAILURE_LIMIT = 3;
export const HLS_FATAL_RETRY_LIMIT = 1;
export const FREEZE_DETECT_MS = 2_500;
export const FREEZE_POLL_JITTER_MS = 500;
export const SILENT_MERGE_DELAY_MS = 5_000;
export const LAST_WATCHED_KEY = 'owl_iptv_last_channel';
export const PRELOAD_DELAY_MS = 3_000;

// Settings Keys (Phase 5)
export const SETTINGS_KEY = 'owl_iptv_settings';
export const M3U_SUB_URL_KEY = 'owl_iptv_m3u_sub_url';

// Virtual Grid Constants
export const COLUMNS = 2;
export const ROW_HEIGHT = 160;
export const VIRTUAL_BUFFER = 2;
export const GRID_LEFT_PCT = [1, 51];

// Storage protection (Phase 5)
export const STORAGE_MAX_BYTES = 4 * 1024 * 1024; // 4MB safety limit
export const WATCH_STATS_MAX_ENTRIES = 100;
export const WATCH_STATS_TRIM_TARGET = 50;

// Electron API (safe reference, null in plain browser)
export const electronAPI = window?.electronAPI || null;
