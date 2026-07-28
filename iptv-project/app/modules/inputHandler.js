import { electronAPI } from './constants.js';
import { state, els, recordUserActivity } from './state.js';
import { toggleFullscreen, pauseCheckerWorker, resumeCheckerWorker,
  syncCheckerWorkerChannels } from './player.js';
import { markUserInteraction, handleCategoryClick, handleChannelClick,
  moveChannelFocus, setCategoryIndex, applyFocus, updateVirtualGrid,
  updateCategoryFocus, renderChannels, renderCategories } from './virtualGrid.js';
import { resetLocalFilters } from './dataLoader.js';

// ─── Toast ────────────────────────────────────────────

function ensureToastElement() {
  let toast = document.getElementById('tv-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'tv-toast';
    document.body.appendChild(toast);
  }
  return toast;
}

export function showTvToast(message) {
  const toast = ensureToastElement();
  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 1500);
}

// ─── Main key dispatcher ──────────────────────────────

export function handleKeyDown(event) {
  if (state.isDiagnosticRunning) return;

  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault();
    import('./settings.js').then(s => s.toggleSettingsModal());
    return;
  }

  if (event.code === 'KeyM') {
    event.preventDefault();
    els.video.muted = !els.video.muted;
    showTvToast(els.video.muted ? '🔇 已静音' : '🔊 恢复音量');
    return;
  }

  if (event.code === 'KeyF') {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      showTvToast('📺 退出全屏');
      return;
    }
    if (state.activeColumn === 'channel') {
      state.activeColumn = 'category';
      applyFocus();
      showTvToast('☰ 返回分类');
      return;
    }
  }

  if (event.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    showTvToast('📺 退出全屏');
    return;
  }

  if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

  if (state.activeColumn === 'category') {
    handleCategoryKeyDown(event);
    return;
  }
  if (state.activeColumn === 'action') {
    handleActionKeyDown(event);
    return;
  }
  handleChannelKeyDown(event);
}

function handleCategoryKeyDown(event) {
  const key = event.key;
  recordUserActivity();

  if (key === 'ArrowDown') {
    event.preventDefault();
    markUserInteraction();
    const lastCategoryIndex = state.categories.length - 1;
    if (state.categoryIndex >= lastCategoryIndex) {
      state.activeColumn = 'action';
      state.actionButtonIndex = 0;
      applyFocus();
    } else {
      setCategoryIndex(state.categoryIndex + 1);
    }
    return;
  }

  if (key === 'ArrowUp') {
    event.preventDefault();
    markUserInteraction();
    setCategoryIndex(state.categoryIndex - 1);
    return;
  }

  if (key === 'ArrowRight') {
    event.preventDefault();
    markUserInteraction();
    state.activeColumn = 'channel';
    state.channelIndex = 0;
    applyFocus();
  }
}

function handleChannelKeyDown(event) {
  const key = event.key;
  recordUserActivity();

  if (key === 'ArrowRight') {
    event.preventDefault();
    markUserInteraction();
    moveChannelFocus('right');
    return;
  }
  if (key === 'ArrowLeft') {
    event.preventDefault();
    markUserInteraction();
    moveChannelFocus('left');
    return;
  }
  if (key === 'ArrowDown') {
    event.preventDefault();
    markUserInteraction();
    moveChannelFocus('down');
    return;
  }
  if (key === 'ArrowUp') {
    event.preventDefault();
    markUserInteraction();
    moveChannelFocus('up');
    return;
  }
  if (key === 'Enter') {
    event.preventDefault();
    markUserInteraction();
    const channel = state.currentChannels[state.channelIndex];
    if (channel) {
      import('./player.js').then(p => p.playChannel(channel));
    }
  }
}

function handleActionKeyDown(event) {
  const key = event.key;
  recordUserActivity();

  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    event.preventDefault();
    markUserInteraction();
    state.actionButtonIndex = state.actionButtonIndex === 0 ? 1 : 0;
    applyFocus();
    return;
  }

  if (key === 'ArrowUp') {
    event.preventDefault();
    markUserInteraction();
    state.activeColumn = 'category';
    applyFocus();
    return;
  }

  if (key === 'ArrowDown') {
    event.preventDefault();
    markUserInteraction();
    state.activeColumn = 'channel';
    state.channelIndex = 0;
    applyFocus();
    return;
  }

  if (key === 'Enter') {
    event.preventDefault();
    markUserInteraction();
    if (state.actionButtonIndex === 0 && els.btnDiagnostic) {
      els.btnDiagnostic.click();
    } else if (state.actionButtonIndex === 1 && els.btnResetFilters) {
      els.btnResetFilters.click();
    }
  }
}

// ─── Event binding ────────────────────────────────────

export function bindEvents() {
  document.addEventListener('keydown', handleKeyDown);
  els.categoryList.addEventListener('click', handleCategoryClick);
  els.channelGrid.addEventListener('click', handleChannelClick);
  els.playerContainer.addEventListener('dblclick', toggleFullscreen);

  if (els.btnDiagnostic) {
    els.btnDiagnostic.addEventListener('click', () => {
      markUserInteraction();
      import('./diagnostic.js').then(d => d.runCategoryDiagnostic());
    });
  }

  if (els.btnResetFilters) {
    els.btnResetFilters.addEventListener('click', () => {
      markUserInteraction();
      resetLocalFilters();
      renderCategories();
      renderChannels();
      applyFocus();
    });
  }

  // Virtual grid: re-render visible cards on scroll (rAF-throttled)
  els.channelGrid.addEventListener('scroll', () => {
    if (state._scrollRAF) return;
    state._scrollRAF = requestAnimationFrame(() => {
      state._scrollRAF = null;
      updateVirtualGrid();
    });
  });

  // Re-calculate on window resize
  window.addEventListener('resize', () => {
    state.virtualGridDirty = true;
    updateVirtualGrid();
  });

  // Worker interlock: resume background speed tests when playback stops
  els.video.addEventListener('pause', () => { resumeCheckerWorker(); });
  els.video.addEventListener('ended', () => { resumeCheckerWorker(); });

  // Window control buttons
  const btnWinMin = document.getElementById('btn-win-min');
  const btnWinClose = document.getElementById('btn-win-close');
  if (btnWinMin) {
    btnWinMin.addEventListener('click', () => {
      if (electronAPI) electronAPI.minimizeWindow();
    });
  }
  if (btnWinClose) {
    btnWinClose.addEventListener('click', () => {
      if (electronAPI) electronAPI.closeWindow();
    });
  }

  // Settings button
  const btnWinSettings = document.getElementById('btn-win-settings');
  if (btnWinSettings) {
    btnWinSettings.addEventListener('click', () => {
      import('./settings.js').then(s => s.toggleSettingsModal());
    });
  }

  // Settings modal close
  const btnSettingsClose = document.getElementById('btn-settings-close');
  if (btnSettingsClose) {
    btnSettingsClose.addEventListener('click', () => {
      import('./settings.js').then(s => s.toggleSettingsModal());
    });
  }

  // Click outside modal to close
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay) {
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) {
        import('./settings.js').then(s => s.toggleSettingsModal());
      }
    });
  }
}
