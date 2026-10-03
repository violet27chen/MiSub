import { t } from '@/i18n/index.js';

/**
 * 纯前端的节点连通性测试工具。
 *
 * 重要限制：浏览器只能测试 TCP 可达性，无法验证代理协议本身是否可用。
 * 真实的代理可用性必须在 Clash / sing-box 等客户端内测试。
 */

/** 无法通过浏览器 TCP 探测判断可用性的协议（UDP-only）。 */
const UDP_ONLY_PROTOCOLS = new Set([
  'hysteria',
  'hysteria2',
  'hy',
  'hy2',
  'tuic',
  'wireguard',
]);

/** 从节点 URL 中提取协议前缀（小写，不含 "://"）。 */
export function extractProtocolFromUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const match = url.trim().match(/^([a-z0-9+.-]+):\/\//i);
    return match ? match[1].toLowerCase() : '';
}

/** 判断该协议是否为 UDP-only（浏览器无法有效测速）。 */
export function isUdpOnlyProtocol(url) {
    return UDP_ONLY_PROTOCOLS.has(extractProtocolFromUrl(url));
}

/**
 * 失败快于该阈值（毫秒）视为「根本没有到达对端」：DNS 解析失败或连接被拒绝。
 * RST / NXDOMAIN 是本地或极近距离返回的，不会消耗一个完整 RTT；
 * 而真正建立 TCP 连接后因协议不匹配而失败，至少要付出一个 RTT 的代价。
 */
const FAST_FAIL_THRESHOLD_MS = 120;

/**
 * 测试单个节点的 TCP 连通性
 * @param {string} host 节点服务器 IP 或域名
 * @param {number|string} port 节点端口
 * @param {number} timeoutMs 超时时间（毫秒）
 * @param {Object} [options]
 * @param {string} [options.url] 节点原始 URL，用于识别 UDP-only 协议
 * @returns {Promise<{status: 'ok'|'timeout'|'error'|'unsupported', latency: number, message?: string}>}
 */
export async function pingNode(host, port, timeoutMs = 3000, options = {}) {
    if (!host || !port) {
        return { status: 'error', latency: -1, message: t('utils.invalidAddressOrPort') };
    }

    if (isUdpOnlyProtocol(options.url)) {
        return {
            status: 'unsupported',
            latency: -1,
            message: t('utils.udpProtocolUntestable')
        };
    }

    return new Promise((resolve) => {
        const start = performance.now();
        const controller = new AbortController();

        const timeoutId = setTimeout(() => {
            controller.abort();
            resolve({ status: 'timeout', latency: timeoutMs });
        }, timeoutMs);

        // 若页面本身是 HTTPS，浏览器会拦截 http:// 请求（Mixed Content），
        // 且该拦截几乎不产生网络耗时，会造成假超时，因此统一使用 https:// 探测。
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

        const cacheBuster = Date.now() + Math.random().toString(36).substring(7);
        const displayHost = String(host).includes(':') && !String(host).startsWith('[')
            ? `[${host}]`
            : host;
        const testUrl = `${protocol}//${displayHost}:${port}/__ping_${cacheBuster}`;

        fetch(testUrl, {
            mode: 'no-cors',
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal
        }).then(() => {
            // 对端确实响应了 HTTP，这是一次真实的往返。
            clearTimeout(timeoutId);
            resolve({ status: 'ok', latency: Math.round(performance.now() - start) });
        }).catch((err) => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                resolve({ status: 'timeout', latency: timeoutMs });
                return;
            }

            const elapsed = Math.round(performance.now() - start);
            if (elapsed < FAST_FAIL_THRESHOLD_MS) {
                // 快速失败：DNS 解析失败或端口直接拒绝连接，节点不可达。
                resolve({ status: 'error', latency: -1, message: t('utils.nodeUnreachable') });
            } else {
                // TCP 连接已建立（付出过一个 RTT），但协议不匹配导致握手失败。
                // 这只能证明端口活着，不能证明代理可用。
                resolve({
                    status: 'ok',
                    latency: elapsed,
                    message: t('utils.tcpReachableOnly')
                });
            }
        });
    });
}