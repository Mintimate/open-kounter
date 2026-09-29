import { randomUUID } from 'node:crypto'

import { verifyRegistrationResponse } from '@simplewebauthn/server'

import {
  consumeTransientJson,
  deleteJson,
  legacyMigrationLockKey,
  passkeyChallengeKey,
  passkeyCredentialKey,
  passkeyManagementTokenKey,
  passkeyUserKey,
  passkeyUserLockKey,
  readJson,
  withBlobLock,
  writeJson
} from './_blobStore.js'
import {
  consumeManagementToken,
  createStore,
  getEffectiveToken,
  jsonResponse,
  optionsResponse,
  RES_CODE,
  validateTokenValue
} from './_api.js'

import { getPasskeyConfig, verifyPasskeyAssertion } from './_passkey.js'

const VERSION = '2.0.0'
const TRANSIENT_TTL_MS = 5 * 60 * 1000

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return optionsResponse(request)
  }

  if (request.method !== 'POST') {
    return jsonResponse(request, {
      code: RES_CODE.SUCCESS,
      message: 'Open Kounter Passkey API',
      version: VERSION
    })
  }

  try {
    const store = createStore(context)
    const rpConfig = getPasskeyConfig(request, env)
    const body = await request.json()
    const { action, data = {} } = body

    let result
    switch (action) {
      case 'generateRegistrationOptions':
        result = await handleGenerateRegistrationOptions(store, data, rpConfig, env)
        break
      case 'verifyRegistration':
        result = await handleVerifyRegistration(store, data, rpConfig, env)
        break
      case 'generateAuthenticationOptions':
        result = await handleGenerateAuthenticationOptions(store, data, rpConfig)
        break
      case 'verifyAuthentication':
        result = await handleVerifyAuthentication(store, data, rpConfig, env)
        break
      case 'generateManagementToken':
        result = await handleGenerateManagementToken(store, data, rpConfig)
        break
      case 'listCredentials':
        result = await handleListCredentials(store, data)
        break
      case 'deleteCredential':
        result = await handleDeleteCredential(store, data)
        break
      case 'cancelChallenge':
        result = await handleCancelChallenge(store, data)
        break
      default:
        result = { code: RES_CODE.FAIL, message: 'Unknown action' }
    }

    return jsonResponse(request, result)
  } catch (error) {
    console.error('Passkey error:', error.message, error.stack)
    return jsonResponse(request, {
      code: RES_CODE.FAIL,
      message: `Passkey Error: ${error.message}`
    })
  }
}

async function getUser(store, userId) {
  return await readJson(store, passkeyUserKey(userId))
}

async function saveUser(store, user) {
  await writeJson(store, passkeyUserKey(user.id), user)
}

async function updateUser(store, userId, updater) {
  return withBlobLock(store, passkeyUserLockKey(userId), async () => {
    const current = await getUser(store, userId)
    const next = await updater(current)
    if (next) {
      await saveUser(store, next)
    }
    return next
  })
}

async function getCredential(store, credentialId) {
  return await readJson(store, passkeyCredentialKey(credentialId))
}

async function getUserCredentials(store, userId) {
  const user = await getUser(store, userId)
  if (!user || !Array.isArray(user.credentialIds)) {
    return []
  }

  const credentials = await Promise.all(user.credentialIds.map((credentialId) => getCredential(store, credentialId)))
  return credentials.filter(Boolean)
}

async function deleteCredential(store, credentialId) {
  const credential = await getCredential(store, credentialId)
  if (!credential) {
    return false
  }

  await updateUser(store, credential.userId, (user) => {
    if (!user) {
      return null
    }
    return {
      ...user,
      credentialIds: Array.isArray(user.credentialIds)
        ? user.credentialIds.filter((id) => id !== credentialId)
        : []
    }
  })

  await deleteJson(store, passkeyCredentialKey(credentialId))
  return true
}

async function saveChallenge(store, challengeId, data) {
  await writeJson(store, passkeyChallengeKey(challengeId), {
    ...data,
    createdAt: Date.now(),
    expiresAt: Date.now() + TRANSIENT_TTL_MS
  }, { onlyIfNew: true })
}

function validateChallengeId(challengeId) {
  if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(challengeId)) {
    throw new Error('Invalid challenge ID')
  }
  return challengeId
}

async function clearLegacyChallengeReference(store, userId, challengeId) {
  if (userId) {
    const current = await getUser(store, userId)
    if (current?.currentChallengeId !== challengeId) return
    await updateUser(store, userId, (user) => {
      if (!user || user.currentChallengeId !== challengeId) {
        return null
      }

      const next = { ...user }
      delete next.currentChallengeId
      return next
    })
  }

}

async function getAndDeleteChallenge(store, challengeId) {
  validateChallengeId(challengeId)
  const data = await consumeTransientJson(store, passkeyChallengeKey(challengeId))
  if (data) await clearLegacyChallengeReference(store, data.userId, challengeId)
  return data
}

async function saveManagementToken(store, tokenId, userId) {
  await writeJson(store, passkeyManagementTokenKey(tokenId), {
    userId,
    verificationVersion: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + TRANSIENT_TTL_MS
  })
}

async function handleGenerateRegistrationOptions(store, data, rpConfig, env) {
  const { username, token } = data

  if (!username || !token) {
    return { code: RES_CODE.FAIL, message: 'Username and token are required' }
  }

  await validateTokenValue(token, store, env)

  const userId = await generateUserIdFromUsername(username)

  const challengeBytes = new Uint8Array(32)
  crypto.getRandomValues(challengeBytes)
  const challenge = base64URLEncode(challengeBytes)
  const webAuthnUserIdHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`open-kounter-passkey:${username}`)
  )
  const webAuthnUserID = base64URLEncode(webAuthnUserIdHash)

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
    challenge,
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 }
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
      authenticatorAttachment: 'platform'
    }
  }

  const challengeId = generateUUID()
  // Creating one ceremony must not invalidate any other request's challenge.
  await updateUser(store, userId, (user) => ({
    ...(user || { id: userId, credentialIds: [], createdAt: Date.now() }),
    username,
    token,
    updatedAt: Date.now()
  }))
  await saveChallenge(store, challengeId, {
    challenge,
    userId,
    username,
    token,
    webAuthnUserID,
    purpose: 'registration',
    origin: rpConfig.origin,
    rpID: rpConfig.rpID
  })

  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  }
}

async function handleVerifyRegistration(store, data, rpConfig, env) {
  const { challengeId, response } = data

  if (!challengeId || !response) {
    return { code: RES_CODE.FAIL, message: 'Missing required parameters' }
  }

  const challengeData = await getAndDeleteChallenge(store, challengeId)
  if (!challengeData) {
    return { code: RES_CODE.FAIL, message: 'Challenge expired or invalid' }
  }

  try {
    if (challengeData.purpose !== 'registration'
      || challengeData.origin !== rpConfig.origin || challengeData.rpID !== rpConfig.rpID) {
      throw new Error('Invalid registration challenge')
    }
    await validateTokenValue(challengeData.token, store, env)
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: rpConfig.origin,
      expectedRPID: rpConfig.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257]
    })
    if (!verification.verified) throw new Error('Registration verification failed')
    const info = verification.registrationInfo
    const newCredential = {
      id: info.credential.id,
      publicKey: base64URLEncode(info.credential.publicKey),
      publicKeyFormat: 'cose',
      counter: info.credential.counter,
      transports: response.response.transports || [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      userId: challengeData.userId,
      webAuthnUserID: challengeData.webAuthnUserID,
      createdAt: Date.now()
    }

    // Preserve replacement semantics while serializing concurrent registrations.
    await withBlobLock(store, passkeyUserLockKey(challengeData.userId), async () => {
      const user = await getUser(store, challengeData.userId)
      if (!user) throw new Error('User not found')
      const existing = await getCredential(store, newCredential.id)
      if (existing && existing.userId !== challengeData.userId) throw new Error('Credential already registered')
      await writeJson(store, passkeyCredentialKey(newCredential.id), newCredential)
      await saveUser(store, {
        ...user,
        credentialIds: [newCredential.id],
        token: challengeData.token,
        updatedAt: Date.now()
      })
      for (const credentialId of user.credentialIds || []) {
        if (credentialId !== newCredential.id) await deleteJson(store, passkeyCredentialKey(credentialId))
      }
    })

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

async function handleGenerateAuthenticationOptions(store, data, rpConfig) {
  const { username, purpose = 'authentication' } = data
  if (!['authentication', 'management'].includes(purpose)) throw new Error('Invalid challenge purpose')

  let allowCredentials = []
  let userId = null

  if (username) {
    userId = await generateUserIdFromUsername(username)
    const credentials = await getUserCredentials(store, userId)
    if (credentials.length === 0) {
      return { code: RES_CODE.NOT_FOUND, message: 'No passkey found for this user' }
    }

    allowCredentials = credentials.map((credential) => ({
      id: credential.id,
      type: 'public-key',
      transports: credential.transports || []
    }))
  }

  const challengeBytes = new Uint8Array(32)
  crypto.getRandomValues(challengeBytes)
  const challenge = base64URLEncode(challengeBytes)

  const options = {
    challenge,
    timeout: 60000,
    rpId: rpConfig.rpID,
    userVerification: 'required',
    allowCredentials
  }

  const challengeId = generateUUID()
  await saveChallenge(store, challengeId, {
    challenge,
    userId,
    purpose,
    origin: rpConfig.origin,
    rpID: rpConfig.rpID
  })

  return {
    code: RES_CODE.SUCCESS,
    data: {
      options,
      challengeId
    }
  }
}

async function verifyAuthentication(store, data, rpConfig, purpose) {
  const { challengeId, response } = data
  if (!challengeId || !response?.id) throw new Error('Missing required parameters')
  const challenge = await getAndDeleteChallenge(store, challengeId)
  if (!challenge || challenge.purpose !== purpose) throw new Error('Challenge expired or invalid')
  const initialCredential = await getCredential(store, response.id)
  if (!initialCredential || (challenge.userId && initialCredential.userId !== challenge.userId)) {
    throw new Error('Credential not allowed')
  }
  // Challenge IDs are independent; credential counters must still advance safely.
  return withBlobLock(store, passkeyUserLockKey(initialCredential.userId), async () => {
    const credential = await getCredential(store, response.id)
    if (!credential || credential.userId !== initialCredential.userId) throw new Error('Credential not allowed')
    const user = await getUser(store, credential.userId)
    if (!user?.credentialIds?.includes(credential.id)) throw new Error('Credential not registered')
    const handle = response.response?.userHandle
    if (handle && handle !== (credential.webAuthnUserID || user.id)) throw new Error('User handle mismatch')
    const verified = await verifyPasskeyAssertion(response, credential, challenge, rpConfig)
    await writeJson(store, passkeyCredentialKey(credential.id), {
      ...credential,
      publicKey: base64URLEncode(verified.publicKey),
      publicKeyFormat: 'cose',
      counter: verified.newCounter,
      deviceType: verified.credentialDeviceType,
      backedUp: verified.credentialBackedUp,
      lastUsedAt: Date.now()
    })
    return user
  })
}

async function handleVerifyAuthentication(store, data, rpConfig, env) {
  const user = await verifyAuthentication(store, data, rpConfig, 'authentication')
  const token = await getEffectiveToken(store, env)
  if (!token) throw new Error('Not initialized')
  return { code: RES_CODE.SUCCESS, data: { verified: true, username: user.username, token } }
}

async function handleGenerateManagementToken(store, data, rpConfig) {
  const user = await verifyAuthentication(store, data, rpConfig, 'management')
  const managementToken = generateUUID()
  await saveManagementToken(store, managementToken, user.id)
  return { code: RES_CODE.SUCCESS, data: { managementToken, username: user.username } }
}

async function handleListCredentials(store, data) {
  const { username } = data

  if (!username) {
    return { code: RES_CODE.FAIL, message: 'Username is required' }
  }

  const userId = await generateUserIdFromUsername(username)
  const credentials = await getUserCredentials(store, userId)
  return {
    code: RES_CODE.SUCCESS,
    data: credentials.map((credential) => ({
      id: credential.id,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt
    }))
  }
}

async function handleDeleteCredential(store, data) {
  const { credentialId, username, managementToken } = data

  if (!credentialId || !username) {
    return { code: RES_CODE.FAIL, message: 'Credential ID and username are required' }
  }

  if (!managementToken) {
    return { code: RES_CODE.FAIL, message: 'Management token required' }
  }

  const credential = await getCredential(store, credentialId)
  if (!credential) {
    return { code: RES_CODE.NOT_FOUND, message: 'Credential not found' }
  }

  const userId = await generateUserIdFromUsername(username)
  if (credential.userId !== userId) {
    return { code: RES_CODE.FAIL, message: 'Unauthorized' }
  }

  const grant = await consumeManagementToken(store, managementToken)
  if (!grant || grant.userId !== userId) {
    return { code: RES_CODE.FAIL, message: 'Invalid or expired management token' }
  }

  await deleteCredential(store, credentialId)
  return {
    code: RES_CODE.SUCCESS,
    data: { deleted: true }
  }
}

async function handleCancelChallenge(store, data) {
  if (data?.challengeId) {
    const challengeId = validateChallengeId(data.challengeId)
    // Legacy imports can reuse an ID; cancellation and maintenance share their lock.
    await withBlobLock(store, legacyMigrationLockKey(), async () => {
      const key = passkeyChallengeKey(challengeId)
      const challenge = await readJson(store, key)
      if (!challenge) return
      if (!Number.isFinite(challenge.expiresAt)) throw new Error('Invalid challenge expiry')
      const consumed = challenge.expiresAt > Date.now() && await getAndDeleteChallenge(store, challengeId)
      if (!consumed) {
        await deleteJson(store, key)
        await clearLegacyChallengeReference(store, challenge.userId, challengeId)
      }
    })
  }
  return {
    code: RES_CODE.SUCCESS,
    message: 'Challenge cleared'
  }
}

function generateUUID() {
  return randomUUID().replace(/-/g, '')
}

function base64URLEncode(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateUserIdFromUsername(username) {
  const encoder = new TextEncoder()
  const source = encoder.encode(`open-kounter-passkey:${username}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', source)
  return base64URLEncode(hashBuffer)
}

export default { onRequest }
