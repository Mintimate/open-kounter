/* global CONFIG, Fluid */
// eslint-disable-next-line no-console

(function(window, document) {
  // Configuration for EdgeOne
  // You need to add 'edgeone' config in your Hexo _config.yml or theme config
  // web_analytics:
  //   edgeone:
  //     server_url: "https://your-function-domain.edgeone.pages.dev"
  
  const API_SERVER = (CONFIG.web_analytics.edgeone && CONFIG.web_analytics.edgeone.server_url) || ''; 

  function getRecord(target) {
    return fetch(`${API_SERVER}/api/counter?target=${encodeURIComponent(target)}`)
      .then(resp => resp.json())
      .then(({ data, code, message }) => {
        if (code !== 0) {
          throw new Error(message);
        }
        // Adapt to expected format: { time: number, objectId: target }
        return { time: data.time, objectId: data.target };
      })
      .catch(error => {
        console.error('Counter Error: ', error);
        throw error;
      });
  }

  function increment(incrArr) {
    return fetch(`${API_SERVER}/api/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch_inc',
        requests: incrArr
      })
    }).then(res => res.json())
      .then(res => {
        if (res.code !== 0) throw new Error(res.message);
        return res.data;
      })
      .catch(error => {
        console.error('Failed to save visitor count: ', error);
        throw error;
      });
  }

  function buildIncrement(objectId) {
    // We just need the target (which is the objectId in our system)
    return { target: objectId };
  }

  // 校验是否为有效的 Host
  function validHost() {
    // Reuse leancloud ignore_local config if available, or default to true
    if (CONFIG.web_analytics.leancloud && CONFIG.web_analytics.leancloud.ignore_local) {
      var hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return false;
      }
    }
    return true;
  }

  // 校验是否为有效的 UV
  function validUV() {
    var key = 'EdgeOne_UV_Flag';
    var flag = localStorage.getItem(key);
    if (flag) {
      // 距离标记小于 24 小时则不计为 UV
      if (new Date().getTime() - parseInt(flag, 10) <= 86400000) {
        return false;
      }
    }
    localStorage.setItem(key, new Date().getTime().toString());
    return true;
  }

  function addCount() {
    var enableIncr = CONFIG.web_analytics.enable && (!window.Fluid || !Fluid.ctx.dnt) && validHost();
    var getterArr = [];
    var incrArr = [];

    // 请求 PV 并自增
    var pvCtn = document.querySelector('#leancloud-site-pv-container');
    if (pvCtn) {
      var pvGetter = getRecord('site-pv').then((record) => {
        enableIncr && incrArr.push(buildIncrement(record.objectId));
        var ele = document.querySelector('#leancloud-site-pv');
        if (ele) {
          ele.innerText = (record.time || 0) + (enableIncr ? 1 : 0);
          pvCtn.style.display = 'inline';
        }
      });
      getterArr.push(pvGetter);
    }

    // 请求 UV 并自增
    var uvCtn = document.querySelector('#leancloud-site-uv-container');
    if (uvCtn) {
      var uvGetter = getRecord('site-uv').then((record) => {
        var incrUV = validUV() && enableIncr;
        incrUV && incrArr.push(buildIncrement(record.objectId));
        var ele = document.querySelector('#leancloud-site-uv');
        if (ele) {
          ele.innerText = (record.time || 0) + (incrUV ? 1 : 0);
          uvCtn.style.display = 'inline';
        }
      });
      getterArr.push(uvGetter);
    }

    // 如果有页面浏览数节点，则请求浏览数并自增
    var viewCtn = document.querySelector('#leancloud-page-views-container');
    if (viewCtn) {
      var pathConfig = (CONFIG.web_analytics.leancloud && CONFIG.web_analytics.leancloud.path) || 'window.location.pathname';
      var path = eval(pathConfig);
      var target = decodeURI(path.replace(/\/*(index.html)?$/, '/'));
      var viewGetter = getRecord(target).then((record) => {
        enableIncr && incrArr.push(buildIncrement(record.objectId));
        var ele = document.querySelector('#leancloud-page-views');
        if (ele) {
          ele.innerText = (record.time || 0) + (enableIncr ? 1 : 0);
          viewCtn.style.display = 'inline';
        }
      });
      getterArr.push(viewGetter);
    }

    // 如果启动计数自增，批量发起自增请求
    if (enableIncr) {
      Promise.all(getterArr).then(() => {
        incrArr.length > 0 && increment(incrArr);
      });
    }
  }

  addCount();

})(window, document);
