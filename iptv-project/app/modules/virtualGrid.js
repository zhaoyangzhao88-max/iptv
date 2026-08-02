import { COLUMNS, ROW_HEIGHT, VIRTUAL_BUFFER, GRID_LEFT_PCT, SETTINGS_KEY } from './constants.js';
import { state, els, loadLocalOverrides, readJsonFromStorage } from './state.js';

// ─── Card creation & recycling ─────────────────────────

export function createCardElement(channel) {
  const card = document.createElement('article');
  card.className = 'channel-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const name = document.createElement('div');
  name.className = 'channel-name';

  const latency = document.createElement('div');
  latency.className = 'latency-badge';

  card.append(name, latency);

  if (channel.logo) {
    const logoImg = document.createElement('img');
    logoImg.className = 'channel-logo';
    logoImg.src = channel.logo;
    logoImg.alt = `${channel.name} 台标`;
    logoImg.loading = 'lazy';
    card.appendChild(logoImg);
  }

  updateCardContent(card, channel);
  card.setAttribute('aria-label', `播放 ${channel.name}`);
  return card;
}

export function updateCardContent(card, channel) {
  const nameEl = card.querySelector('.channel-name');
  const latencyEl = card.querySelector('.latency-badge');
  if (nameEl) nameEl.textContent = channel.name;

  if (latencyEl) {
    const delayMs = channel.delay_ms;
    const isTested = typeof delayMs === 'number' && delayMs >= 0 && delayMs < 99999;

    if (!isTested) {
      latencyEl.className = 'latency-badge untested';
      latencyEl.textContent = '🔘 未测试';
    } else if (delayMs <= 1000) {
      latencyEl.className = 'latency-badge green';
      latencyEl.textContent = `🟢 ${Math.round(delayMs)}ms`;
    } else if (delayMs <= 2500) {
      latencyEl.className = 'latency-badge yellow';
      latencyEl.textContent = `🟡 ${(delayMs / 1000).toFixed(1)}s`;
    } else {
      latencyEl.className = 'latency-badge red';
      latencyEl.textContent = `🔴 ${(delayMs / 1000).toFixed(1)}s`;
    }
  }

  if (channel.logo) {
    let logoEl = card.querySelector('.channel-logo');
    if (!logoEl) {
      logoEl = document.createElement('img');
      logoEl.className = 'channel-logo';
      logoEl.alt = `${channel.name} 台标`;
      logoEl.loading = 'lazy';
      card.appendChild(logoEl);
    }
    if (logoEl.src !== channel.logo) {
      logoEl.src = channel.logo;
    }
  } else {
    const existingLogo = card.querySelector('.channel-logo');
    if (existingLogo) existingLogo.remove();
  }
  card.setAttribute('aria-label', `播放 ${channel.name}`);
}

export function recycleAllCards() {
  state.visibleCardElements.forEach((entry) => {
    entry.el.style.display = 'none';
    state.cardRecyclePool.push(entry.el);
  });
  state.visibleCardElements = [];
}

// ─── Virtual Grid — core engine ────────────────────────

export function updateVirtualGrid() {
  const container = els.channelGrid;
  const channels = state.currentChannels;
  const totalRows = Math.ceil(channels.length / COLUMNS);

  const spacer = container.querySelector('.grid-spacer');
  if (spacer) {
    spacer.style.height = `${totalRows * ROW_HEIGHT}px`;
  }

  if (channels.length > 0) {
    const emptyEl = container.querySelector('.empty-state');
    if (emptyEl) emptyEl.remove();
  }

  if (channels.length === 0) {
    recycleAllCards();
    if (!container.querySelector('.empty-state')) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '当前分类暂无频道';
      container.appendChild(empty);
    }
    return;
  }

  const scrollTop = container.scrollTop;
  const startRow = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleRows = Math.ceil(container.clientHeight / ROW_HEIGHT) + VIRTUAL_BUFFER * 2;
  const endRow = Math.min(startRow + visibleRows, totalRows);

  const startIndex = Math.max(0, startRow * COLUMNS);
  const endIndex = Math.min(channels.length, endRow * COLUMNS);

  state.virtualGridDirty = false;
  state._vgStartIndex = startIndex;
  state._vgEndIndex = endIndex;

  const visibleSet = new Set();
  for (let i = startIndex; i < endIndex; i++) visibleSet.add(i);

  state.visibleCardElements = state.visibleCardElements.filter((entry) => {
    if (visibleSet.has(entry.index)) return true;
    entry.el.style.display = 'none';
    state.cardRecyclePool.push(entry.el);
    return false;
  });

  const currentVisibleSet = new Set(state.visibleCardElements.map((e) => e.index));

  for (let i = startIndex; i < endIndex; i++) {
    if (currentVisibleSet.has(i)) {
      const existingEntry = state.visibleCardElements.find((e) => e.index === i);
      if (existingEntry) {
        if (i === state.channelIndex) {
          existingEntry.el.classList.add('focused');
        } else {
          existingEntry.el.classList.remove('focused');
        }
      }
      continue;
    }

    const channel = channels[i];
    const row = Math.floor(i / COLUMNS);
    const col = i % COLUMNS;

    let card = state.cardRecyclePool.pop();
    if (!card) {
      card = createCardElement(channel);
    } else {
      updateCardContent(card, channel);
    }

    const xPct = GRID_LEFT_PCT[col];
    const yPx = row * ROW_HEIGHT;
    card.style.transform = `translate3d(${xPct}%, ${yPx}px, 0)`;
    card.style.display = '';
    card.dataset.channelIndex = String(i);

    if (i === state.channelIndex) {
      card.classList.add('focused');
    } else {
      card.classList.remove('focused');
    }

    container.appendChild(card);
    state.visibleCardElements.push({ index: i, el: card });
  }
}

// ─── Rendering ─────────────────────────────────────────

export function renderCategories() {
  const fragment = document.createDocumentFragment();
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '分类导航';
  fragment.appendChild(title);

  state.categories.forEach((category, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-item';
    button.dataset.categoryIndex = String(index);
    button.textContent = category.label;
    button.setAttribute('aria-label', `切换到分类：${category.label}`);
    fragment.appendChild(button);
  });

  els.categoryList.replaceChildren(fragment);
}

export function renderChannels() {
  const category = state.categories[state.categoryIndex] || state.categories[0];
  state.currentChannels = category ? category.channels : [];

  state.localOverrides = loadLocalOverrides();
  state.currentChannels = state.currentChannels.filter((channel) => {
    if (channel.hidden) return false;
    const ov = state.localOverrides.channels[channel.channelKey || channel.name] || state.localOverrides.channels[channel.name];
    if (ov && ov.hidden === true) return false;
    // Multicast filter: hide if user disabled multicast display
    if (channel.is_multicast) {
      const settings = readJsonFromStorage(SETTINGS_KEY);
      if (!settings?.showMulticast) return false;
    }
    return true;
  });

  state.currentChannels.sort((a, b) => {
    const delayA = (typeof a.delay_ms === 'number' && a.delay_ms >= 0 && a.delay_ms !== 99999) ? a.delay_ms : 99999;
    const delayB = (typeof b.delay_ms === 'number' && b.delay_ms >= 0 && b.delay_ms !== 99999) ? b.delay_ms : 99999;
    return delayA - delayB;
  });

  if (state.channelIndex >= state.currentChannels.length) {
    state.channelIndex = Math.max(0, state.currentChannels.length - 1);
  }

  state.virtualGridDirty = true;
  recycleAllCards();
  updateVirtualGrid();
}

export function renderChannelGrid() {
  renderChannels();
}

// ─── Focus management ─────────────────────────────────

export function updateCategoryFocus() {
  els.categoryList.querySelectorAll('.category-item.focused').forEach((item) => {
    item.classList.remove('focused');
  });
  const categoryItem = els.categoryList.querySelectorAll('.category-item')[state.categoryIndex];
  if (categoryItem) {
    categoryItem.classList.add('focused');
    categoryItem.scrollIntoView({ block: 'nearest' });
  }
}

export function applyFocus() {
  if (state.activeColumn === 'category') {
    updateCategoryFocus();
    clearActionFocus();
    return;
  }
  if (state.activeColumn === 'action') {
    updateCategoryFocus();
    updateActionFocus();
    return;
  }

  els.channelGrid.querySelectorAll('.channel-card.focused').forEach((card) => {
    card.classList.remove('focused');
  });
  clearActionFocus();

  if (state.currentChannels.length === 0) return;

  const container = els.channelGrid;
  const row = Math.floor(state.channelIndex / COLUMNS);
  const targetY = row * ROW_HEIGHT;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (targetY < viewTop) {
    container.scrollTop = targetY;
  } else if (targetY + ROW_HEIGHT > viewBottom) {
    container.scrollTop = targetY + ROW_HEIGHT - container.clientHeight;
  }

  state.virtualGridDirty = true;
  updateVirtualGrid();
}

export function updateActionFocus() {
  clearActionFocus();
  if (state.actionButtonIndex === 1 && els.btnResetFilters) {
    els.btnResetFilters.classList.add('focused');
  } else if (els.btnDiagnostic) {
    els.btnDiagnostic.classList.add('focused');
  }
}

export function clearActionFocus() {
  if (els.btnDiagnostic) els.btnDiagnostic.classList.remove('focused');
  if (els.btnResetFilters) els.btnResetFilters.classList.remove('focused');
}

export function moveChannelFocus(direction) {
  if (state.currentChannels.length === 0) return;
  const columns = COLUMNS;
  const lastIndex = state.currentChannels.length - 1;
  let nextIndex = state.channelIndex;

  if (direction === 'right') {
    const isLastColumn = state.channelIndex % columns === columns - 1 || state.channelIndex === lastIndex;
    nextIndex = isLastColumn ? state.channelIndex : state.channelIndex + 1;
  }
  if (direction === 'left') {
    const isFirstColumn = state.channelIndex % columns === 0;
    if (isFirstColumn) {
      state.activeColumn = 'category';
      applyFocus();
      return;
    }
    nextIndex = state.channelIndex - 1;
  }
  if (direction === 'down') {
    nextIndex = Math.min(lastIndex, state.channelIndex + columns);
  }
  if (direction === 'up') {
    nextIndex = Math.max(0, state.channelIndex - columns);
  }

  state.channelIndex = nextIndex;
  applyFocus();
}

export function setCategoryIndex(index) {
  if (state.categories.length === 0) return;
  state.categoryIndex = (index + state.categories.length) % state.categories.length;
  state.channelIndex = 0;
  renderChannels();
  updateCategoryFocus();
}

// ─── User interaction ─────────────────────────────────

export function markUserInteraction() {
  state.userHasInteracted = true;
  if (state.lazyAutoplayTimer) {
    window.clearTimeout(state.lazyAutoplayTimer);
    state.lazyAutoplayTimer = null;
    state.lazyAutoplayChannel = null;
  }
}

// ─── DOM element caching ──────────────────────────────

export function cacheElements() {
  els.categoryList = document.getElementById('category-list');
  els.channelGrid = document.getElementById('channel-grid');
  els.playerContainer = document.getElementById('player-container');
  els.video = document.getElementById('video-element');
  els.currentChannel = document.getElementById('current-channel');
  els.currentLatency = document.getElementById('current-latency');
  els.watchDuration = document.getElementById('watch-duration');
  els.btnDiagnostic = document.getElementById('btn-diagnostic');
  els.btnResetFilters = document.getElementById('btn-reset-filters');
  els.diagnosticOverlay = document.getElementById('diagnostic-overlay');
  els.diagnosticProgress = document.getElementById('diagnostic-progress');
  els.diagnosticStatus = document.getElementById('diagnostic-status');

  const missingElements = Object.entries(els)
    .filter(([, element]) => !element)
    .map(([key]) => key);

  if (missingElements.length > 0) {
    throw new Error(`[OWL IPTV] 缺少必要 DOM 元素：${missingElements.join(', ')}`);
  }
}

// ─── Click handlers (use dynamic import for playChannel to avoid circular dep) ──

export function handleCategoryClick(event) {
  const button = event.target.closest('.category-item');
  if (!button) return;
  markUserInteraction();
  state.activeColumn = 'category';
  setCategoryIndex(Number(button.dataset.categoryIndex));
}

export function handleChannelClick(event) {
  const card = event.target.closest('.channel-card');
  if (!card) return;
  const index = Number(card.dataset.channelIndex);
  if (!Number.isFinite(index) || index < 0) return;
  markUserInteraction();
  state.activeColumn = 'channel';
  state.channelIndex = index;
  applyFocus();
  const channel = state.currentChannels[index];
  if (channel) {
    import('./player.js').then(p => p.playChannel(channel));
  }
}
