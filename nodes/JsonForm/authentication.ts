import type { IWebhookFunctions } from 'n8n-workflow';

/**
 * Mirrors n8n's standard webhook authorization failure (see
 * nodes-base/nodes/Webhook/error.ts): the handler that catches this answers
 * with the status below and never runs the workflow.
 */
export class WebhookAuthorizationError extends Error {
  override name = "WebhookAuthorizationError";

  constructor(
    readonly status: number,
    message?: string,
  ) {
    if (message === undefined) {
      message = 'Authorization problem!';
      if (status === 401) {
        message = 'Authorization is required!';
      } else if (status === 403) {
        message = 'Authorization data is wrong!';
      }
    }
    super(message);
  }
}

export interface ParsedBasicAuth {
  user: string;
  pass: string;
}

/**
 * Parse an `Authorization: Basic <credentials>` header per RFC 7617.
 *
 * The scheme is case-insensitive and the decoded credentials split at the
 * first colon, so passwords may contain colons. Returns null for anything
 * else — missing, non-Basic, or undecodable values.
 */
export function parseBasicAuth(header: string | string[] | undefined): ParsedBasicAuth | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;

  const separatorIndex = value.indexOf(' ');
  if (separatorIndex === -1) return null;

  const scheme = value.slice(0, separatorIndex);
  if (!/^basic$/i.test(scheme)) return null;

  const token = value.slice(separatorIndex + 1);
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return null;

  return { user: decoded.slice(0, colonIndex), pass: decoded.slice(colonIndex + 1) };
}

type HeaderMap = Record<string, string | string[] | undefined>;

function firstHeaderValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Gate a webhook request with n8n's standard Basic Auth / Header Auth
 * credentials, mirroring nodes-base's validateWebhookAuthentication.
 *
 * `none` lets every request through so public intake Forms keep working
 * anonymously; anything unexpected fails closed rather than silently
 * opening the Form.
 */
export async function validateWebhookAuthentication(
  context: IWebhookFunctions,
  authPropertyName: string = 'authentication',
): Promise<void> {
  const authentication = context.getNodeParameter(authPropertyName, 'none') as string;
  if (authentication === 'none') return;

  const headers = context.getHeaderData() as HeaderMap;

  if (authentication === 'basicAuth') {
    let expectedAuth: Record<string, unknown> | undefined;
    try {
      expectedAuth = await context.getCredentials<Record<string, unknown>>('httpBasicAuth');
    } catch {}

    if (expectedAuth === undefined || !expectedAuth.user || !expectedAuth.password) {
      // Data is not defined on node so can not authenticate
      throw new WebhookAuthorizationError(500, 'No authentication data defined on node!');
    }

    const providedAuth = parseBasicAuth(headers.authorization);
    if (!providedAuth) {
      // Authorization data is missing
      throw new WebhookAuthorizationError(401);
    }
    if (
      providedAuth.user !== expectedAuth.user ||
      providedAuth.pass !== expectedAuth.password
    ) {
      // Provided authentication data is wrong
      throw new WebhookAuthorizationError(401, 'Authentication data is wrong!');
    }
    return;
  }

  if (authentication === 'headerAuth') {
    let expectedAuth: Record<string, unknown> | undefined;
    try {
      expectedAuth = await context.getCredentials<Record<string, unknown>>('httpHeaderAuth');
    } catch {}

    if (expectedAuth === undefined || !expectedAuth.name || !expectedAuth.value) {
      // Data is not defined on node so can not authenticate
      throw new WebhookAuthorizationError(500, 'No authentication data defined on node!');
    }

    const providedValue = firstHeaderValue(headers, expectedAuth.name as string);
    if (providedValue !== expectedAuth.value) {
      // Provided authentication data is missing or wrong
      throw new WebhookAuthorizationError(403);
    }
    return;
  }

  throw new WebhookAuthorizationError(
    500,
    `Unknown authentication mode "${authentication}" configured on node!`,
  );
}
