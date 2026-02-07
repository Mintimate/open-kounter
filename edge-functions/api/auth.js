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
      const { token, newToken, managementToken } = body;
      const storedToken = await OPEN_KOUNTER.get('system:token');
      
      if (!storedToken) {
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Not initialized' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }

      let authorized = false;
      let mgmtTokenKey = null;

      // 验证旧 Token
      if (token && token === storedToken) {
        authorized = true;
      }
      // 验证 Management Token (Passkey)
      else if (managementToken) {
        mgmtTokenKey = `passkey:mgmt_token:${managementToken}`;
        const mgmtDataStr = await OPEN_KOUNTER.get(mgmtTokenKey);
        if (mgmtDataStr) {
          authorized = true;
          // 可选：验证是否过期，但 KV TTL 会自动处理过期
        }
      }

      if (authorized) {
        if (newToken) {
          await OPEN_KOUNTER.put('system:token', newToken);
          
          // 如果使用了 managementToken，删除它以防止重放
          if (mgmtTokenKey) {
            await OPEN_KOUNTER.delete(mgmtTokenKey);
          }

          return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, message: 'Token updated' }), {
            headers: getCorsHeaders(request),
            status: 200
          });
        }

        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, data: { authorized: true } }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      } else {
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Invalid token or unauthorized' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }
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
