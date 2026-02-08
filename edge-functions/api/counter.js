const RES_CODE = { SUCCESS: 0, FAIL: 1000 };

export async function onRequest(context) {
  const { request } = context;
  
  // Handle CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  if (typeof OPEN_KOUNTER === 'undefined') {
    return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'OPEN_KOUNTER not bound' }), {
      headers: getCorsHeaders(request),
      status: 200
    });
  }

  try {
    const url = new URL(request.url);
    
    if (request.method === 'GET') {
      const target = url.searchParams.get('target');
      if (!target) {
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Missing target' }), {
          headers: getCorsHeaders(request)
        });
      }
      const data = await getCounterData(target);
      const count = data ? data.time : 0;
      return new Response(JSON.stringify({ 
        code: RES_CODE.SUCCESS, 
        data: { 
          time: count, 
          target,
          created_at: data ? data.created_at : 0,
          updated_at: data ? data.updated_at : 0
        } 
      }), {
        headers: getCorsHeaders(request)
      });
    } else if (request.method === 'POST') {
      const body = await request.json();
      const { action, target, requests, value } = body;

      if (action === 'inc') {
        if (!target) throw new Error('Missing target');
        // Check origin for public increment operations
        if (!await checkOriginAllowed(request)) {
          throw new Error('Origin not allowed');
        }
        const newCount = await incrementCount(target);
        await updateIndex(target);
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { time: newCount, target } }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'set') {
        await checkAuth(request);
        if (!target) throw new Error('Missing target');
        if (value === undefined) throw new Error('Missing value');
        
        const oldData = await getCounterData(target);
        const now = Date.now();
        const newData = {
          time: parseInt(value),
          created_at: (oldData && oldData.created_at) ? oldData.created_at : now,
          updated_at: now
        };

        await OPEN_KOUNTER.put(`counter:${target}`, JSON.stringify(newData));
        await updateIndex(target);
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            time: newData.time, 
            target,
            updated_at: newData.updated_at
          } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'delete') {
        await checkAuth(request);
        if (!target) throw new Error('Missing target');
        await OPEN_KOUNTER.delete(`counter:${target}`);
        await removeFromIndex(target);
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { deleted: true, target } }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'list') {
        await checkAuth(request);
        const { page = 1, pageSize = 20 } = body;
        
        const indexKey = 'system:counter_index';
        const indexData = await OPEN_KOUNTER.get(indexKey);
        const index = indexData ? JSON.parse(indexData) : [];
        
        const total = index.length;
        // Calculate reverse-order slice without copying/reversing the entire array
        // Original index: oldest...newest, we want newest first
        const start = (page - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const pageItems = [];
        for (let i = total - 1 - start; i >= Math.max(total - end, 0); i--) {
          pageItems.push(index[i]);
        }
        
        // Fetch counter values in parallel
        const items = await Promise.all(pageItems.map(async (target) => {
          const data = await getCounterData(target);
          return { 
            target, 
            count: data ? data.time : 0,
            created_at: data ? data.created_at : 0,
            updated_at: data ? data.updated_at : 0
          };
        }));
        
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            items, 
            total, 
            page, 
            pageSize,
            totalPages: Math.ceil(total / pageSize)
          } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'get_config') {
        await checkAuth(request);
        const allowedDomainsData = await OPEN_KOUNTER.get('system:allowed_domains');
        const allowedDomains = allowedDomainsData ? JSON.parse(allowedDomainsData) : [];
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { allowedDomains } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'set_config') {
        await checkAuth(request);
        const { allowedDomains } = body;
        if (!Array.isArray(allowedDomains)) throw new Error('allowedDomains must be an array');
        await OPEN_KOUNTER.put('system:allowed_domains', JSON.stringify(allowedDomains));
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { allowedDomains } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'export_all') {
        await checkAuth(request);
        
        // Fetch config and index in parallel
        const [allowedDomainsData, indexData] = await Promise.all([
          OPEN_KOUNTER.get('system:allowed_domains'),
          OPEN_KOUNTER.get('system:counter_index')
        ]);
        const allowedDomains = allowedDomainsData ? JSON.parse(allowedDomainsData) : [];
        const index = indexData ? JSON.parse(indexData) : [];
        
        // Fetch all counter values in parallel, build object directly
        const counterEntries = await Promise.all(index.map(async (target) => {
          const data = await getCounterData(target);
          return [target, data || { time: 0, created_at: 0, updated_at: 0 }];
        }));
        const counters = Object.fromEntries(counterEntries);
        
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            counters,
            allowedDomains,
            timestamp: Date.now(),
            version: '1.0'
          } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'import_all') {
        await checkAuth(request);
        const { data } = body;
        
        if (!data || !data.counters) throw new Error('Invalid import data');
        
        // 1. Clear existing data
        const indexKey = 'system:counter_index';
        const oldIndexData = await OPEN_KOUNTER.get(indexKey);
        if (oldIndexData) {
          const oldIndex = JSON.parse(oldIndexData);
          // Delete old counters
          await Promise.all(oldIndex.map(target => OPEN_KOUNTER.delete(`counter:${target}`)));
        }
        
        // 2. Import Config
        if (Array.isArray(data.allowedDomains)) {
          await OPEN_KOUNTER.put('system:allowed_domains', JSON.stringify(data.allowedDomains));
        }
        
        // 3. Import Counters — single pass: sort, build index, and write KV
        const entries = Object.entries(data.counters);
        
        // Sort entries by updated_at (ascending) so that newest are at the end of the index
        entries.sort((a, b) => {
          const timeA = (typeof a[1] === 'object' && a[1] !== null) ? (a[1].updated_at || 0) : 0;
          const timeB = (typeof b[1] === 'object' && b[1] !== null) ? (b[1].updated_at || 0) : 0;
          return timeA - timeB;
        });

        // Single pass: build index + write all counters in parallel
        const now = Date.now();
        const newIndex = new Array(entries.length);
        const importPromises = new Array(entries.length);
        
        for (let i = 0; i < entries.length; i++) {
          const [target, value] = entries[i];
          newIndex[i] = target;
          
          let storeValue;
          if (typeof value === 'object' && value !== null && 'time' in value) {
            if (!value.updated_at) value.updated_at = now;
            if (!value.created_at) value.created_at = now;
            storeValue = JSON.stringify(value);
          } else {
            storeValue = JSON.stringify({
              time: parseInt(value),
              created_at: now,
              updated_at: now
            });
          }
          importPromises[i] = OPEN_KOUNTER.put(`counter:${target}`, storeValue);
        }
        
        await Promise.all(importPromises);
        
        // 4. Update Index
        await OPEN_KOUNTER.put(indexKey, JSON.stringify(newIndex));
        
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { imported: entries.length } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'batch_inc') {
        if (!Array.isArray(requests)) throw new Error('Invalid requests array');
        // Check origin for public increment operations
        if (!await checkOriginAllowed(request)) {
          throw new Error('Origin not allowed');
        }
        
        // Single pass: increment counters and collect targets
        const results = await Promise.all(requests.map(async (req) => {
           let t = req.target;
           if (!t && req.path) {
             const match = req.path.match(/\/classes\/Counter\/(.+)$/);
             if (match) t = match[1];
           }
           
           if (t) {
             const c = await incrementCount(t);
             return { target: t, time: c };
           }
           return null;
        }));
        
        // Collect unique non-null targets from results directly (no separate array)
        const targetsToUpdate = [];
        const seen = new Set();
        for (let i = 0; i < results.length; i++) {
          if (results[i] && !seen.has(results[i].target)) {
            seen.add(results[i].target);
            targetsToUpdate.push(results[i].target);
          }
        }
        
        if (targetsToUpdate.length > 0) {
          await updateIndexBatch(targetsToUpdate);
        }
        
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: results }), {
          headers: getCorsHeaders(request)
        });
      } else {
         // Default to get if no action or just target provided in body
         if (target) {
            const count = await getCount(target);
            return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { time: count, target } }), {
                headers: getCorsHeaders(request)
            });
         }
         throw new Error('Unknown action');
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: e.message }), {
      headers: getCorsHeaders(request),
      status: 200
    });
  }
}

async function checkAuth(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.split(' ')[1];
  
  // Check against KV stored token
  const storedToken = await OPEN_KOUNTER.get('system:token');
  
  if (!storedToken) {
      if (typeof ADMIN_TOKEN !== 'undefined' && token === ADMIN_TOKEN) {
          return;
      }
      throw new Error('System not initialized or Unauthorized');
  }

  if (token !== storedToken) {
    throw new Error('Unauthorized');
  }
}

async function getCounterData(target) {
  const val = await OPEN_KOUNTER.get(`counter:${target}`);
  if (!val) return null;
  try {
    const data = JSON.parse(val);
    if (typeof data === 'object' && data !== null && 'time' in data) {
      return data;
    }
    // Legacy: plain number stored as string
    return { time: parseInt(val), created_at: 0, updated_at: 0 };
  } catch {
    return { time: parseInt(val || '0'), created_at: 0, updated_at: 0 };
  }
}

async function getCount(target) {
  const data = await getCounterData(target);
  return data ? data.time : 0;
}

async function incrementCount(target) {
  const key = `counter:${target}`;
  const oldData = await getCounterData(target);
  
  const current = oldData ? oldData.time : 0;
  const next = current + 1;
  const now = Date.now();
  
  const newData = {
    time: next,
    created_at: (oldData && oldData.created_at) ? oldData.created_at : now,
    updated_at: now
  };
  
  await OPEN_KOUNTER.put(key, JSON.stringify(newData));
  
  return next;
}

async function updateIndex(target) {
  const indexKey = 'system:counter_index';
  const indexData = await OPEN_KOUNTER.get(indexKey);
  let index = indexData ? JSON.parse(indexData) : [];
  
  const idx = index.indexOf(target);
  if (idx > -1) {
    index.splice(idx, 1);
  }
  index.push(target);
  
  await OPEN_KOUNTER.put(indexKey, JSON.stringify(index));
}

async function updateIndexBatch(targets) {
  if (!targets || targets.length === 0) return;
  const indexKey = 'system:counter_index';
  const indexData = await OPEN_KOUNTER.get(indexKey);
  let index = indexData ? JSON.parse(indexData) : [];
  
  // Use Set for O(1) lookup instead of O(n) array filtering per target
  const targetsSet = new Set(targets);
  index = index.filter(t => !targetsSet.has(t));
  
  // targets are already deduplicated by caller
  index.push(...targets);
  
  await OPEN_KOUNTER.put(indexKey, JSON.stringify(index));
}

async function removeFromIndex(target) {
  const indexKey = 'system:counter_index';
  const indexData = await OPEN_KOUNTER.get(indexKey);
  if (!indexData) return;
  
  let index = JSON.parse(indexData);
  index = index.filter(item => item !== target);
  await OPEN_KOUNTER.put(indexKey, JSON.stringify(index));
}

async function checkOriginAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Allow requests without origin header
  
  const allowedDomainsData = await OPEN_KOUNTER.get('system:allowed_domains');
  if (!allowedDomainsData) return true; // If not configured, allow all
  
  const allowedDomains = JSON.parse(allowedDomainsData);
  if (allowedDomains.length === 0) return true; // Empty list means allow all
  
  // Check if origin matches any allowed domain
  for (let i = 0; i < allowedDomains.length; i++) {
    const domain = allowedDomains[i];
    if (domain === '*' || origin === domain) return true;
    // Support wildcard subdomain: *.example.com
    if (domain.charCodeAt(0) === 42 && domain.charCodeAt(1) === 46) { // '*.'
      if (origin.endsWith(domain.slice(2))) return true;
    }
  }
  return false;
}

function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-LC-Id, X-LC-Key',
    'Access-Control-Max-Age': '600'
  };
}

export default { onRequest };
