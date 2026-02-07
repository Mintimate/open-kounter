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
    if (request.method === 'POST') {
      const body = await request.json();
      const { token } = body;
      
      if (!token) {
        throw new Error('Missing token');
      }
      
      const existingToken = await OPEN_KOUNTER.get('system:token');
      if (existingToken) {
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Already initialized' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }
      
      await OPEN_KOUNTER.put('system:token', token);
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
