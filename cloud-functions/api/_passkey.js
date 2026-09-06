import { createHash } from 'node:crypto'

import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { decodeAttestationObject, parseAuthenticatorData } from '@simplewebauthn/server/helpers'

export function getPasskeyConfig(request, env) {
  // Origin/Referer are caller-controlled and must not define the trusted origin.
  const origin = new URL(env.PASSKEY_ORIGIN || request.url).origin
  const hostname = new URL(origin).hostname
  const rpID = env.PASSKEY_RP_ID || env.WEBAUTHN_RP_ID || hostname
  if (hostname !== rpID && !hostname.endsWith(`.${rpID}`)) throw new Error('Invalid Passkey RP ID')
  return { origin, rpID, rpName: env.PASSKEY_RP_NAME || 'Open Kounter' }
}

export function getCredentialPublicKey(credential, rpID) {
  if (credential.publicKeyFormat === 'cose') {
    return new Uint8Array(Buffer.from(credential.publicKey, 'base64url'))
  }
  // Older versions stored an attestationObject in publicKey. Extract its COSE key
  // without rewriting it; authentication must still prove possession of the key.
  try {
    const attestation = decodeAttestationObject(new Uint8Array(Buffer.from(credential.publicKey, 'base64url')))
    const parsed = parseAuthenticatorData(attestation.get('authData'))
    const rpHash = createHash('sha256').update(rpID).digest()
    if (!parsed.credentialPublicKey || !parsed.credentialID
      || !Buffer.from(parsed.rpIdHash).equals(rpHash)
      || Buffer.from(parsed.credentialID).toString('base64url') !== credential.id) {
      throw new Error('Invalid legacy credential')
    }
    return parsed.credentialPublicKey
  } catch {
    throw new Error('旧 Passkey 数据不可验证，请使用 Token 登录后重新绑定')
  }
}

export async function verifyPasskeyAssertion(response, credential, challenge, rpConfig) {
  if (challenge.origin !== rpConfig.origin || challenge.rpID !== rpConfig.rpID) {
    throw new Error('Passkey origin or RP ID changed; please retry')
  }
  const publicKey = getCredentialPublicKey(credential, rpConfig.rpID)
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rpConfig.origin,
    expectedRPID: rpConfig.rpID,
    credential: { id: credential.id, publicKey, counter: credential.counter || 0, transports: credential.transports },
    requireUserVerification: true
  })
  if (!verification.verified) throw new Error('Invalid Passkey signature')
  return { ...verification.authenticationInfo, publicKey }
}
