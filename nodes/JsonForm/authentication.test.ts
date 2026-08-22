import { describe, expect, it, vi } from 'vitest';

import type { IWebhookFunctions } from 'n8n-workflow';

import {
  parseBasicAuth,
  validateWebhookAuthentication,
  WebhookAuthorizationError,
} from './authentication';

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

interface ContextOptions {
  parameters?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  credentials?: Record<string, unknown> | Error;
}

function fakeContext({ parameters = {}, headers = {}, credentials = {} }: ContextOptions = {}) {
  return {
    getNodeParameter: vi.fn((name: string, fallback?: unknown) =>
      name in parameters ? parameters[name] : fallback,
    ),
    getRequestObject: vi.fn(() => ({ method: 'GET' })),
    getHeaderData: vi.fn(() => headers),
    getCredentials: vi.fn(async (type: string) => {
      if (credentials instanceof Error) throw credentials;
      if (!(type in credentials)) {
        throw new Error(`No credential of type "${type}" is selected on the node.`);
      }
      return credentials[type];
    }),
  };
}

const context = (options: ContextOptions = {}) =>
  fakeContext(options) as unknown as IWebhookFunctions;

const authorizationErrorOf = async (promise: Promise<void>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WebhookAuthorizationError);
  return error as WebhookAuthorizationError;
};

describe('parseBasicAuth', () => {
  it('parses a standard Basic authorization header', () => {
    expect(parseBasicAuth(basicHeader('user', 'pass'))).toEqual({ user: 'user', pass: 'pass' });
  });

  it('accepts the scheme case-insensitively', () => {
    expect(parseBasicAuth(`basic ${Buffer.from('user:pass').toString('base64')}`)).toEqual({
      user: 'user',
      pass: 'pass',
    });
  });

  it('keeps colons inside the password', () => {
    expect(parseBasicAuth(basicHeader('user', 'pa:ss'))).toEqual({ user: 'user', pass: 'pa:ss' });
  });

  it('allows an empty password', () => {
    expect(parseBasicAuth(`Basic ${Buffer.from('user:').toString('base64')}`)).toEqual({
      user: 'user',
      pass: '',
    });
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['a non-basic scheme', 'Bearer abc123'],
    ['a token without a colon separator', `Basic ${Buffer.from('abc').toString('base64')}`],
  ])('rejects %s', (_label, header) => {
    expect(parseBasicAuth(header)).toBeNull();
  });

  it('uses the first value when the header repeats', () => {
    const first = basicHeader('first', 'one');
    const second = basicHeader('second', 'two');
    expect(parseBasicAuth([first, second])).toEqual({ user: 'first', pass: 'one' });
  });
});

describe('validateWebhookAuthentication', () => {
  it('allows anonymous requests when authentication is none or unset', async () => {
    for (const parameters of [{}, { authentication: 'none' }]) {
      const ctx = fakeContext({ parameters });
      await expect(
        validateWebhookAuthentication(ctx as unknown as IWebhookFunctions),
      ).resolves.toBeUndefined();
      expect(ctx.getCredentials).not.toHaveBeenCalled();
    }
  });

  describe('basicAuth', () => {
    it('accepts a request whose Authorization header matches the credential', async () => {
      await expect(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'basicAuth' },
            headers: { authorization: basicHeader('ada', 's3cret') },
            credentials: { httpBasicAuth: { user: 'ada', password: 's3cret' } },
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it('requires the Authorization header', async () => {
      const error = await authorizationErrorOf(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'basicAuth' },
            credentials: { httpBasicAuth: { user: 'ada', password: 's3cret' } },
          }),
        ),
      );

      expect(error.status).toBe(401);
      expect(error.message).toMatch(/required/i);
    });

    it('rejects a mismatched user or password', async () => {
      for (const header of [basicHeader('mallory', 's3cret'), basicHeader('ada', 'nope')]) {
        const error = await authorizationErrorOf(
          validateWebhookAuthentication(
            context({
              parameters: { authentication: 'basicAuth' },
              headers: { authorization: header },
              credentials: { httpBasicAuth: { user: 'ada', password: 's3cret' } },
            }),
          ),
        );

        expect(error.status).toBe(401);
        expect(error.message).toMatch(/wrong/i);
      }
    });

    it('fails closed when no Basic Auth credential is configured on the node', async () => {
      const error = await authorizationErrorOf(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'basicAuth' },
            headers: { authorization: basicHeader('ada', 's3cret') },
          }),
        ),
      );

      expect(error.status).toBe(500);
      expect(error.message).toMatch(/no authentication data defined/i);
    });

    it('fails closed when the configured credential is incomplete', async () => {
      const error = await authorizationErrorOf(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'basicAuth' },
            headers: { authorization: basicHeader('ada', 's3cret') },
            credentials: { httpBasicAuth: { user: 'ada' } },
          }),
        ),
      );

      expect(error.status).toBe(500);
      expect(error.message).toMatch(/no authentication data defined/i);
    });
  });

  describe('headerAuth', () => {
    it('accepts a matching custom header regardless of its casing', async () => {
      await expect(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'headerAuth' },
            headers: { 'x-api-key': 'secret-value' },
            credentials: { httpHeaderAuth: { name: 'X-Api-Key', value: 'secret-value' } },
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects a wrong header value', async () => {
      const error = await authorizationErrorOf(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'headerAuth' },
            headers: { 'x-api-key': 'tampered' },
            credentials: { httpHeaderAuth: { name: 'X-Api-Key', value: 'secret-value' } },
          }),
        ),
      );

      expect(error.status).toBe(403);
    });

    it('rejects a missing header', async () => {
      const error = await authorizationErrorOf(
        validateWebhookAuthentication(
          context({
            parameters: { authentication: 'headerAuth' },
            credentials: { httpHeaderAuth: { name: 'X-Api-Key', value: 'secret-value' } },
          }),
        ),
      );

      expect(error.status).toBe(403);
    });

    it('fails closed when the configured credential is incomplete', async () => {
      for (const credentials of [
        new Error('No credential of type "httpHeaderAuth" is selected on the node.'),
        {},
        { httpHeaderAuth: { name: 'X-Api-Key' } },
        { httpHeaderAuth: { value: 'secret-value' } },
      ]) {
        const error = await authorizationErrorOf(
          validateWebhookAuthentication(
            context({
              parameters: { authentication: 'headerAuth' },
              headers: { 'x-api-key': 'secret-value' },
              credentials: credentials as Record<string, unknown> | Error,
            }),
          ),
        );

        expect(error.status).toBe(500);
        expect(error.message).toMatch(/no authentication data defined/i);
      }
    });
  });

  it('fails closed for unexpected authentication values instead of opening the form', async () => {
    const error = await authorizationErrorOf(
      validateWebhookAuthentication(
        context({
          parameters: { authentication: 'oauth2' },
          headers: { authorization: 'Bearer whatever' },
        }),
      ),
    );

    expect(error.status).toBe(500);
    expect(error.message).toContain('oauth2');
  });
});
