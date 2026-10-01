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
  email: string;
  name?: string;
  nonce?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
};

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
  const issuer = (process.env.OIDC_ISSUER || "https://auth.yandex.cloud").replace(/\/$/, "");
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
  const state = base64Url(crypto.randomBytes(32));
  const nonce = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { state, nonce, verifier, challenge };
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
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function verifyIdToken(token: string, config: OidcConfig, nonce: string): Promise<OidcClaims> {
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new Error("Invalid OIDC ID token");
  const header = decodePart(pieces[0]);
  const claims = decodePart(pieces[1]) as OidcClaims;
  const jwksResponse = await fetch(config.jwksUrl);
  if (!jwksResponse.ok) throw new Error(`OIDC JWKS request failed: ${jwksResponse.status}`);
  const jwks = await jwksResponse.json() as { keys: JsonWebKey[] };
  const jwk = jwks.keys.find((key: any) => key.kid === header.kid);
  if (!jwk) throw new Error("OIDC signing key not found");
  const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  const signature = Buffer.from(pieces[2], "base64url");
  const valid = crypto.verify(
    header.alg === "ES256" ? "sha256" : "RSA-SHA256",
    Buffer.from(`${pieces[0]}.${pieces[1]}`),
    { key: publicKey, ...(header.alg === "ES256" ? { dsaEncoding: "der" as const } : {}) },
    signature,
  );
  if (!valid) throw new Error("Invalid OIDC ID token signature");
  if ((claims.iss || "").replace(/\/$/, "") !== config.issuer) throw new Error("Invalid OIDC issuer");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(config.clientId)) throw new Error("Invalid OIDC audience");
  if (claims.nonce !== nonce) throw new Error("Invalid OIDC nonce");
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired OIDC ID token");
  if (!claims.sub) throw new Error("OIDC subject is missing");
  return claims;
}

export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<OidcClaims> {
  const config = await getConfig();
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`OIDC token exchange failed: ${response.status}`);
  const tokens = await response.json() as { id_token?: string; access_token?: string };
  let claims: OidcClaims;
  if (tokens.id_token) {
    claims = await verifyIdToken(tokens.id_token, config, nonce);
  } else if (tokens.access_token && config.userInfoUrl) {
    const authorizationScheme = config.issuer.includes("oauth.yandex.ru") ? "OAuth" : "Bearer";
    const userInfo = await fetch(config.userInfoUrl, {
      headers: { Authorization: `${authorizationScheme} ${tokens.access_token}` },
    });
    if (!userInfo.ok) throw new Error(`OIDC userinfo request failed: ${userInfo.status}`);
    claims = await userInfo.json() as OidcClaims;
  } else {
    throw new Error("OAuth response does not contain a usable user profile");
  }
  if (!claims.email) throw new Error("Corporate email is missing in OIDC profile");
  return claims;
}
