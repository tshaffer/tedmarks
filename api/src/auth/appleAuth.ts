import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';

/** Checks an Apple identity token (signature against Apple's public keys, issuer, audience, expiry, nonce). */
export class AppleTokenVerifier {
  constructor(private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`))) {}

  /** Apple's user id ("sub") if the token is valid for `audience` and carries `nonce`. */
  async verify(idToken: string, audience: string, nonce: string): Promise<string> {
    const { payload } = await jwtVerify(idToken, this.keys, { issuer: APPLE_ISSUER, audience });
    if (payload.nonce !== nonce) throw new Error('Nonce mismatch');
    if (!payload.sub) throw new Error('No subject');
    return payload.sub;
  }
}
