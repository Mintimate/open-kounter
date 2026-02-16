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

  // Helper: check if ADMIN_TOKEN environment variable is set
  const hasAdminToken = env.ADMIN_TOKEN;

  // Helper: get the effective token (ADMIN_TOKEN takes priority over KV stored token)
  async function getEffectiveToken() {
    if (hasAdminToken) return env.ADMIN_TOKEN;
    return await OPEN_KOUNTER.get('system:token');
  }

  try {
    if (request.method === 'POST') {
      const body = await request.json();
      const { action, token, newToken, managementToken } = body;

      // get_status: return system status info (no auth required)
      if (action === 'get_status') {
        const storedToken = await OPEN_KOUNTER.get('system:token');
        return new Response(JSON.stringify({
          code: RES_CODE.SUCCESS,
          data: {
            hasAdminToken: !!hasAdminToken,
            initialized: !!storedToken
          }
        }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }

      const effectiveToken = await getEffectiveToken();
      
      if (!effectiveToken) {
        return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Not initialized' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }

      // syncAdminToken: overwrite KV token with ADMIN_TOKEN (requires ADMIN_TOKEN auth)
      if (action === 'syncAdminToken') {
        if (!hasAdminToken) {
          return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'ADMIN_TOKEN not configured' }), {
            headers: getCorsHeaders(request),
            status: 200
          });
        }
        if (!token || token !== env.ADMIN_TOKEN) {
          return new Response(JSON.stringify({ code: RES_CODE.FAIL, message: 'Invalid ADMIN_TOKEN' }), {
            headers: getCorsHeaders(request),
            status: 200
          });
        }
        await OPEN_KOUNTER.put('system:token', env.ADMIN_TOKEN);
        return new Response(JSON.stringify({ code: RES_CODE.SUCCESS, message: 'KV token synced with ADMIN_TOKEN' }), {
          headers: getCorsHeaders(request),
          status: 200
        });
      }

      let authorized = false;
      let mgmtTokenKey = null;

      // Verify token (accept both KV stored token and ADMIN_TOKEN)
      if (token && (token === effectiveToken || (hasAdminToken && token === env.ADMIN_TOKEN))) {
        authorized = true;
      }
      // Verify Management Token (Passkey)
      else if (managementToken) {
        mgmtTokenKey = `passkey:mgmt_token:${managementToken}`;
        const mgmtDataStr = await OPEN_KOUNTER.get(mgmtTokenKey);
        if (mgmtDataStr) {
          authorized = true;
        }
      }

      if (authorized) {
        if (newToken) {
          await OPEN_KOUNTER.put('system:token', newToken);
          
          // Delete managementToken to prevent replay
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
