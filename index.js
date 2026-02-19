const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
require('dotenv').config();

// ログのバッファリングを無効化（Renderのログに即時反映させる）
process.stdout.isTTY = true;

const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];

// 0.1秒（100ms）の超高速生存確認
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        try {
            const url = proxyUrl.replace('socks5://', '');
            const [host, port] = url.split(':');
            const socket = new net.Socket();
            
            socket.setTimeout(100); // ここで足切り時間を設定

            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });

            const fail = () => {
                socket.destroy();
                resolve(false);
            };

            socket.on('timeout', fail);
            socket.on('error', fail);
            socket.connect(port, host);
        } catch (e) {
            resolve(false);
        }
    });
}

// プロキシリストの同期
async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        // 重複を排除し、socks5:// で始まる行のみ抽出
        allNodes = [...new Set(res.data.split('\n')
            .map(s => s.trim())
            .filter(s => s.startsWith('socks5://')))];
        process.stdout.write(`\n[SYSTEM] List updated: ${allNodes.length} nodes available.\n`);
    } catch (e) {
        process.stdout.write(`\n[ERROR] Failed to fetch proxy list: ${e.message}\n`);
    }
}

// 初回実行と15分ごとの更新
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        // リクエストが届いたら必ずログを出す
        process.stdout.write(`\n[REQUEST] ${request.method} ${request.url}\n`);

        if (allNodes.length === 0) {
            process.stdout.write(`[WARN] No nodes available in list.\n`);
            return {};
        }

        // 最大3周、リストをスキャンして生きているものを探す
        for (let loop = 1; loop <= 3; loop++) {
            // 負荷軽減のため、上位100件程度をスキャン対象にする
            const testLimit = Math.min(allNodes.length, 100);
            
            for (let i = 0; i < testLimit; i++) {
                const targetNode = allNodes[i];
                
                if (await isAlive(targetNode)) {
                    process.stdout.write(`[OK] Proxy Found (Loop ${loop}): ${targetNode}\n`);
                    return {
                        upstreamProxyUrl: targetNode,
                        requestHeaders: {
                            ...request.headers,
                            'x-forwarded-for': undefined,
                            'via': undefined,
                            'forwarded': undefined,
                            'connection': 'keep-alive'
                        }
                    };
                }
            }
            // 1周して見つからなければ0.5秒待機して次周へ
            await new Promise(r => setTimeout(r, 500));
        }

        process.stdout.write(`[FAIL] All retry loops failed. Using direct connection.\n`);
        return {}; 
    },
});

bridge.listen(() => {
    process.stdout.write(`\n[READY] Proxy Server running on port ${bridge.port}\n`);
});
