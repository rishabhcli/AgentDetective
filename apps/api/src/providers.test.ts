import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderHub } from './providers.js';

const model = 'accounts/fireworks/models/inkling';

function stubCatalog(
  body: unknown,
  status = 200,
  inference: unknown = {
    model,
    choices: [
      {
        message: {
          content: JSON.stringify({ observations: [], warnings: [] }),
        },
      },
    ],
  },
) {
  const fetchStub = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const responseBody = url.includes('/inference/') ? inference : body;
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status }));
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

async function fireworksStatus(catalog: unknown, status = 200) {
  stubCatalog(catalog, status);
  // Only Fireworks is configured, so the other adapters resolve without fetching.
  const hub = new ProviderHub({
    FIREWORKS_API_KEY: 'test-key',
    FIREWORKS_VISION_MODEL: model,
  });
  const statuses = await hub.verify();
  const fireworks = statuses.find((item) => item.id === 'fireworks');
  if (!fireworks) throw new Error('Fireworks status is missing.');
  return fireworks;
}

describe('Fireworks verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports ready only when the configured model is deployed for image input', async () => {
    const fireworks = await fireworksStatus({
      models: [{ name: model, supportsImageInput: true }],
    });

    expect(fireworks.state).toBe('ready');
    expect(fireworks.active).toBe(true);
    expect(fireworks.detail).toContain(model);
  });

  it('refuses to call a live credential ready when the model is not in the catalog', async () => {
    // Regression: a credential-only probe reported "connected" while every
    // inference call returned 404 for a model that was never deployed.
    const fireworks = await fireworksStatus({
      models: [
        { name: 'accounts/fireworks/models/some-other-model', supportsImageInput: true },
      ],
    });

    expect(fireworks.state).toBe('degraded');
    expect(fireworks.active).toBe(false);
    expect(fireworks.configured).toBe(true);
    expect(fireworks.detail).toContain('not in the serverless catalog');
  });

  it('refuses to call a text-only model ready for visual extraction', async () => {
    const fireworks = await fireworksStatus({
      models: [{ name: model, supportsImageInput: false }],
    });

    expect(fireworks.state).toBe('degraded');
    expect(fireworks.active).toBe(false);
    expect(fireworks.detail).toContain('does not accept image input');
  });

  it('reports a rejected credential as blocked rather than degraded', async () => {
    const fireworks = await fireworksStatus(
      { error: { message: 'Account is suspended' } },
      403,
    );

    expect(fireworks.state).toBe('blocked');
    expect(fireworks.active).toBe(false);
    expect(fireworks.detail).toContain('Account is suspended');
  });

  it('reports an absent credential as unconfigured without calling the network', async () => {
    const fetchStub = stubCatalog({ models: [] });
    const hub = new ProviderHub({});
    const statuses = await hub.verify();

    expect(statuses.find((item) => item.id === 'fireworks')?.state).toBe('unconfigured');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
