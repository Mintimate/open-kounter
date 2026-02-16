const RES_CODE = { SUCCESS: 0, FAIL: 1000 };

export async function onRequest(context) {
  const { request, env } = context;
  
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
    if (request.method === 'POST') {
      const body = await request.json();
      const { token } = body;
      
      // If ADMIN_TOKEN is set, use it as the authoritative token
      const hasAdminToken = env.ADMIN_TOKEN;
      const initToken = hasAdminToken ? env.ADMIN_TOKEN : token;
      
      if (!initToken) {
        throw new Error('Missing token');
      }
      
      const existingToken = await OPEN_KOUNTER.get('system:token');
      if (existingToken) {
        // If ADMIN_TOKEN is set and differs from stored token, sync it
        if (hasAdminToken && existingToken !== env.ADMIN_TOKEN) {
          await OPEN_KOUNTER.put('system:token', env.ADMIN_TOKEN);
          return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { message: 'Token synced with ADMIN_TOKEN' } }), {
            headers: getCorsHeaders(request),
            status: 200
          });
        }
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Already initialized' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }
      
      await OPEN_KOUNTER.put('system:token', initToken);
      return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { message: 'Initialized successfully' } }), {
        headers: getCorsHeaders(request),
        status: 200
      });
    } else {
      throw new Error('Method not allowed');
    }
  } catch (e) {
    return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: e.message }), {
      headers: getCorsHeaders(request),
      status: 200
    });
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

export default { onRequest };
