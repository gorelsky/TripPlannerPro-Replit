import crypto from "node:crypto";

type OidcConfig = {
  clientId: string;
  clientSecret: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  jwksUrl: string;
  redirectUri: string;
  scope: string;
};

export type OidcClaims = {
  sub: string;
  email?: string;
  default_email?: string;
  name?: string;
  nonce?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
};

const OIDC_REQUEST_TIMEOUT_MS = 15_000;

function oidcTimeoutSignal() {
  return AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS);
}

const base64Url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing OIDC configuration: ${name}`);
  return value;
}

export function isYandexOidcEnabled(): boolean {
  return Boolean(process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI);
}

async function getConfig(): Promise<OidcConfig> {
  const configuredIssuer = (process.env.OIDC_ISSUER || "https://auth.yandex.cloud").trim();
  const issuerUrl = new URL(configuredIssuer);
  // Accept an accidentally configured authorization endpoint, but always use
  // the provider origin as the issuer for ID-token validation.
  const issuer = issuerUrl.pathname === "/oauth/authorize" || issuerUrl.pathname === "/oauth/token"
    ? issuerUrl.origin
    : configuredIssuer.replace(/\/$/, "");
  const legacyYandexOAuth = issuer.includes("oauth.yandex.ru");
  let metadata: Record<string, string> = {};
  if (!legacyYandexOAuth && (!process.env.OIDC_AUTHORIZATION_URL || !process.env.OIDC_TOKEN_URL || !process.env.OIDC_JWKS_URL)) {
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!discovery.ok) throw new Error(`OIDC discovery failed: ${discovery.status}`);
    metadata = await discovery.json() as Record<string, string>;
  }
  return {
    clientId: required("OIDC_CLIENT_ID"),
    clientSecret: required("OIDC_CLIENT_SECRET"),
    issuer,
    authorizationUrl: process.env.OIDC_AUTHORIZATION_URL || (legacyYandexOAuth ? "https://oauth.yandex.ru/authorize" : metadata.authorization_endpoint) || required("OIDC_AUTHORIZATION_URL"),
    tokenUrl: process.env.OIDC_TOKEN_URL || (legacyYandexOAuth ? "https://oauth.yandex.ru/token" : metadata.token_endpoint) || required("OIDC_TOKEN_URL"),
    userInfoUrl: process.env.OIDC_USERINFO_URL || (legacyYandexOAuth ? "https://login.yandex.ru/info?format=json" : metadata.userinfo_endpoint),
    jwksUrl: process.env.OIDC_JWKS_URL || metadata.jwks_uri || (legacyYandexOAuth ? "https://oauth.yandex.ru/keys" : undefined) || required("OIDC_JWKS_URL"),
    redirectUri: required("OIDC_REDIRECT_URI"),
    scope: process.env.OIDC_SCOPE || (legacyYandexOAuth ? "login:email login:info" : "openid email profile"),
  };
}

export function createOidcTransaction() {
  const nonce = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const randomState = base64Url(crypto.randomBytes(32));
  const payload = Buffer.from(JSON.stringify({
    state: randomState,
    nonce,
    verifier,
    issuedAt: Date.now(),
  })).toString("base64url");
  const secret = required("SESSION_SECRET");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return { state: `${payload}.${signature}`, nonce, verifier, challenge };
}

export function decodeOidcState(value: string): { state: string; nonce: string; verifier: string } | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state?: string;
      nonce?: string;
      verifier?: string;
      issuedAt?: number;
    };
    if (!parsed.state || !parsed.nonce || !parsed.verifier || !parsed.issuedAt) return null;
    if (Date.now() - parsed.issuedAt > 10 * 60 * 1000) return null;
    return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier };
  } catch {
    return null;
  }
}

export async function buildAuthorizationUrl(
  transaction: ReturnType<typeof createOidcTransaction>,
  prompt?: string,
): Promise<string> {
  const config = await getConfig();
  const url = new URL(config.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: transaction.challenge,
    code_challenge_method: "S256",
    ...(prompt ? { prompt } : {}),
  }).toString();
  return url.toString();
}

function decodePart(part: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new Error("OIDC_STAGE:id-token-payload");
  }
}

async function verifyIdToken(token: string, config: OidcConfig, nonce: string): Promise<OidcClaims> {
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new Error("OIDC_STAGE:id-token-format");
  const header = decodePart(pieces[0]);
  const claims = decodePart(pieces[1]) as OidcClaims;
  if (!header.kid || !header.alg) throw new Error("OIDC_STAGE:id-token-header");
  let jwksResponse: Response;
  try {
    jwksResponse = await fetch(config.jwksUrl, { signal: oidcTimeoutSignal() });
  } catch {
    throw new Error("OIDC_STAGE:jwks-network");
  }
  if (!jwksResponse.ok) throw new Error(`OIDC_STAGE:jwks-http-${jwksResponse.status}`);
  let jwks: { keys: JsonWebKey[] };
  try {
    jwks = await jwksResponse.json() as { keys: JsonWebKey[] };
  } catch {
    throw new Error("OIDC_STAGE:jwks-json");
  }
  if (!Array.isArray(jwks.keys)) throw new Error("OIDC_STAGE:jwks-format");
  const jwk = jwks.keys.find((key: any) => key.kid === header.kid);
  if (!jwk) throw new Error("OIDC_STAGE:jwks-key");
  let valid = false;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
    const signature = Buffer.from(pieces[2], "base64url");
    valid = crypto.verify(
      header.alg === "ES256" ? "sha256" : "RSA-SHA256",
      Buffer.from(`${pieces[0]}.${pieces[1]}`),
      { key: publicKey, ...(header.alg === "ES256" ? { dsaEncoding: "der" as const } : {}) },
      signature,
    );
  } catch {
    throw new Error("OIDC_STAGE:id-token-key");
  }
  if (!valid) throw new Error("OIDC_STAGE:id-token-signature");
  const tokenIssuer = (claims.iss || "").replace(/\/$/, "");
  const acceptedIssuers = new Set([
    config.issuer,
    config.authorizationUrl.replace(/\/$/, ""),
    "https://auth.yandex.cloud",
    "https://auth.cloud.yandex.com",
  ]);
  if (!acceptedIssuers.has(tokenIssuer)) throw new Error("OIDC_STAGE:id-token-issuer");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(config.clientId)) throw new Error("OIDC_STAGE:id-token-audience");
  if (claims.nonce !== nonce) throw new Error("OIDC_STAGE:id-token-nonce");
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("OIDC_STAGE:id-token-expired");
  if (!claims.sub) throw new Error("OIDC_STAGE:id-token-sub");
  return claims;
}

export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<OidcClaims> {
  const config = await getConfig();
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      signal: oidcTimeoutSignal(),
      body: tokenParams,
    });
  } catch {
    throw new Error("OIDC_STAGE:token-network");
  }

  // Yandex OIDC clients can be configured for either client_secret_basic or
  // client_secret_post. Retry the alternate method when Basic is rejected.
  if (!response.ok && (response.status === 400 || response.status === 401)) {
    try {
      response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: oidcTimeoutSignal(),
        body: new URLSearchParams({
          ...Object.fromEntries(tokenParams),
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      });
    } catch {
      throw new Error("OIDC_STAGE:token-network-retry");
    }
  }
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const detail = responseText.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`OIDC_STAGE:token-http-${response.status}`);
  }
  let tokens: { id_token?: string; access_token?: string };
  try {
    tokens = await response.json() as { id_token?: string; access_token?: string };
  } catch {
    throw new Error("OIDC_STAGE:token-json");
  }
  let claims: OidcClaims | undefined;
  if (tokens.id_token) {
    claims = await verifyIdToken(tokens.id_token, config, nonce);
  }

  // Yandex Identity Hub may issue a valid ID token without email. In that
  // case, use the access token to retrieve the profile before matching the
  // account to the application's access list.
  if ((!claims?.email && !claims?.default_email) && tokens.access_token && config.userInfoUrl) {
    const authorizationScheme = config.issuer.includes("oauth.yandex.ru") ? "OAuth" : "Bearer";
    let userInfo: Response;
    try {
      userInfo = await fetch(config.userInfoUrl, {
        signal: oidcTimeoutSignal(),
        headers: { Authorization: `${authorizationScheme} ${tokens.access_token}` },
      });
    } catch {
      throw new Error("OIDC_STAGE:userinfo-network");
    }
    if (!userInfo.ok) throw new Error(`OIDC_STAGE:userinfo-http-${userInfo.status}`);
    let profile: OidcClaims;
    try {
      profile = await userInfo.json() as OidcClaims;
    } catch {
      throw new Error("OIDC_STAGE:userinfo-json");
    }
    claims = { ...claims, ...profile };
  }

  if (!claims) throw new Error("OIDC_STAGE:profile-missing");
  const normalizedEmail = String(claims.email || claims.default_email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("OIDC_STAGE:profile-email-missing");
  claims.email = normalizedEmail;
  return claims;
}

