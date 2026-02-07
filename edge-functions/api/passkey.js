/*
 * Open Kounter - Passkey Edge Function
 * 使用 EdgeOne Pages KV 存储 Passkey 凭证与临时 Challenge
 * KV 命名空间：OPEN_KOUNTER
 *
 * 存储结构：
 * - passkey:user:{userId}          - 用户信息（包含 token、credential 列表、以及当前活跃的 challenge 指针）
 * - passkey:credential:{credId}    - 凭证信息（公钥、计数器、创建时间等）
 * - passkey:challenge:{challengeId}- 临时 challenge 存储（用于注册/认证/管理令牌流程，带 TTL）
 */

const VERSION = '1.0.0';

// 响应码
const RES_CODE = {
  SUCCESS: 0,
  FAIL: 1000,
  NOT_FOUND: 1404
};

// RP 配置 - 从请求中动态获取
function getRPConfig(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || `${url.protocol}//${url.host}`;
  const rpID = url.hostname === 'localhost' ? 'localhost' : url.hostname;
  
  return {
    rpName: 'Open Kounter',
    rpID,
    origin
  };
}

/**
 * EdgeOne Pages Edge Function 入口
 */
export async function onRequest(context) {
  const { request } = context;
  
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return handleCors(request);
  }
  
  // GET 请求返回版本信息
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      code: RES_CODE.SUCCESS,
      message: 'Open Kounter Passkey API',
      version: VERSION
    }), {
      headers: getCorsHeaders(request)
    });
  }

  let res = {};
  
  try {
    const body = await request.json();
    const { action, data } = body;
    
    // 验证 KV 存储是否可用
    if (typeof OPEN_KOUNTER === 'undefined') {
      throw new Error('OPEN_KOUNTER KV not bound');
    }
    
    const rpConfig = getRPConfig(request);
    
    switch (action) {
      case 'generateRegistrationOptions':
        res = await handleGenerateRegistrationOptions(data, rpConfig);
        break;
      case 'verifyRegistration':
        res = await handleVerifyRegistration(data, rpConfig);
        break;
      case 'generateAuthenticationOptions':
        res = await handleGenerateAuthenticationOptions(data, rpConfig);
        break;
      case 'verifyAuthentication':
        res = await handleVerifyAuthentication(data, rpConfig);
        break;
      case 'generateManagementToken':
        res = await handleGenerateManagementToken(data, rpConfig);
        break;
      case 'listCredentials':
        res = await handleListCredentials(data);
        break;
      case 'deleteCredential':
        res = await handleDeleteCredential(data);
        break;
      case 'cancelChallenge':
        res = await handleCancelChallenge(data);
        break;
      default:
        res = { code: RES_CODE.FAIL, message: 'Unknown action' };
    }
  } catch (e) {
    console.error('Passkey error:', e.message, e.stack);
    res = { code: RES_CODE.FAIL, message: `Passkey Error: ${e.message}` };
  }
  
  return new Response(JSON.stringify(res), {
    headers: getCorsHeaders(request)
  });
}

// ==================== CORS 处理 ====================

function handleCors(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}

function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

// ==================== 工具函数 ====================

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, () => {
    return (Math.random() * 16 | 0).toString(16);
  });
}

// Base64URL 编解码
function base64URLEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64URLDecode(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ==================== KV 操作封装 ====================

async function kvGet(key) {
  const data = await OPEN_KOUNTER.get(key);
  return data ? JSON.parse(data) : null;
}

async function kvSet(key, value, options = {}) {
  await OPEN_KOUNTER.put(key, JSON.stringify(value), options);
}

async function kvDelete(key) {
  await OPEN_KOUNTER.delete(key);
}

// ==================== 用户相关操作 ====================

async function getUser(userId) {
  return await kvGet(`passkey:user:${userId}`);
}

async function saveUser(user) {
  await kvSet(`passkey:user:${user.id}`, user);
}

async function getUserByCredentialId(credentialId) {
  const credential = await kvGet(`passkey:credential:${credentialId}`);
  if (!credential) return null;
  return await getUser(credential.userId);
}

// ==================== 凭证相关操作 ====================

async function getCredential(credentialId) {
  return await kvGet(`passkey:credential:${credentialId}`);
}

async function saveCredential(credential) {
  await kvSet(`passkey:credential:${credential.id}`, credential);
  
  // 更新用户的凭证列表
  const user = await getUser(credential.userId);
  if (user) {
    if (!user.credentialIds) {
      user.credentialIds = [];
    }
    if (!user.credentialIds.includes(credential.id)) {
      user.credentialIds.push(credential.id);
      await saveUser(user);
    }
  }
}

async function getUserCredentials(userId) {
  const user = await getUser(userId);
  if (!user || !user.credentialIds) return [];
  
  const credentials = [];
  for (const credId of user.credentialIds) {
    const cred = await getCredential(credId);
    if (cred) {
      credentials.push(cred);
    }
  }
  return credentials;
}

async function deleteCredential(credentialId) {
  const credential = await getCredential(credentialId);
  if (!credential) return false;
  
  // 从用户凭证列表中移除
  const user = await getUser(credential.userId);
  if (user && user.credentialIds) {
    user.credentialIds = user.credentialIds.filter(id => id !== credentialId);
    await saveUser(user);
  }
  
  await kvDelete(`passkey:credential:${credentialId}`);
  return true;
}

// ==================== Challenge 管理 ====================

async function saveChallenge(challengeId, data) {
  // Challenge 有效期 5 分钟
  await kvSet(`passkey:challenge:${challengeId}`, {
    ...data,
    createdAt: Date.now()
  }, { expirationTtl: 300 });
}

async function getAndDeleteChallenge(challengeId) {
  const data = await kvGet(`passkey:challenge:${challengeId}`);
  if (data) {
    await kvDelete(`passkey:challenge:${challengeId}`);

    // 如果该 challenge 与用户相关，清理用户对象上的指针
    if (data.userId) {
      try {
        const user = await getUser(data.userId);
        if (user && user.currentChallengeId === challengeId) {
          delete user.currentChallengeId;
          await saveUser(user);
        }
      } catch (e) {
        console.error('getAndDeleteChallenge cleanup error:', e);
      }
    }
  }
  return data;
}

// ==================== 管理令牌 ====================

async function saveManagementToken(tokenId, userId) {
  // 管理令牌有效期 5 分钟
  await kvSet(`passkey:mgmt_token:${tokenId}`, {
    userId,
    createdAt: Date.now()
  }, { expirationTtl: 300 });
}

async function validateManagementToken(tokenId, expectedUserId) {
  const data = await kvGet(`passkey:mgmt_token:${tokenId}`);
  if (!data) return false;
  return data.userId === expectedUserId;
}

// ==================== 注册流程 ====================

async function handleGenerateRegistrationOptions(data, rpConfig) {
  const { username, token } = data;
  
  if (!username || !token) {
    return { code: RES_CODE.FAIL, message: 'Username and token are required' };
  }
  
  // 验证 token 是否有效
  const storedToken = await OPEN_KOUNTER.get('system:token');
  if (!storedToken || token !== storedToken) {
    return { code: RES_CODE.FAIL, message: 'Invalid token' };
  }
  
  // 生成用户 ID
  const userId = await generateUserIdFromUsername(username);
  
  // 获取用户现有凭证
  let user = await getUser(userId);
  
  // 清理旧 Challenge，防止脏数据堆积
  if (user && user.currentChallengeId) {
    await kvDelete(`passkey:challenge:${user.currentChallengeId}`);
  }
  
  if (user) {
    // 更新用户 token
    user.token = token;
    user.updatedAt = Date.now();
  } else {
    // 创建新用户
    user = {
      id: userId,
      username,
      token,
      credentialIds: [],
      createdAt: Date.now()
    };
  }
  
  // 生成 challenge（32 字节随机数）
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = base64URLEncode(challengeBytes);
  
  // 生成稳定的 WebAuthn 用户 ID
  const webAuthnUserIdHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`open-kounter-passkey:${username}`)
  );
  const webAuthnUserID = base64URLEncode(webAuthnUserIdHash);
  
  // 构建注册选项
  const options = {
    rp: {
      name: rpConfig.rpName,
      id: rpConfig.rpID
    },
    user: {
      id: webAuthnUserID,
      name: username,
      displayName: username
    },
    challenge: challenge,
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },  // ES256
      { type: 'public-key', alg: -257 } // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform'
    }
  };
  
  // 保存 challenge
  const challengeId = generateUUID();
  
  // 记录当前 Challenge ID 到用户对象
  user.currentChallengeId = challengeId;
  await saveUser(user);
  
  await saveChallenge(challengeId, {
    challenge,
    userId,
    username,
    token,
    webAuthnUserID
  });
  
  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  };
}

async function handleVerifyRegistration(data, rpConfig) {
  const { challengeId, response } = data;
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' };
  }
  
  // 获取并删除 challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' };
  }
  
  try {
    // 验证 clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    
    // 验证 challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch');
    }
    
    // 验证 origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error(`Origin mismatch: expected ${rpConfig.origin}, got ${clientData.origin}`);
    }
    
    // 验证 type
    if (clientData.type !== 'webauthn.create') {
      throw new Error('Invalid operation type');
    }
    
    // 保存凭证
    const newCredential = {
      id: response.id,
      publicKey: response.response.attestationObject,
      counter: 0,
      transports: response.response.transports || [],
      deviceType: 'multiDevice',
      backedUp: true,
      userId: challengeData.userId,
      webAuthnUserID: challengeData.webAuthnUserID,
      createdAt: Date.now()
    };
    
    await saveCredential(newCredential);
    
    // 清理旧凭证（实现"更换 Passkey"逻辑）
    const allCredentials = await getUserCredentials(challengeData.userId);
    for (const cred of allCredentials) {
      if (cred.id !== newCredential.id) {
        await deleteCredential(cred.id);
      }
    }
    
    // 更新用户 token
    const user = await getUser(challengeData.userId);
    if (user) {
      user.token = challengeData.token;
      user.updatedAt = Date.now();
      await saveUser(user);
    }
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        verified: true,
        credentialId: response.id
      }
    };
  } catch (error) {
    console.error('Registration verification error:', error);
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` };
  }
}

// ==================== 认证流程 ====================

async function handleGenerateAuthenticationOptions(data, rpConfig) {
  const { username } = data;
  
  let allowCredentials = [];
  let userId = null;
  
  if (username) {
    userId = await generateUserIdFromUsername(username);
    
    // 清理旧 Challenge
    const user = await getUser(userId);
    if (user && user.currentChallengeId) {
      await kvDelete(`passkey:challenge:${user.currentChallengeId}`);
    }

    const credentials = await getUserCredentials(userId);
    
    if (credentials.length === 0) {
      return { code: RES_CODE.NOT_FOUND, message: 'No passkey found for this user' };
    }
    
    allowCredentials = credentials.map(cred => ({
      id: cred.id,
      type: 'public-key',
      transports: cred.transports || []
    }));
  }
  
  // 生成 challenge
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = base64URLEncode(challengeBytes);
  
  const options = {
    challenge: challenge,
    timeout: 60000,
    rpId: rpConfig.rpID,
    userVerification: 'preferred',
    allowCredentials
  };
  
  // 保存 challenge
  const challengeId = generateUUID();
  
  // 如果关联了用户，更新 currentChallengeId
  if (userId) {
    const user = await getUser(userId);
    if (user) {
      user.currentChallengeId = challengeId;
      await saveUser(user);
    }
  }
  
  await saveChallenge(challengeId, {
    challenge,
    userId
  });
  
  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  };
}

async function handleVerifyAuthentication(data, rpConfig) {
  const { challengeId, response } = data;
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' };
  }
  
  // 获取并删除 challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' };
  }
  
  // 获取凭证
  const credential = await getCredential(response.id);
  if (!credential) {
    return { code: RES_CODE.FAIL, message: 'Credential not found' };
  }
  
  // 获取用户
  const user = await getUser(credential.userId);
  if (!user) {
    return { code: RES_CODE.FAIL, message: 'User not found' };
  }
  
  try {
    // 验证 clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    
    // 验证 challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch');
    }
    
    // 验证 origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error('Origin mismatch');
    }
    
    // 验证 type
    if (clientData.type !== 'webauthn.get') {
      throw new Error('Invalid operation type');
    }
    
    // 更新凭证使用时间
    credential.lastUsedAt = Date.now();
    await saveCredential(credential);
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        verified: true,
        username: user.username,
        token: user.token
      }
    };
  } catch (error) {
    console.error('Authentication verification error:', error);
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` };
  }
}

// ==================== 生成管理令牌 ====================

async function handleGenerateManagementToken(data, rpConfig) {
  const { challengeId, response } = data;
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' };
  }
  
  // 获取并删除 challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' };
  }
  
  // 获取凭证
  const credential = await getCredential(response.id);
  if (!credential) {
    return { code: RES_CODE.FAIL, message: 'Credential not found' };
  }
  
  // 获取用户
  const user = await getUser(credential.userId);
  if (!user) {
    return { code: RES_CODE.FAIL, message: 'User not found' };
  }
  
  try {
    // 验证 clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    
    // 验证 challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch');
    }
    
    // 验证 origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error('Origin mismatch');
    }
    
    // 验证 type
    if (clientData.type !== 'webauthn.get') {
      throw new Error('Invalid operation type');
    }
    
    // 生成管理令牌
    const managementToken = generateUUID();
    await saveManagementToken(managementToken, credential.userId);
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        managementToken,
        username: user.username
      }
    };
  } catch (error) {
    console.error('Management token generation error:', error);
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` };
  }
}

// ==================== 凭证管理 ====================

async function handleListCredentials(data) {
  const { username } = data;
  
  if (!username) {
    return { code: RES_CODE.FAIL, message: 'Username is required' };
  }
  
  const userId = await generateUserIdFromUsername(username);
  const credentials = await getUserCredentials(userId);
  
  // 返回简化的凭证信息
  const safeCredentials = credentials.map(cred => ({
    id: cred.id,
    deviceType: cred.deviceType,
    backedUp: cred.backedUp,
    createdAt: cred.createdAt,
    lastUsedAt: cred.lastUsedAt
  }));
  
  return {
    code: RES_CODE.SUCCESS,
    data: safeCredentials
  };
}

async function handleDeleteCredential(data) {
  const { credentialId, username, managementToken } = data;
  
  if (!credentialId || !username) {
    return { code: RES_CODE.FAIL, message: 'Credential ID and username are required' };
  }
  
  if (!managementToken) {
    return { code: RES_CODE.FAIL, message: 'Management token required' };
  }
  
  // 验证凭证属于该用户
  const credential = await getCredential(credentialId);
  if (!credential) {
    return { code: RES_CODE.NOT_FOUND, message: 'Credential not found' };
  }
  
  const userId = await generateUserIdFromUsername(username);
  if (credential.userId !== userId) {
    return { code: RES_CODE.FAIL, message: 'Unauthorized' };
  }
  
  // 验证管理令牌
  const isValid = await validateManagementToken(managementToken, userId);
  if (!isValid) {
    return { code: RES_CODE.FAIL, message: 'Invalid or expired management token' };
  }
  
  await deleteCredential(credentialId);
  
  return {
    code: RES_CODE.SUCCESS,
    data: { deleted: true }
  };
}

async function handleCancelChallenge(data) {
  const { challengeId } = data;
  if (challengeId) {
    await getAndDeleteChallenge(challengeId);
  }
  return { code: RES_CODE.SUCCESS, message: 'Challenge cleared' };
}

// ==================== 辅助函数 ====================

async function generateUserIdFromUsername(username) {
  // 使用 SHA-256 生成确定性的用户 ID
  const encoder = new TextEncoder();
  const data = encoder.encode(`open-kounter-passkey:${username}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(hashBuffer);
}

export default { onRequest };
