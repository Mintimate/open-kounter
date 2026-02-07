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
      const count = await getCount(target);
      return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { time: count, target } }), {
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
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { time: newCount, target } }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'set') {
        await checkAuth(request);
        if (!target) throw new Error('Missing target');
        if (value === undefined) throw new Error('Missing value');
        await OPEN_KOUNTER.put(`counter:${target}`, value.toString());
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { time: value, target } }), {
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
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const pageItems = index.slice(start, end);
        
        // Fetch counter values
        const items = await Promise.all(pageItems.map(async (target) => {
          const count = await getCount(target);
          return { target, count };
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
        
        // Get Config
        const allowedDomainsData = await OPEN_KOUNTER.get('system:allowed_domains');
        const allowedDomains = allowedDomainsData ? JSON.parse(allowedDomainsData) : [];
        
        // Get All Counters
        const indexKey = 'system:counter_index';
        const indexData = await OPEN_KOUNTER.get(indexKey);
        const index = indexData ? JSON.parse(indexData) : [];
        
        const counters = {};
        // Fetch all counter values
        await Promise.all(index.map(async (target) => {
          const count = await getCount(target);
          counters[target] = count;
        }));
        
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
        
        // 3. Import Counters
        const newIndex = [];
        const importPromises = Object.entries(data.counters).map(async ([target, count]) => {
          newIndex.push(target);
          await OPEN_KOUNTER.put(`counter:${target}`, count.toString());
        });
        
        await Promise.all(importPromises);
        
        // 4. Update Index
        await OPEN_KOUNTER.put(indexKey, JSON.stringify(newIndex));
        
        return new Response(JSON.stringify({ 
          code: RES_CODE.SUCCESS, 
          data: { imported: newIndex.length } 
        }), {
          headers: getCorsHeaders(request)
        });
      } else if (action === 'batch_inc') {
        if (!Array.isArray(requests)) throw new Error('Invalid requests array');
        // Check origin for public increment operations
        if (!await checkOriginAllowed(request)) {
          throw new Error('Origin not allowed');
        }
        const results = await Promise.all(requests.map(async (req) => {
           // Support LeanCloud style requests or simple objects
           // LeanCloud: { method: 'PUT', path: ..., body: { ... } }
           // Simplified: { target: '...' }
           let t = req.target;
           // Try to parse target from LeanCloud path if present
           if (!t && req.path) {
             // path: /1.1/classes/Counter/site-pv -> extract site-pv? 
             // Actually LeanCloud uses objectId. In our case objectId IS the target key.
             const match = req.path.match(/\/classes\/Counter\/(.+)$/);
             if (match) t = match[1];
           }
           
           if (t) {
             const c = await incrementCount(t);
             return { target: t, time: c };
           }
           return null;
        }));
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
  
  // Fallback to env var if KV not set (migration path) or if user prefers env var
  // But requirement says "First login sets a token", so KV is primary.
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

async function getCount(target) {
  const val = await OPEN_KOUNTER.get(`counter:${target}`);
  return parseInt(val || '0');
}

async function incrementCount(target) {
  const key = `counter:${target}`;
  const val = await OPEN_KOUNTER.get(key);
  const current = parseInt(val || '0');
  const next = current + 1;
  await OPEN_KOUNTER.put(key, next.toString());
  
  // Add to index
  await addToIndex(target);
  
  return next;
}

async function addToIndex(target) {
  const indexKey = 'system:counter_index';
  const indexData = await OPEN_KOUNTER.get(indexKey);
  let index = indexData ? JSON.parse(indexData) : [];
  
  if (!index.includes(target)) {
    index.push(target);
    await OPEN_KOUNTER.put(indexKey, JSON.stringify(index));
  }
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
  return allowedDomains.some(domain => {
    if (domain === '*') return true;
    if (origin === domain) return true;
    // Support wildcard subdomain: *.example.com
    if (domain.startsWith('*.')) {
      const baseDomain = domain.slice(2);
      return origin.endsWith(baseDomain);
    }
    return false;
  });
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
