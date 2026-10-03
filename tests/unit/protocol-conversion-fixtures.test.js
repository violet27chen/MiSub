import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy, urlsToClashProxies } from '../../functions/utils/url-to-clash.js';
import { extractValidNodes } from '../../functions/modules/utils/node-parser.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';

const stripGeneratedFields = (proxy) => {
    const { metadata, ...rest } = proxy;
    return rest;
};

const expectRoundTrip = (proxy, expected) => {
    const url = convertClashProxyToUrl(proxy);
    expect(url).toBeTruthy();

    const parsed = urlToClashProxy(url);
    expect(parsed).toMatchObject(expected);

    const [batched] = urlsToClashProxies([url], { addFlagEmoji: false });
    expect(stripGeneratedFields(batched)).toMatchObject(expected);
};

const expectParseOnly = (url, expected) => {
    const parsed = urlToClashProxy(url);
    expect(parsed).toMatchObject(expected);

    const [batched] = urlsToClashProxies([url], { addFlagEmoji: false });
    expect(stripGeneratedFields(batched)).toMatchObject(expected);
};

const base64UrlSafeEncode = (value) => Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

describe('protocol conversion fixtures', () => {
    it('preserves common proxy fields across Clash proxy -> URL -> Clash proxy round trips', () => {
        const fixtures = [
            {
                proxy: {
                    name: 'Fixture SS Obfs',
                    type: 'ss',
                    server: 'ss.example.com',
                    port: 8388,
                    cipher: 'chacha20-ietf-poly1305',
                    password: 'ss-pass',
                    plugin: 'obfs',
                    'plugin-opts': {
                        mode: 'tls',
                        host: 'cdn.example.com'
                    }
                },
                expected: {
                    name: 'Fixture SS Obfs',
                    type: 'ss',
                    server: 'ss.example.com',
                    port: 8388,
                    cipher: 'chacha20-ietf-poly1305',
                    password: 'ss-pass',
                    plugin: 'obfs',
                    'plugin-opts': {
                        mode: 'tls',
                        host: 'cdn.example.com'
                    }
                }
            },
            {
                proxy: {
                    name: 'Fixture SSR',
                    type: 'ssr',
                    server: 'ssr.example.com',
                    port: 12345,
                    protocol: 'auth_aes128_sha1',
                    cipher: 'chacha20-ietf',
                    obfs: 'http_simple',
                    password: 'ssr-pass',
                    'obfs-param': 'download.example.com',
                    'protocol-param': '32:token'
                },
                expected: {
                    name: 'Fixture SSR',
                    type: 'ssr',
                    server: 'ssr.example.com',
                    port: 12345,
                    protocol: 'auth_aes128_sha1',
                    cipher: 'chacha20-ietf',
                    obfs: 'http_simple',
                    password: 'ssr-pass',
                    'obfs-param': 'download.example.com',
                    'protocol-param': '32:token'
                }
            },
            {
                proxy: {
                    name: 'Fixture VMess WS',
                    type: 'vmess',
                    server: 'vmess.example.com',
                    port: 443,
                    uuid: '11111111-1111-4111-8111-111111111111',
                    alterId: 0,
                    cipher: 'auto',
                    network: 'ws',
                    tls: true,
                    sni: 'vmess-sni.example.com',
                    'client-fingerprint': 'chrome',
                    'ws-opts': {
                        path: '/ws',
                        headers: { Host: 'front.example.com' }
                    }
                },
                expected: {
                    name: 'Fixture VMess WS',
                    type: 'vmess',
                    server: 'vmess.example.com',
                    port: 443,
                    uuid: '11111111-1111-4111-8111-111111111111',
                    alterId: 0,
                    cipher: 'auto',
                    network: 'ws',
                    tls: true,
                    servername: 'vmess-sni.example.com',
                    'client-fingerprint': 'chrome',
                    'ws-opts': {
                        path: '/ws',
                        headers: { Host: 'front.example.com' }
                    }
                }
            },
            {
                proxy: {
                    name: 'Fixture VLESS Reality',
                    type: 'vless',
                    server: 'vless.example.com',
                    port: 443,
                    uuid: '22222222-2222-4222-8222-222222222222',
                    network: 'grpc',
                    tls: true,
                    servername: 'www.example.com',
                    flow: 'xtls-rprx-vision',
                    'client-fingerprint': 'chrome',
                    'dialer-proxy': '前置节点',
                    'reality-opts': {
                        'public-key': 'public-key-value',
                        'short-id': 'abcd',
                        'spider-x': '/'
                    },
                    'grpc-opts': {
                        'grpc-service-name': 'update',
                        'grpc-mode': 'gun'
                    }
                },
                expected: {
                    name: 'Fixture VLESS Reality',
                    type: 'vless',
                    server: 'vless.example.com',
                    port: 443,
                    uuid: '22222222-2222-4222-8222-222222222222',
                    network: 'grpc',
                    tls: true,
                    servername: 'www.example.com',
                    sni: 'www.example.com',
                    flow: 'xtls-rprx-vision',
                    'client-fingerprint': 'chrome',
                    'dialer-proxy': '前置节点',
                    'reality-opts': {
                        'public-key': 'public-key-value',
                        'short-id': 'abcd',
                        'spider-x': '/'
                    },
                    'grpc-opts': {
                        'grpc-service-name': 'update',
                        'grpc-mode': 'gun'
                    }
                }
            },
            {
                proxy: {
                    name: 'Fixture Trojan WS',
                    type: 'trojan',
                    server: 'trojan.example.com',
                    port: 443,
                    password: 'tr@jan:pass',
                    network: 'ws',
                    sni: 'trojan-sni.example.com',
                    'skip-cert-verify': true,
                    'ws-opts': {
                        path: '/trojan',
                        headers: { Host: 'trojan-front.example.com' }
                    }
                },
                expected: {
                    name: 'Fixture Trojan WS',
                    type: 'trojan',
                    server: 'trojan.example.com',
                    port: 443,
                    password: 'tr@jan:pass',
                    network: 'ws',
                    servername: 'trojan-sni.example.com',
                    sni: 'trojan-sni.example.com',
                    'skip-cert-verify': true,
                    'ws-opts': {
                        path: '/trojan',
                        headers: { Host: 'trojan-front.example.com' }
                    }
                }
            },
            {
                proxy: {
                    name: 'Fixture HY2 Realm',
                    type: 'hysteria2',
                    server: 'hy2.example.com',
                    port: 443,
                    password: 'hy2-pass',
                    sni: 'hy2-sni.example.com',
                    obfs: 'salamander',
                    'obfs-password': 'obfs-pass',
                    'skip-cert-verify': true,
                    'realm-opts': {
                        enable: true,
                        'realm-id': 'realm-id-value',
                        token: 'realm-token-value',
                        'server-url': 'https://realm.example.com',
                        'stun-servers': ['stun.example.com:3478', 'stun2.example.com:3478']
                    }
                },
                expected: {
                    name: 'Fixture HY2 Realm',
                    type: 'hysteria2',
                    server: 'hy2.example.com',
                    port: 443,
                    password: 'hy2-pass',
                    servername: 'hy2-sni.example.com',
                    sni: 'hy2-sni.example.com',
                    obfs: 'salamander',
                    'obfs-password': 'obfs-pass',
                    'skip-cert-verify': true,
                    'realm-opts': {
                        enable: true,
                        'realm-id': 'realm-id-value',
                        token: 'realm-token-value',
                        'server-url': 'https://realm.example.com',
                        'stun-servers': ['stun.example.com:3478', 'stun2.example.com:3478']
                    }
                }
            },
            {
                proxy: {
                    name: 'Fixture TUIC',
                    type: 'tuic',
                    server: 'tuic.example.com',
                    port: 443,
                    uuid: '33333333-3333-4333-8333-333333333333',
                    password: 'p@ss:word%23?x',
                    sni: 'tuic-sni.example.com',
                    alpn: ['h3'],
                    'skip-cert-verify': true,
                    'congestion-controller': 'bbr',
                    'udp-relay-mode': 'native',
                    'zero-rtt-handshake': true,
                    heartbeat: '10s'
                },
                expected: {
                    name: 'Fixture TUIC',
                    type: 'tuic',
                    server: 'tuic.example.com',
                    port: 443,
                    uuid: '33333333-3333-4333-8333-333333333333',
                    password: 'p@ss:word%23?x',
                    servername: 'tuic-sni.example.com',
                    sni: 'tuic-sni.example.com',
                    alpn: ['h3'],
                    'skip-cert-verify': true,
                    'congestion-controller': 'bbr',
                    'udp-relay-mode': 'native',
                    'zero-rtt-handshake': true,
                    'reduce-rtt': true,
                    heartbeat: '10s'
                }
            },
            {
                proxy: {
                    name: 'Fixture SOCKS5',
                    type: 'socks5',
                    server: 'socks.example.com',
                    port: 1080,
                    username: 'user',
                    password: 'p@ss:word'
                },
                expected: {
                    name: 'Fixture SOCKS5',
                    type: 'socks5',
                    server: 'socks.example.com',
                    port: 1080,
                    username: 'user',
                    password: 'p@ss:word',
                    udp: false
                }
            },
            {
                proxy: {
                    name: 'Fixture Snell',
                    type: 'snell',
                    server: 'snell.example.com',
                    port: 440,
                    psk: 'snell-pass',
                    version: 3,
                    reuse: true,
                    tfo: true,
                    'obfs-opts': {
                        mode: 'tls',
                        host: 'snell-front.example.com'
                    },
                    ecn: true
                },
                expected: {
                    name: 'Fixture Snell',
                    type: 'snell',
                    server: 'snell.example.com',
                    port: 440,
                    psk: 'snell-pass',
                    version: 3,
                    reuse: true,
                    tfo: true,
                    'obfs-opts': {
                        mode: 'tls',
                        host: 'snell-front.example.com'
                    },
                    ecn: true
                }
            },
            {
                proxy: {
                    name: 'Fixture AnyTLS',
                    type: 'anytls',
                    server: 'anytls.example.com',
                    port: 443,
                    password: 'anytls-pass',
                    sni: 'anytls-sni.example.com',
                    alpn: ['h2', 'http/1.1'],
                    'skip-cert-verify': true,
                    pinnedPeerCertSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                    padding: true
                },
                expected: {
                    name: 'Fixture AnyTLS',
                    type: 'anytls',
                    server: 'anytls.example.com',
                    port: 443,
                    password: 'anytls-pass',
                    servername: 'anytls-sni.example.com',
                    sni: 'anytls-sni.example.com',
                    alpn: ['h2', 'http/1.1'],
                    'skip-cert-verify': true,
                    pinnedPeerCertSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                    udp: true
                }
            },
            {
                proxy: {
                    name: 'Fixture WireGuard',
                    type: 'wireguard',
                    server: 'wg.example.com',
                    port: 51820,
                    'private-key': 'private-key-value',
                    'public-key': 'public-key-value',
                    ip: ['172.16.0.2/32', '2606:4700:110:abcd::2/128'],
                    'allowed-ips': ['0.0.0.0/0', '::/0'],
                    reserved: [1, 2, 3],
                    mtu: 1280,
                    dns: ['1.1.1.1', '2606:4700:4700::1111'],
                    'persistent-keepalive': 25,
                    'preshared-key': 'psk-value'
                },
                expected: {
                    name: 'Fixture WireGuard',
                    type: 'wireguard',
                    server: 'wg.example.com',
                    port: 51820,
                    'private-key': 'private-key-value',
                    'remote-dns-resolve': true,
                    udp: true,
                    'public-key': 'public-key-value',
                    ip: ['172.16.0.2/32', '2606:4700:110:abcd::2/128'],
                    'allowed-ips': ['0.0.0.0/0', '::/0'],
                    reserved: [1, 2, 3],
                    mtu: 1280,
                    dns: ['1.1.1.1', '2606:4700:4700::1111'],
                    'persistent-keepalive': 25,
                    'preshared-key': 'psk-value'
                }
            }
        ];

        for (const fixture of fixtures) {
            expectRoundTrip(fixture.proxy, fixture.expected);
        }
    });

    it('preserves parse-only protocol contracts for supported import schemes', () => {
        const ssdUrl = `ssd://${base64UrlSafeEncode(JSON.stringify({
            encryption: 'aes-256-gcm',
            password: 'shared-pass',
            servers: [
                {
                    server: 'ssd.example.com',
                    port: 8443,
                    remarks: 'Fixture SSD',
                    plugin: 'obfs-local',
                    plugin_options: 'cdn.example.com'
                }
            ]
        }))}`;

        const fixtures = [
            {
                url: ssdUrl,
                expected: {
                    name: 'Fixture SSD',
                    type: 'ss',
                    server: 'ssd.example.com',
                    port: 8443,
                    cipher: 'aes-256-gcm',
                    password: 'shared-pass',
                    plugin: 'obfs-local',
                    'plugin-opts': {
                        host: 'cdn.example.com'
                    }
                }
            },
            {
                url: 'https://user:p%40ss%3Aword@https.example.com:443?sni=https-sni.example.com&allowInsecure=1#Fixture%20HTTPS',
                expected: {
                    name: 'Fixture HTTPS',
                    type: 'https',
                    server: 'https.example.com',
                    port: 443,
                    username: 'user',
                    password: 'p@ss:word',
                    servername: 'https-sni.example.com',
                    sni: 'https-sni.example.com',
                    'skip-cert-verify': true,
                    udp: false
                }
            },
            {
                url: 'socks5://user:p%40ss%3Aword@socks-tls.example.com:1081?tls=1&sni=socks-sni.example.com&allowInsecure=1#Fixture%20SOCKS5%20TLS',
                expected: {
                    name: 'Fixture SOCKS5 TLS',
                    type: 'socks5-tls',
                    server: 'socks-tls.example.com',
                    port: 1081,
                    username: 'user',
                    password: 'p@ss:word',
                    udp: false,
                    servername: 'socks-sni.example.com',
                    sni: 'socks-sni.example.com',
                    'skip-cert-verify': true
                }
            },
            {
                url: 'anytls://anytls-parse-pass@anytls-parse.example.com:443?sni=anytls-sni.example.com&pinnedPeerCertSha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789#Fixture%20AnyTLS%20Pinned',
                expected: {
                    name: 'Fixture AnyTLS Pinned',
                    type: 'anytls',
                    server: 'anytls-parse.example.com',
                    port: 443,
                    password: 'anytls-parse-pass',
                    servername: 'anytls-sni.example.com',
                    sni: 'anytls-sni.example.com',
                    pinnedPeerCertSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
                    udp: true
                }
            }
        ];

        for (const fixture of fixtures) {
            expectParseOnly(fixture.url, fixture.expected);
        }
    });

    it('preserves VLESS gRPC service options from Clash YAML through URL and builtin Clash output', () => {
        const clashConfig = `
proxies:
  - name: JP-1
    type: vless
    server: vless.example.com
    port: 443
    uuid: 22222222-2222-4222-8222-222222222222
    network: grpc
    tls: true
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: public-key-value
      short-id: abcd
    grpc-opts:
      grpc-service-name: update
      grpc-mode: gun
`;

        const nodes = extractValidNodes(clashConfig);

        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toContain('type=grpc');
        expect(nodes[0]).toContain('serviceName=update');
        expect(nodes[0]).toContain('mode=gun');

        const fullConfig = yaml.load(generateBuiltinClashConfig(nodes.join('\n'), { addFlagEmoji: false }));
        expect(fullConfig.proxies[0]).toMatchObject({
            name: 'JP-1',
            type: 'vless',
            network: 'grpc',
            'grpc-opts': {
                'grpc-service-name': 'update',
                'grpc-mode': 'gun'
            }
        });
    });

    it('preserves Trojan gRPC fields from Clash YAML through URL and builtin Clash output', () => {
        const clashConfig = `
proxies:
  - name: Trojan gRPC
    type: trojan
    server: trojan.example.com
    port: 443
    password: secret
    network: grpc
    sni: edge.example.com
    client-fingerprint: chrome
    skip-cert-verify: true
    grpc-opts:
      grpc-service-name: gateway
      grpc-mode: gun
`;

        const nodes = extractValidNodes(clashConfig);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toContain('type=grpc');
        expect(nodes[0]).toContain('serviceName=gateway');
        expect(nodes[0]).toContain('mode=gun');
        expect(nodes[0]).toContain('fp=chrome');

        const fullConfig = yaml.load(generateBuiltinClashConfig(nodes.join('\n'), { addFlagEmoji: false }));
        expect(fullConfig.proxies[0]).toMatchObject({
            name: 'Trojan gRPC',
            type: 'trojan',
            network: 'grpc',
            sni: 'edge.example.com',
            'client-fingerprint': 'chrome',
            'skip-cert-verify': true,
            'grpc-opts': {
                'grpc-service-name': 'gateway',
                'grpc-mode': 'gun'
            }
        });
    });

    it('preserves Hysteria2 options from Clash YAML through URL and builtin Clash output', () => {
        const clashConfig = `
proxies:
  - name: HY2 full
    type: hysteria2
    server: hy2.example.com
    port: 443
    password: secret
    sni: edge.example.com
    obfs: salamander
    obfs-password: obfs-secret
    skip-cert-verify: true
    ports: 20000-30000
    up: 100 Mbps
    down: 200 Mbps
    fast-open: true
`;

        const nodes = extractValidNodes(clashConfig);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toContain('ports=20000-30000');
        expect(nodes[0]).toContain('up=100%20Mbps');
        expect(nodes[0]).toContain('down=200%20Mbps');
        expect(nodes[0]).toContain('fast_open=1');

        const fullConfig = yaml.load(generateBuiltinClashConfig(nodes.join('\n'), { addFlagEmoji: false }));
        expect(fullConfig.proxies[0]).toMatchObject({
            name: 'HY2 full',
            type: 'hysteria2',
            ports: '20000-30000',
            up: '100 Mbps',
            down: '200 Mbps',
            'fast-open': true
        });
    });

    it('documents one-way exports whose emitted schemes are not parsed back yet', () => {
        const fixtures = [
            {
                proxy: {
                    name: 'Fixture Hysteria Legacy',
                    type: 'hysteria',
                    server: 'hy.example.com',
                    port: 8443,
                    password: 'hy-pass',
                    protocol: 'udp',
                    sni: 'hy-sni.example.com',
                    'skip-cert-verify': true,
                    up: 100,
                    down: 200
                },
                urlPattern: /^hysteria:\/\/hy-pass@hy\.example\.com:8443\?/,
                requiredParts: [
                    'protocol=udp',
                    'sni=hy-sni.example.com',
                    'insecure=1',
                    'up=100',
                    'down=200',
                    '#Fixture%20Hysteria%20Legacy'
                ]
            },
            {
                proxy: {
                    name: 'Fixture Naive Export',
                    type: 'naive',
                    server: 'naive.example.com',
                    port: 443,
                    username: 'user',
                    password: 'p@ss:word',
                    padding: true,
                    'extra-headers': 'Host: naive-front.example.com'
                },
                urlPattern: /^naive\+https:\/\/user:p%40ss%3Aword@naive\.example\.com:443\?/,
                requiredParts: [
                    'padding=true',
                    'extra-headers=Host%3A%20naive-front.example.com',
                    '#Fixture%20Naive%20Export'
                ]
            }
        ];

        for (const fixture of fixtures) {
            const url = convertClashProxyToUrl(fixture.proxy);
            expect(url).toMatch(fixture.urlPattern);
            for (const part of fixture.requiredParts) {
                expect(url).toContain(part);
            }
            expect(urlToClashProxy(url)).toBeNull();
            expect(urlsToClashProxies([url])).toEqual([]);
        }
    });

    it('parses v2rayn:// share links from v2rayNG 2.3.7+', () => {
        // HTTP 节点
        const httpConfig = {
            IndexId: 'AIy0Iw',
            ConfigType: 10,
            ConfigVersion: 4,
            Remarks: 'HTTP Test',
            Address: 'http.example.com',
            Port: 8080,
            Password: 'http-pass',
            Username: 'http-user'
        };
        const httpB64 = Buffer.from(JSON.stringify(httpConfig), 'utf8').toString('base64');
        const httpUrl = `v2rayn://http/${httpB64}`;

        const httpParsed = urlToClashProxy(httpUrl);
        expect(httpParsed).toMatchObject({
            name: 'HTTP Test',
            type: 'http',
            server: 'http.example.com',
            port: 8080,
            username: 'http-user',
            password: 'http-pass'
        });

        // VLESS 节点
        const vlessConfig = {
            IndexId: 'abc123',
            ConfigType: 1,
            ConfigVersion: 4,
            Remarks: 'VLESS Test',
            Address: 'vless.example.com',
            Port: 443,
            Password: '11111111-2222-3333-4444-555555555555',
            Network: 'ws',
            Path: '/ws',
            Host: 'vless.example.com',
            StreamSecurity: 'tls',
            Sni: 'vless.example.com',
            Alpn: 'h2,http/1.1',
            Fingerprint: 'chrome'
        };
        const vlessB64 = Buffer.from(JSON.stringify(vlessConfig), 'utf8').toString('base64');
        const vlessUrl = `v2rayn://vless/${vlessB64}`;

        const vlessParsed = urlToClashProxy(vlessUrl);
        expect(vlessParsed).toMatchObject({
            name: 'VLESS Test',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: '11111111-2222-3333-4444-555555555555',
            alterId: 0,
            network: 'ws',
            tls: true,
            sni: 'vless.example.com',
            servername: 'vless.example.com',
            'client-fingerprint': 'chrome',
            alpn: ['h2', 'http/1.1']
        });
        expect(vlessParsed['ws-opts']).toEqual({
            path: '/ws',
            headers: { Host: 'vless.example.com' }
        });

        // VMess 节点
        const vmessConfig = {
            IndexId: 'def456',
            ConfigType: 2,
            ConfigVersion: 4,
            Remarks: 'VMess Test',
            Address: 'vmess.example.com',
            Port: 443,
            Password: '22222222-3333-4444-5555-666666666666',
            AlterId: 0,
            Network: 'tcp',
            StreamSecurity: 'tls',
            Sni: 'vmess.example.com',
            Fingerprint: 'chrome'
        };
        const vmessB64 = Buffer.from(JSON.stringify(vmessConfig), 'utf8').toString('base64');
        const vmessUrl = `v2rayn://vmess/${vmessB64}`;

        const vmessParsed = urlToClashProxy(vmessUrl);
        expect(vmessParsed).toMatchObject({
            name: 'VMess Test',
            type: 'vmess',
            server: 'vmess.example.com',
            port: 443,
            uuid: '22222222-3333-4444-5555-666666666666',
            tls: true,
            sni: 'vmess.example.com'
        });

        // Trojan 节点
        const trojanConfig = {
            IndexId: 'ghi789',
            ConfigType: 4,
            ConfigVersion: 4,
            Remarks: 'Trojan Test',
            Address: 'trojan.example.com',
            Port: 443,
            Password: 'trojan-pass',
            StreamSecurity: 'tls',
            Sni: 'trojan.example.com'
        };
        const trojanB64 = Buffer.from(JSON.stringify(trojanConfig), 'utf8').toString('base64');
        const trojanUrl = `v2rayn://trojan/${trojanB64}`;

        const trojanParsed = urlToClashProxy(trojanUrl);
        expect(trojanParsed).toMatchObject({
            name: 'Trojan Test',
            type: 'trojan',
            server: 'trojan.example.com',
            port: 443,
            password: 'trojan-pass',
            tls: true,
            sni: 'trojan.example.com'
        });

        // 批量解析
        const allParsed = urlsToClashProxies([httpUrl, vlessUrl, vmessUrl, trojanUrl], { addFlagEmoji: false });
        expect(allParsed).toHaveLength(4);
        expect(allParsed.map(p => p.type)).toEqual(['http', 'vless', 'vmess', 'trojan']);
    });

    it('parses real v2rayn://vless link with Reality, raw network, and flow', () => {
        const realLink = 'v2rayn://vless/eyJJbmRleElkIjoiYVVjSWZBIiwiQ29uZmlnVHlwZSI6NSwiQ29uZmlnVmVyc2lvbiI6NCwiRGlzcGxheUxvZyI6dHJ1ZSwiUmVtYXJrcyI6Ilx1RDgzQ1x1RERFRlx1RDgzQ1x1RERGNVZJUOaXpeacrDExLeS4iee9keS8mOWMljRLMjBXIiwiQWRkcmVzcyI6ImpwMTEuc2FueXVhbi5jeW91IiwiUG9ydCI6NDEyMTMsIlBhc3N3b3JkIjoiNmQxMTg0N2EtMDcwOC00MjE1LWExMGItY2I4OTVkZWE0Y2RmIiwiTmV0d29yayI6InJhdyIsIlN0cmVhbVNlY3VyaXR5IjoicmVhbGl0eSIsIlNuaSI6ImFkZG9ucy5tb3ppbGxhLm9yZyIsIkZpbmdlcnByaW50IjoiY2hyb21lIiwiUHVibGljS2V5IjoiZHlxVjFZakNnUHdWZmllUkZNRXN4OEYwaXZINjFINXVGRjE4elRLWnNuVSIsIlNob3J0SWQiOiJjODUyZGE0MiIsIkFsdGVySWQiOjAsIlByb3RvRXh0cmFPYmoiOnsiRmxvdyI6Inh0bHMtcnByeC12aXNpb24iLCJWbWVzc0VuY3J5cHRpb24iOiJub25lIn0sIlRyYW5zcG9ydEV4dHJhT2JqIjp7IlJhd0hlYWRlckl0eXBlIjoibm9uZSJ9fQ';

        const parsed = urlToClashProxy(realLink);
        expect(parsed).toMatchObject({
            type: 'vless',
            server: 'jp11.sanyuan.cyou',
            port: 41213,
            tls: true,
            sni: 'addons.mozilla.org',
            servername: 'addons.mozilla.org',
            'client-fingerprint': 'chrome',
            flow: 'xtls-rprx-vision',
            'public-key': 'dyqV1YjCgPwVfieRFMEsx8F0ivH61H5uFF18zTKZsnU',
            'short-id': 'c852da42'
        });
        expect(parsed.network).toBeUndefined();
    });

    it('returns null for invalid v2rayn:// payloads', () => {
        expect(urlToClashProxy('v2rayn://http/not-json')).toBeNull();
        expect(urlToClashProxy('v2rayn://')).toBeNull();
        // policy group 不能作为代理
        const groupConfig = {
            IndexId: 'grp1',
            ConfigType: 101,
            ConfigVersion: 4,
            Remarks: 'test_group',
            ProtoExtraObj: { ChildItems: 'node1' }
        };
        const groupB64 = Buffer.from(JSON.stringify(groupConfig), 'utf8').toString('base64');
        expect(urlToClashProxy(`v2rayn://policygroup/${groupB64}`)).toBeNull();
    });

    it('parses v2rayn:// links with name fragment appended by prependNodeName', () => {
        const vlessConfig = {
            IndexId: 'test1',
            ConfigType: 5,
            ConfigVersion: 4,
            Remarks: 'VLESS With Fragment',
            Address: 'vless-frag.example.com',
            Port: 443,
            Password: '11111111-2222-3333-4444-555555555555',
            Network: 'ws',
            Path: '/ws',
            Host: 'vless.example.com',
            StreamSecurity: 'reality',
            Sni: 'vless.example.com',
            Fingerprint: 'chrome',
            PublicKey: 'test-public-key',
            ShortId: 'abcd1234',
            ProtoExtraObj: { Flow: 'xtls-rprx-vision' }
        };
        const b64 = Buffer.from(JSON.stringify(vlessConfig), 'utf8').toString('base64');
        const urlWithFragment = `v2rayn://vless/${b64}#手动节点 - VLESS With Fragment`;

        const parsed = urlToClashProxy(urlWithFragment);
        expect(parsed).toMatchObject({
            name: 'VLESS With Fragment',
            type: 'vless',
            server: 'vless-frag.example.com',
            port: 443,
            uuid: '11111111-2222-3333-4444-555555555555',
            flow: 'xtls-rprx-vision',
            'public-key': 'test-public-key',
            'short-id': 'abcd1234'
        });
    });

    // Regression: these airports pin the server certificate and hop ports. Losing
    // either field makes every node fail TLS validation, which surfaces in Clash as
    // a latency timeout rather than an error.
    it('preserves certificate pinning and port hopping across the URL hop', () => {
        const fixtures = [
            {
                label: 'hysteria2 with pin and port hopping',
                proxy: {
                    name: 'Fixture HY2 Pin',
                    type: 'hysteria2',
                    server: 'aws-linkhy9.lxyun.xyz',
                    port: 60000,
                    ports: '60000-65530',
                    mport: '60000-65530',
                    udp: true,
                    'skip-cert-verify': true,
                    sni: 'iosapps.itunes.apple.com',
                    password: '794d1aa5-0da8-42cd-83ee-de90c9d0f42f',
                    fingerprint: '2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45'
                },
                expected: {
                    type: 'hysteria2',
                    server: 'aws-linkhy9.lxyun.xyz',
                    port: 60000,
                    ports: '60000-65530',
                    mport: '60000-65530',
                    udp: true,
                    sni: 'iosapps.itunes.apple.com',
                    'skip-cert-verify': true,
                    fingerprint: '2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45'
                }
            },
            {
                label: 'vless with pin and xtls flow',
                proxy: {
                    name: 'Fixture VLESS Pin',
                    type: 'vless',
                    server: 'aws-link1.lxyun.xyz',
                    port: 443,
                    uuid: '794d1aa5-0da8-42cd-83ee-de90c9d0f42f',
                    udp: true,
                    tls: true,
                    'skip-cert-verify': true,
                    flow: 'xtls-rprx-vision',
                    'client-fingerprint': 'safari',
                    servername: 'iosapps.itunes.apple.com',
                    fingerprint: 'd5c39647e414c144b719bc49cb41c4b8f46f09f4cf26c863cae15c01d4a7b96a'
                },
                expected: {
                    type: 'vless',
                    server: 'aws-link1.lxyun.xyz',
                    port: 443,
                    udp: true,
                    tls: true,
                    'skip-cert-verify': true,
                    flow: 'xtls-rprx-vision',
                    'client-fingerprint': 'safari',
                    sni: 'iosapps.itunes.apple.com',
                    fingerprint: 'd5c39647e414c144b719bc49cb41c4b8f46f09f4cf26c863cae15c01d4a7b96a'
                }
            },
            {
                label: 'trojan with pin',
                proxy: {
                    name: 'Fixture Trojan Pin',
                    type: 'trojan',
                    server: 'tj.example.com',
                    port: 443,
                    password: 'trojan-pass',
                    udp: true,
                    tls: true,
                    'skip-cert-verify': true,
                    'client-fingerprint': 'chrome',
                    sni: 'tj.example.com',
                    fingerprint: 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899'
                },
                expected: {
                    type: 'trojan',
                    server: 'tj.example.com',
                    port: 443,
                    udp: true,
                    'skip-cert-verify': true,
                    'client-fingerprint': 'chrome',
                    sni: 'tj.example.com',
                    fingerprint: 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899'
                }
            }
        ];

        for (const { label, proxy, expected } of fixtures) {
            const url = convertClashProxyToUrl(proxy);
            expect(url, label).toBeTruthy();

            const restored = urlToClashProxy(url);
            expect(restored, label).toMatchObject(expected);

            // The same must hold through the full builtin pipeline.
            const full = yaml.load(
                generateBuiltinClashConfig(url, { addFlagEmoji: false })
            );
            expect(stripGeneratedFields(full.proxies[0]), label).toMatchObject(expected);
        }
    });

    it('defaults Hysteria2 to udp and keeps an explicit opt-out', () => {
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443?sni=s.example.com#HY2'))
            .toMatchObject({ udp: true });
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443?udp=0#HY2'))
            .toMatchObject({ udp: false });
    });

    // Airports that serve share links to a v2rayN User-Agent spell the certificate
    // pin pinSHA256 / pcs rather than fp, and send insecure explicitly as false.
    // Reading only our own spelling silently dropped those pins, which surfaced as
    // a latency timeout on every node.
    it('reads certificate pins from v2rayN share-link parameter names', () => {
        const hy = urlToClashProxy(
            'hysteria2://pw@aws-linkhy9.lxyun.xyz:60000/?insecure=false&sni=iosapps.itunes.apple.com'
            + '&pinSHA256=2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45'
            + '&mport=60000-65530#HY'
        );
        expect(hy.fingerprint).toBe('2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45');
        expect(hy.mport).toBe('60000-65530');
        expect(hy.udp).toBe(true);

        const vless = urlToClashProxy(
            'vless://uuid-1@aws-link1.lxyun.xyz:443?encryption=none&security=tls'
            + '&flow=xtls-rprx-vision&fp=safari&insecure=1&sni=iosapps.itunes.apple.com'
            + '&pcs=d5c39647e414c144b719bc49cb41c4b8f46f09f4cf26c863cae15c01d4a7b96a#HK'
        );
        expect(vless.fingerprint).toBe('d5c39647e414c144b719bc49cb41c4b8f46f09f4cf26c863cae15c01d4a7b96a');
        expect(vless['client-fingerprint']).toBe('safari');
        expect(vless['skip-cert-verify']).toBe(true);
    });

    it('distinguishes an explicit insecure=0 from an absent flag', () => {
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443?insecure=0#HY'))
            .toMatchObject({ 'skip-cert-verify': false });
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443?insecure=false#HY'))
            .toMatchObject({ 'skip-cert-verify': false });
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443?insecure=1#HY'))
            .toMatchObject({ 'skip-cert-verify': true });
        expect(urlToClashProxy('hysteria2://pw@a.example.com:443#HY'))
            .not.toHaveProperty('skip-cert-verify');
    });

    // The airport contradicts itself: the same Hysteria2 node ships as
    // pinSHA256 + insecure=false in share links but as fingerprint +
    // skip-cert-verify: true in its Clash YAML. Honouring the false there makes
    // the client reject the self-signed certificate and time out, so a pinned
    // certificate wins over the flag.
    it('trusts a pinned certificate over an explicit insecure=0', () => {
        const pinned = urlToClashProxy(
            'hysteria2://pw@a.example.com:443?insecure=false&sni=s.example.com'
            + '&pinSHA256=2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45#HY'
        );
        expect(pinned.fingerprint).toBe('2b6c9b75b2ef903fbe66ee91d1801941dea0ddb5429505ae3bce65e2fb17ad45');
        expect(pinned['skip-cert-verify']).toBe(true);

        // Without a pin there is nothing to fall back on, so the flag is honoured.
        const unpinned = urlToClashProxy('hysteria2://pw@a.example.com:443?insecure=0#HY');
        expect(unpinned).not.toHaveProperty('fingerprint');
        expect(unpinned['skip-cert-verify']).toBe(false);
    });

    it('keeps client-fingerprint and certificate pinning as separate fields', () => {
        const url = convertClashProxyToUrl({
            name: 'Both Kinds',
            type: 'vless',
            server: 'a.example.com',
            port: 443,
            uuid: 'u-1',
            tls: true,
            'client-fingerprint': 'safari',
            fingerprint: 'deadbeef'
        });

        const restored = urlToClashProxy(url);
        expect(restored['client-fingerprint']).toBe('safari');
        expect(restored.fingerprint).toBe('deadbeef');
    });
});
