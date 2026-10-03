import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.js', () => ({
  t: (key) => key,
  useI18n: () => ({ t: (key) => key })
}));

const loadPing = async () => import('../../src/utils/ping.js');

describe('pingNode reachability semantics', () => {
  let pingModule;

  beforeEach(async () => {
    pingModule = await loadPing();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const flush = (ms) => {
    vi.advanceTimersByTime(ms);
    return Promise.resolve().then(() => {}).then(() => {});
  };

  it('marks a real HTTP response as ok with measured latency', async () => {
    global.fetch.mockResolvedValue(new Response(null, { status: 204 }));

    const promise = pingModule.pingNode('node.example.com', 443, 3000);
    await flush(150);

    const result = await promise;
    expect(result.status).toBe('ok');
    expect(result.latency).toBeGreaterThan(0);
  });

  it('marks fast failures as unreachable instead of ok', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = pingModule.pingNode('node.example.com', 443, 3000);
    await flush(10);

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.latency).toBe(-1);
    expect(result.message).toBe('utils.nodeUnreachable');
  });

  it('treats post-connect handshake failures as reachable but not verified', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = pingModule.pingNode('node.example.com', 443, 3000);
    await flush(600);

    const result = await promise;
    expect(result.status).toBe('ok');
    expect(result.message).toBe('utils.tcpReachableOnly');
  });

  it('reports timeout when no response arrives', async () => {
    global.fetch.mockImplementation(() => new Promise(() => {}));

    const promise = pingModule.pingNode('node.example.com', 443, 3000);
    await flush(3100);

    const result = await promise;
    expect(result.status).toBe('timeout');
  });

  it('refuses to fake a result for UDP-only protocols', async () => {
    const udpUrl = 'hysteria2://pass@h2.example.com:443?sni=x#HY2';

    const result = await pingModule.pingNode('h2.example.com', 443, 3000, { url: udpUrl });

    expect(result.status).toBe('unsupported');
    expect(result.latency).toBe(-1);
    expect(result.message).toBe('utils.udpProtocolUntestable');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('detects UDP-only protocols across the supported schemes', () => {
    expect(pingModule.isUdpOnlyProtocol('hy2://a@b:443')).toBe(true);
    expect(pingModule.isUdpOnlyProtocol('tuic://uuid:pw@b:443')).toBe(true);
    expect(pingModule.isUdpOnlyProtocol('wireguard://b:443')).toBe(true);
    expect(pingModule.isUdpOnlyProtocol('vless://uuid@b:443')).toBe(false);
    expect(pingModule.isUdpOnlyProtocol('trojan://pw@b:443')).toBe(false);
  });

  it('brackets bare IPv6 hosts so the probe URL stays valid', async () => {
    global.fetch.mockResolvedValue(new Response(null, { status: 204 }));

    const promise = pingModule.pingNode('2001:db8::1', 443, 3000);
    await flush(10);
    await promise;

    expect(global.fetch.mock.calls[0][0]).toContain('[2001:db8::1]:443');
  });

  it('rejects missing host or port without probing', async () => {
    const result = await pingModule.pingNode('', '', 3000);

    expect(result.status).toBe('error');
    expect(result.message).toBe('utils.invalidAddressOrPort');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});