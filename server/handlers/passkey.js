import crypto from 'crypto'
import express from 'express'

const RES_CODE = { SUCCESS: 0, FAIL: 1000, NOT_FOUND: 1404 }

/**
 * Passkey Handler
 * Adapted from edge-functions/api/passkey.js to use storage interface
 */
export function createPasskeyRouter(storage) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    try {
      const { action, data } = req.body
      
      // Get RP config from request
      const rpConfig = getRPConfig(req)
      
      let result = {}
      
      switch (action) {
        case 'generateRegistrationOptions':
          result = await handleGenerateRegistrationOptions(data, rpConfig, storage)
          break
        case 'verifyRegistration':
          result = await handleVerifyRegistration(data, rpConfig, storage)
          break
        case 'generateAuthenticationOptions':
          result = await handleGenerateAuthenticationOptions(data, rpConfig, storage)
          break
        case 'verifyAuthentication':
          result = await handleVerifyAuthentication(data, rpConfig, storage)
          break
        case 'generateManagementToken':
          result = await handleGenerateManagementToken(data, rpConfig, storage)
          break
        case 'listCredentials':
          result = await handleListCredentials(data, storage)
          break
        case 'deleteCredential':
          result = await handleDeleteCredential(data, storage)
          break
        case 'cancelChallenge':
          result = await handleCancelChallenge(data, storage)
          break
        default:
          result = { code: RES_CODE.FAIL, message: 'Unknown action' }
      }
      
      res.json(result)
    } catch (e) {
      console.error('Passkey error:', e)
      res.json({ code: RES_CODE.FAIL, message: e.message })
    }
  })

  return router
}

// ==================== RP Configuration ====================

function getRPConfig(req) {
  const protocol = req.protocol || 'http'
  const host = req.get('host') || 'localhost'
  const origin = req.get('origin') || `${protocol}://${host}`
  const hostname = new URL(`${protocol}://${host}`).hostname
  const rpID = hostname === 'localhost' ? 'localhost' : hostname
  
  return {
    rpName: 'Open Kounter',
    rpID,
    origin
  }
}

// ==================== Utility Functions ====================

function generateUUID() {
  return crypto.randomUUID().replace(/-/g, '')
}

function base64URLEncode(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function base64URLDecode(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  return Buffer.from(base64 + padding, 'base64')
}

async function generateUserIdFromUsername(username) {
  const hash = crypto.createHash('sha256')
  hash.update(`open-kounter-passkey:${username}`)
  return base64URLEncode(hash.digest())
}

// ==================== Storage Operations ====================

async function kvGet(storage, key) {
  const data = await storage.get(key)
  return data ? JSON.parse(data) : null
}

async function kvSet(storage, key, value, options = {}) {
  await storage.put(key, JSON.stringify(value), options)
}

async function kvDelete(storage, key) {
  await storage.delete(key)
}

// ==================== User Operations ====================

async function getUser(storage, userId) {
  return await kvGet(storage, `passkey:user:${userId}`)
}

async function saveUser(storage, user) {
  await kvSet(storage, `passkey:user:${user.id}`, user)
}

// ==================== Credential Operations ====================

async function getCredential(storage, credentialId) {
  return await kvGet(storage, `passkey:credential:${credentialId}`)
}

async function saveCredential(storage, credential) {
  await kvSet(storage, `passkey:credential:${credential.id}`, credential)
  
  // Update user's credential list
  const user = await getUser(storage, credential.userId)
  if (user) {
    if (!user.credentialIds) {
      user.credentialIds = []
    }
    if (!user.credentialIds.includes(credential.id)) {
      user.credentialIds.push(credential.id)
      await saveUser(storage, user)
    }
  }
}

async function getUserCredentials(storage, userId) {
  const user = await getUser(storage, userId)
  if (!user || !user.credentialIds) return []
  
  const credentials = []
  for (const credId of user.credentialIds) {
    const cred = await getCredential(storage, credId)
    if (cred) {
      credentials.push(cred)
    }
  }
  return credentials
}

async function deleteCredential(storage, credentialId) {
  const credential = await getCredential(storage, credentialId)
  if (!credential) return false
  
  // Remove from user's credential list
  const user = await getUser(storage, credential.userId)
  if (user && user.credentialIds) {
    user.credentialIds = user.credentialIds.filter(id => id !== credentialId)
    await saveUser(storage, user)
  }
  
  await kvDelete(storage, `passkey:credential:${credentialId}`)
  return true
}

// ==================== Challenge Management ====================

async function saveChallenge(storage, challengeId, data) {
  // Challenge expires in 5 minutes
  await kvSet(storage, `passkey:challenge:${challengeId}`, {
    ...data,
    createdAt: Date.now()
  }, { expirationTtl: 300 })
}

async function getAndDeleteChallenge(storage, challengeId) {
  const data = await kvGet(storage, `passkey:challenge:${challengeId}`)
  if (data) {
    await kvDelete(storage, `passkey:challenge:${challengeId}`)

    // Clean up user's challenge pointer
    if (data.userId) {
      try {
        const user = await getUser(storage, data.userId)
        if (user && user.currentChallengeId === challengeId) {
          delete user.currentChallengeId
          await saveUser(storage, user)
        }
      } catch (e) {
        console.error('Challenge cleanup error:', e)
      }
    }
  }
  return data
}

// ==================== Management Token ====================

async function saveManagementToken(storage, tokenId, userId) {
  // Management token expires in 5 minutes
  await kvSet(storage, `passkey:mgmt_token:${tokenId}`, {
    userId,
    createdAt: Date.now()
  }, { expirationTtl: 300 })
}

async function validateManagementToken(storage, tokenId, expectedUserId) {
  const data = await kvGet(storage, `passkey:mgmt_token:${tokenId}`)
  if (!data) return false
  return data.userId === expectedUserId
}

// ==================== Registration Flow ====================

async function handleGenerateRegistrationOptions(data, rpConfig, storage) {
  const { username, token } = data
  
  if (!username || !token) {
    return { code: RES_CODE.FAIL, message: 'Username and token are required' }
  }
  
  // Validate token
  const storedToken = await storage.get('system:token')
  const adminToken = process.env.ADMIN_TOKEN
  const tokenValid = (storedToken && token === storedToken) || (adminToken && token === adminToken)
  
  if (!tokenValid) {
    return { code: RES_CODE.FAIL, message: 'Invalid token' }
  }
  
  // Generate user ID
  const userId = await generateUserIdFromUsername(username)
  
  // Get existing user
  let user = await getUser(storage, userId)
  
  // Clean up old challenge
  if (user && user.currentChallengeId) {
    await kvDelete(storage, `passkey:challenge:${user.currentChallengeId}`)
  }
  
  if (user) {
    // Update user token
    user.token = token
    user.updatedAt = Date.now()
  } else {
    // Create new user
    user = {
      id: userId,
      username,
      token,
      credentialIds: [],
      createdAt: Date.now()
    }
  }
  
  // Generate challenge (32 random bytes)
  const challengeBytes = crypto.randomBytes(32)
  const challenge = base64URLEncode(challengeBytes)
  
  // Generate stable WebAuthn user ID
  const webAuthnUserIdHash = crypto.createHash('sha256')
    .update(`open-kounter-passkey:${username}`)
    .digest()
  const webAuthnUserID = base64URLEncode(webAuthnUserIdHash)
  
  // Build registration options
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
  }
  
  // Save challenge
  const challengeId = generateUUID()
  
  // Record current challenge ID in user object
  user.currentChallengeId = challengeId
  await saveUser(storage, user)
  
  await saveChallenge(storage, challengeId, {
    challenge,
    userId,
    username,
    token,
    webAuthnUserID
  })
  
  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  }
}

async function handleVerifyRegistration(data, rpConfig, storage) {
  const { challengeId, response } = data
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' }
  }
  
  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(storage, challengeId)
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' }
  }
  
  try {
    // Verify clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON)
    const clientData = JSON.parse(clientDataJSON.toString('utf8'))
    
    // Verify challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch')
    }
    
    // Verify origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error(`Origin mismatch: expected ${rpConfig.origin}, got ${clientData.origin}`)
    }
    
    // Verify type
    if (clientData.type !== 'webauthn.create') {
      throw new Error('Invalid operation type')
    }
    
    // Save credential
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
    }
    
    await saveCredential(storage, newCredential)
    
    // Clean up old credentials (implement "replace Passkey" logic)
    const allCredentials = await getUserCredentials(storage, challengeData.userId)
    for (const cred of allCredentials) {
      if (cred.id !== newCredential.id) {
        await deleteCredential(storage, cred.id)
      }
    }
    
    // Update user token
    const user = await getUser(storage, challengeData.userId)
    if (user) {
      user.token = challengeData.token
      user.updatedAt = Date.now()
      await saveUser(storage, user)
    }
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        verified: true,
        credentialId: response.id
      }
    }
  } catch (error) {
    console.error('Registration verification error:', error)
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` }
  }
}

// ==================== Authentication Flow ====================

async function handleGenerateAuthenticationOptions(data, rpConfig, storage) {
  const { username } = data
  
  let allowCredentials = []
  let userId = null
  
  if (username) {
    userId = await generateUserIdFromUsername(username)
    
    // Clean up old challenge
    const user = await getUser(storage, userId)
    if (user && user.currentChallengeId) {
      await kvDelete(storage, `passkey:challenge:${user.currentChallengeId}`)
    }

    const credentials = await getUserCredentials(storage, userId)
    
    if (credentials.length === 0) {
      return { code: RES_CODE.NOT_FOUND, message: 'No passkey found for this user' }
    }
    
    allowCredentials = credentials.map(cred => ({
      id: cred.id,
      type: 'public-key',
      transports: cred.transports || []
    }))
  }
  
  // Generate challenge
  const challengeBytes = crypto.randomBytes(32)
  const challenge = base64URLEncode(challengeBytes)
  
  const options = {
    challenge: challenge,
    timeout: 60000,
    rpId: rpConfig.rpID,
    userVerification: 'preferred',
    allowCredentials
  }
  
  // Save challenge
  const challengeId = generateUUID()
  
  // If associated with user, update currentChallengeId
  if (userId) {
    const user = await getUser(storage, userId)
    if (user) {
      user.currentChallengeId = challengeId
      await saveUser(storage, user)
    }
  }
  
  await saveChallenge(storage, challengeId, {
    challenge,
    userId
  })
  
  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  }
}

async function handleVerifyAuthentication(data, rpConfig, storage) {
  const { challengeId, response } = data
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' }
  }
  
  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(storage, challengeId)
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' }
  }
  
  // Get credential
  const credential = await getCredential(storage, response.id)
  if (!credential) {
    return { code: RES_CODE.FAIL, message: 'Credential not found' }
  }
  
  // Get user
  const user = await getUser(storage, credential.userId)
  if (!user) {
    return { code: RES_CODE.FAIL, message: 'User not found' }
  }
  
  try {
    // Verify clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON)
    const clientData = JSON.parse(clientDataJSON.toString('utf8'))
    
    // Verify challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch')
    }
    
    // Verify origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error('Origin mismatch')
    }
    
    // Verify type
    if (clientData.type !== 'webauthn.get') {
      throw new Error('Invalid operation type')
    }
    
    // Update credential last used time
    credential.lastUsedAt = Date.now()
    await saveCredential(storage, credential)
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        verified: true,
        username: user.username,
        token: user.token
      }
    }
  } catch (error) {
    console.error('Authentication verification error:', error)
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` }
  }
}

// ==================== Management Token ====================

async function handleGenerateManagementToken(data, rpConfig, storage) {
  const { challengeId, response } = data
  
  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' }
  }
  
  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(storage, challengeId)
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' }
  }
  
  // Get credential
  const credential = await getCredential(storage, response.id)
  if (!credential) {
    return { code: RES_CODE.FAIL, message: 'Credential not found' }
  }
  
  // Get user
  const user = await getUser(storage, credential.userId)
  if (!user) {
    return { code: RES_CODE.FAIL, message: 'User not found' }
  }
  
  try {
    // Verify clientData
    const clientDataJSON = base64URLDecode(response.response.clientDataJSON)
    const clientData = JSON.parse(clientDataJSON.toString('utf8'))
    
    // Verify challenge
    if (clientData.challenge !== challengeData.challenge) {
      throw new Error('Challenge mismatch')
    }
    
    // Verify origin
    if (clientData.origin !== rpConfig.origin) {
      throw new Error('Origin mismatch')
    }
    
    // Verify type
    if (clientData.type !== 'webauthn.get') {
      throw new Error('Invalid operation type')
    }
    
    // Generate management token
    const managementToken = generateUUID()
    await saveManagementToken(storage, managementToken, credential.userId)
    
    return {
      code: RES_CODE.SUCCESS,
      data: {
        managementToken,
        username: user.username
      }
    }
  } catch (error) {
    console.error('Management token generation error:', error)
    return { code: RES_CODE.FAIL, message: `Verification failed: ${error.message}` }
  }
}

// ==================== Credential Management ====================

async function handleListCredentials(data, storage) {
  const { username } = data
  
  if (!username) {
    return { code: RES_CODE.FAIL, message: 'Username is required' }
  }
  
  const userId = await generateUserIdFromUsername(username)
  const credentials = await getUserCredentials(storage, userId)
  
  // Return simplified credential info
  const safeCredentials = credentials.map(cred => ({
    id: cred.id,
    deviceType: cred.deviceType,
    backedUp: cred.backedUp,
    createdAt: cred.createdAt,
    lastUsedAt: cred.lastUsedAt
  }))
  
  return {
    code: RES_CODE.SUCCESS,
    data: safeCredentials
  }
}

async function handleDeleteCredential(data, storage) {
  const { credentialId, username, managementToken } = data
  
  if (!credentialId || !username) {
    return { code: RES_CODE.FAIL, message: 'Credential ID and username are required' }
  }
  
  if (!managementToken) {
    return { code: RES_CODE.FAIL, message: 'Management token required' }
  }
  
  // Verify credential belongs to user
  const credential = await getCredential(storage, credentialId)
  if (!credential) {
    return { code: RES_CODE.NOT_FOUND, message: 'Credential not found' }
  }
  
  const userId = await generateUserIdFromUsername(username)
  if (credential.userId !== userId) {
    return { code: RES_CODE.FAIL, message: 'Unauthorized' }
  }
  
  // Validate management token
  const isValid = await validateManagementToken(storage, managementToken, userId)
  if (!isValid) {
    return { code: RES_CODE.FAIL, message: 'Invalid or expired management token' }
  }
  
  await deleteCredential(storage, credentialId)
  
  return {
    code: RES_CODE.SUCCESS,
    data: { deleted: true }
  }
}

async function handleCancelChallenge(data, storage) {
  const { challengeId } = data
  if (challengeId) {
    await getAndDeleteChallenge(storage, challengeId)
  }
  return { code: RES_CODE.SUCCESS, message: 'Challenge cleared' }
}
