import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpGatewayError } from './errors';

/** Everything OAuth needs to persist for one connection (stored encrypted by the caller). */
export type OAuthState = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
};

export type OAuthStore = {
  load(): Promise<OAuthState>;
  save(state: OAuthState): Promise<void>;
};

/**
 * OAuth 2.1 client for one MCP connection (authorization code + PKCE, dynamic client
 * registration, refresh). A server app can't redirect the user from inside the SDK, so the
 * authorization URL is captured and returned to the caller, which sends the browser there.
 */
export class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;

  constructor(
    private readonly store: OAuthStore,
    private readonly redirect: string,
    private readonly stateValue: string,
  ) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'AgentOS',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    return this.stateValue;
  }

  async clientInformation() {
    return (await this.store.load()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.store.save({ ...(await this.store.load()), clientInformation });
  }

  async tokens() {
    return (await this.store.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.store.save({ ...(await this.store.load()), tokens, codeVerifier: undefined });
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.store.save({ ...(await this.store.load()), codeVerifier });
  }

  async codeVerifier() {
    const verifier = (await this.store.load()).codeVerifier;
    if (!verifier) throw new McpGatewayError('auth', 'No authorization in progress');
    return verifier;
  }
}

/** Starts (or silently completes, if tokens still work) the authorization flow. */
export async function beginOAuth(
  provider: StoredOAuthProvider,
  serverUrl: string,
): Promise<{ status: 'authorized' } | { status: 'redirect'; url: string }> {
  try {
    const result = await auth(provider, { serverUrl });
    if (result === 'AUTHORIZED') return { status: 'authorized' };
    if (!provider.authorizationUrl)
      throw new McpGatewayError('auth', 'Server did not provide an authorization URL');
    return { status: 'redirect', url: provider.authorizationUrl.toString() };
  } catch (error) {
    if (error instanceof McpGatewayError) throw error;
    throw new McpGatewayError('auth', 'Could not start authorization with this server');
  }
}

/** Exchanges the authorization code from the callback for tokens. */
export async function completeOAuth(
  provider: StoredOAuthProvider,
  serverUrl: string,
  code: string,
): Promise<void> {
  try {
    const result = await auth(provider, { serverUrl, authorizationCode: code });
    if (result !== 'AUTHORIZED')
      throw new McpGatewayError('auth', 'Authorization did not complete');
  } catch (error) {
    if (error instanceof McpGatewayError) throw error;
    throw new McpGatewayError('auth', 'The server rejected the authorization code');
  }
}
