/**
 * settings.js — Settings module for OwlIPTV
 * Manages the glassmorphism settings modal, multicast toggle,
 * custom M3U URL, route strategy, and cache clearing.
 */
import {
  SETTINGS_KEY, M3U_SUB_URL_KEY,
  WATCH_STATS_KEY, LOCAL_OVERRIDES_KEY, LAST_WATCHED_KEY
} from './constants.js';
import { readJsonFromStorage, writeJsonToStorage } from './state.js';

// ─── Load/Save ─────────────────────────────────────────

export function loadSettings() {
  const saved = readJsonFromStorage(SETTINGS_KEY);
  return {
    showMulticast: saved?.showMulticast ?? false,
    routeStrategy: saved?.routeStrategy ?? 'latency-first',
    m3uSubUrl: saved?.m3uSubUrl ?? '',
  };
}

export function saveSettings(newSettings) {
  const current = loadSettings();
  const merged = { ...current, ...newSettings };
  writeJsonToStorage(SETTINGS_KEY, merged);
  return merged;
}

// ─── Modal Toggle ──────────────────────────────────────

export function toggleSettingsModal() {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  const isVisible = overlay.style.display === 'flex';
  if (isVisible) {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
    // Apply current settings to form elements
    applySettingsToForm();
  }
}

function applySettingsToForm() {
  const settings = loadSettings();
  const toggleMulticast = document.getElementById('toggle-multicast');
  if (toggleMulticast) toggleMulticast.checked = settings.showMulticast;
  const selectStrategy = document.getElementById('select-route-strategy');
  if (selectStrategy) selectStrategy.value = settings.routeStrategy;
  const inputM3U = document.getElementById('input-m3u-url');
  if (inputM3U && settings.m3uSubUrl) inputM3U.value = settings.m3uSubUrl;
}

// ─── Settings Actions ──────────────────────────────────

export function handleMulticastToggle() {
  const toggleMulticast = document.getElementById('toggle-multicast');
  if (!toggleMulticast) return;
  saveSettings({ showMulticast: toggleMulticast.checked });
  // Re-render channel grid with filter applied
  import('./virtualGrid.js').then(vg => {
    vg.renderChannels();
    vg.applyFocus();
  });
}

export function handleRouteStrategyChange() {
  const selectStrategy = document.getElementById('select-route-strategy');
  if (!selectStrategy) return;
  saveSettings({ routeStrategy: selectStrategy.value });
  import('./inputHandler.js').then(ih => ih.showTvToast('路由策略已更新'));
}

export async function applyM3UUrl() {
  const inputM3U = document.getElementById('input-m3u-url');
  if (!inputM3U) return { ok: false, count: 0 };
  const url = inputM3U.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    import('./inputHandler.js').then(ih => ih.showTvToast('请输入有效的 http(s) M3U 地址'));
    return { ok: false, count: 0 };
  }
  saveSettings({ m3uSubUrl: url });
  const [dataLoader, inputHandler] = await Promise.all([
    import('./dataLoader.js'),
    import('./inputHandler.js')
  ]);
  const result = await dataLoader.fetchAndMergeRemoteChannels(url);
  inputHandler.showTvToast(result.ok ? `私有源已加载：${result.count} 个频道` : '私有源加载失败');
  return result;
}

export function clearAllCache() {
  const storage = window.localStorage;
  if (!storage) return;
  const keysToClear = [WATCH_STATS_KEY, LOCAL_OVERRIDES_KEY, LAST_WATCHED_KEY];
  keysToClear.forEach(key => {
    try { storage.removeItem(key); } catch (e) { /* ignore */ }
  });
  import('./inputHandler.js').then(ih => ih.showTvToast('🗑️ 缓存已清除'));
  toggleSettingsModal();
}

// ─── Init ──────────────────────────────────────────────

export function initSettings() {
  const toggleMulticast = document.getElementById('toggle-multicast');
  if (toggleMulticast) {
    toggleMulticast.addEventListener('change', handleMulticastToggle);
  }
  const selectStrategy = document.getElementById('select-route-strategy');
  if (selectStrategy) {
    selectStrategy.addEventListener('change', handleRouteStrategyChange);
  }
  const btnApplyM3U = document.getElementById('btn-apply-m3u');
  if (btnApplyM3U) {
    btnApplyM3U.addEventListener('click', applyM3UUrl);
  }
  const btnClearCache = document.getElementById('btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', () => {
      if (confirm('确定要清除所有缓存数据吗？此操作不可撤销。')) {
        clearAllCache();
      }
    });
  }
}
