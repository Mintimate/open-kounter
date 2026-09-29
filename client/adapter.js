/* global CONFIG, Fluid */

(function(window, document) {
  'use strict';
  
  // Get server URL from config
  const API_SERVER = (CONFIG.web_analytics.openkounter && CONFIG.web_analytics.openkounter.server_url) || '';
  const REQUEST_TIMEOUT_MS = 15000;
  const UV_KEY = 'OpenKounter_UV_Flag';
  
  if (!API_SERVER) {
    console.warn('OpenKounter: server_url is not configured');
    return;
  }

  function requestJson(url, options = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Counter request timed out'));
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    });
    const request = (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error('Counter request failed');
      const result = await response.json();
      if (result.code !== 0) throw new Error('Counter request rejected');
      return result.data;
    })();

    // Bound both the request and response body, even if a transport ignores abort.
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  }

  function isRecord(record, target) {
    return record && record.target === target && Number.isSafeInteger(record.time) && record.time >= 0;
  }

  async function getRecord(target) {
    const record = await requestJson(`${API_SERVER}/api/counter?target=${encodeURIComponent(target)}`);
    if (!isRecord(record, target)) throw new Error('Invalid counter response');
    return record;
  }

  function increment(targets) {
    return requestJson(`${API_SERVER}/api/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch_inc',
        requests: targets.map(target => ({ target }))
      })
    });
  }

  // 校验是否为有效的主机（排除本地开发环境）
  function validHost() {
    const ignoreLocal = CONFIG.web_analytics.openkounter && CONFIG.web_analytics.openkounter.ignore_local;
    if (ignoreLocal !== false) {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return false;
      }
    }
    return true;
  }

  // 校验是否为有效的独立访客（24小时内只计一次）
  function validUV() {
    const now = Date.now();
    
    try {
      const flag = localStorage.getItem(UV_KEY);
      if (flag) {
        const lastVisit = parseInt(flag, 10);
        // 距离上次访问小于 24 小时则不计为新 UV
        if (now - lastVisit <= 86400000) {
          return false;
        }
      }
    } catch (e) {
      // localStorage 不可用时默认计为 UV
      console.warn('OpenKounter: localStorage is not available');
    }
    return true;
  }

  function markUV() {
    try {
      localStorage.setItem(UV_KEY, Date.now().toString());
    } catch (e) {
      console.warn('OpenKounter: localStorage is not available');
    }
  }

  function addCount() {
    const enableIncr = CONFIG.web_analytics.enable && (!window.Fluid || !Fluid.ctx.dnt) && validHost();
    const counters = [];

    function addCounter(target, selector, shouldIncrement) {
      const container = document.querySelector(`${selector}-container`);
      if (container) counters.push({ target, selector, container, shouldIncrement });
    }

    function showRecord(record) {
      counters.filter(counter => counter.target === record.target).forEach(counter => {
        const element = document.querySelector(counter.selector);
        if (element) {
          element.innerText = record.time;
          counter.container.style.display = 'inline';
        }
      });
    }

    addCounter('site-pv', '#openkounter-site-pv', enableIncr);

    // 请求站点 UV 并自增
    const uvCtn = document.querySelector('#openkounter-site-uv-container');
    const incrUV = !!(uvCtn && enableIncr && validUV());
    addCounter('site-uv', '#openkounter-site-uv', incrUV);

    // 请求页面浏览数并自增
    const viewCtn = document.querySelector('#openkounter-page-views-container');
    if (viewCtn) {
      try {
        const pathConfig = CONFIG.web_analytics.openkounter.path || 'window.location.pathname';
        const path = eval(pathConfig);
        const target = decodeURI(path.replace(/\/*(index.html)?$/, '/'));
        if (!target.trim() || target.length > 2048) throw new Error('Invalid page target');
        addCounter(target, '#openkounter-page-views', enableIncr);
      } catch (e) {
        console.error('OpenKounter: invalid page path configuration');
      }
    }

    const incrementTargets = new Set(counters.filter(counter => counter.shouldIncrement).map(counter => counter.target));
    const confirmedTargets = new Set();

    // Send writes immediately; read-only counters must not delay visit recording.
    if (incrementTargets.size > 0) {
      increment([...incrementTargets]).then(records => {
        if (!Array.isArray(records)) throw new Error('Invalid batch response');
        records.forEach(record => {
          if (!record || !incrementTargets.has(record.target) || !isRecord(record, record.target)) return;
          confirmedTargets.add(record.target);
          showRecord(record);
          if (record.target === 'site-uv' && incrUV) markUV();
        });
      }).catch(() => {
        // A failed or timed-out write has an unknown outcome. Never retry automatically.
        console.error('OpenKounter: failed to increment counters');
      });
    }

    const readTargets = new Set(counters.filter(counter => !incrementTargets.has(counter.target)).map(counter => counter.target));
    readTargets.forEach(target => {
      getRecord(target).then(record => {
        if (!confirmedTargets.has(target)) showRecord(record);
      }).catch(() => {
        console.error('OpenKounter: failed to read counter');
      });
    });
  }

  addCount();

})(window, document);
