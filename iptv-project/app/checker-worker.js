(() => {
  'use strict';

  // ─── Internal state ────────────────────────────────────────────────────

  let channelQueue = [];       // { name, urls, routeCount }[]
  let currentIndex = 0;
  let timerId = null;
  let isRunning = false;
  let abortController = null;

  const TEST_INTERVAL_MS = 5_000;   // 1 channel per 5 seconds
  const FETCH_TIMEOUT_MS = 2_500;    // 2.5s abort

  // ─── Message handler ───────────────────────────────────────────────────

  self.onmessage = (event) => {
    const data = event.data || {};
    const type = data.type;

    if (type === 'start') {
      handleStart(data.channels);
    } else if (type === 'pause') {
      handlePause();
    } else if (type === 'resume') {
      handleResume();
    }
  };

  // ─── Commands ──────────────────────────────────────────────────────────

  function handleStart(channels) {
    if (!Array.isArray(channels) || channels.length === 0) return;

    // Build flat queue: one entry per channel, with all its URLs
    channelQueue = channels
      .filter((ch) => ch && (ch.name))
      .map((ch) => {
        const urls = Array.isArray(ch.urls) && ch.urls.length > 0
          ? ch.urls
          : ch.url
            ? [ch.url]
            : [];
        return {
          name: ch.name,
          sourceId: ch.sourceId,
          channelKey: ch.channelKey,
          urls: urls.filter(Boolean),
          routeCount: ch.routeCount || urls.length || 1,
          delay_ms: ch.delay_ms
        };
      })
      .filter((ch) => ch.urls.length > 0);

    // 微调第三步：未测试频道优先扫雷。后台重新初始化测速列表时，
    // 先把从未测速或已失效标记（null / undefined / >= 99999）的频道
    // 全部提到队首，已测出正常延迟的绿/黄/红频道留在队尾。
    channelQueue = prioritizeUntestedChannels(channelQueue);

    currentIndex = 0;
    isRunning = true;

    // Kick off the first test immediately
    runNextTest();
  }

  function handlePause() {
    isRunning = false;

    // Clear the loop timer
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }

    // Abort any in-flight fetch to free the network connection immediately
    if (abortController) {
      try {
        abortController.abort();
      } catch (e) {
        // ignore — abort may already have fired
      }
      abortController = null;
    }
  }

  function handleResume() {
    if (isRunning) return;
    if (channelQueue.length === 0) return;
    isRunning = true;
    runNextTest();
  }

  // ─── Queue priority ────────────────────────────────────────────────────

  function isUntestedChannel(channel) {
    const delay = channel && channel.delay_ms;
    return delay === null || delay === undefined || delay >= 99999;
  }

  function prioritizeUntestedChannels(queue) {
    const untested = [];
    const tested = [];

    queue.forEach((channel) => {
      if (isUntestedChannel(channel)) {
        untested.push(channel);
      } else {
        tested.push(channel);
      }
    });

    return [...untested, ...tested];
  }

  // ─── Test loop ─────────────────────────────────────────────────────────

  async function runNextTest() {
    if (!isRunning || channelQueue.length === 0) return;

    const channel = channelQueue[currentIndex];

    // Advance index for next cycle (round-robin)
    currentIndex = (currentIndex + 1) % channelQueue.length;

    // Test the first (current best) URL of this channel
    const url = channel.urls[0];

    if (!url) {
      // No URL to test — skip and schedule next
      timerId = setTimeout(runNextTest, TEST_INTERVAL_MS);
      return;
    }

    // Perform the lightweight speed test
    const result = await testUrl(url);

    // Send result back to main thread
    self.postMessage({
      type: 'test_result',
      channelName: channel.name,
      urls: channel.urls,
      delay_ms: result.delay_ms,
      success: result.success
    });

    // Schedule next test
    timerId = setTimeout(runNextTest, TEST_INTERVAL_MS);
  }

  // ─── Lightweight speed test ────────────────────────────────────────────

  async function testUrl(url) {
    abortController = new AbortController();
    const startTime = Date.now();

    try {
      // no-cors: most IPTV servers don't set CORS headers.
      // We still get a valid timing measurement from the opaque response.
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        signal: abortController.signal
      });

      const endTime = Date.now();
      abortController = null;

      return {
        delay_ms: Math.round(endTime - startTime),
        success: true
      };
    } catch (error) {
      abortController = null;

      // AbortError = timeout; anything else = network failure
      return {
        delay_ms: -1,
        success: false
      };
    }
  }
})();
