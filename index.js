const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
require('dotenv').config();

// ログ出力設定
process.stdout.isTTY = true;

const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];

// 0.1秒の高速生存確認
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        try {
            const url = proxyUrl.replace('socks5://', '');
            const [host, port] = url.split(':');
            const socket = new net.Socket();
            socket.setTimeout(100); 

            socket.on('connect', () => { socket.destroy(); resolve(true); });
            const fail = () => { socket.destroy(); resolve(false); };
            socket.on('timeout', fail);
            socket.on('error', fail);
            socket.connect(port, host);
        } catch (e) { resolve(false); }
    });
}

// プロキシリスト取得
async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        allNodes = [...new Set(res.data.split('\n').map(s => s.trim()).filter(s => s.startsWith('socks5://')))];
        process.stdout.write(`\n[SYSTEM] Nodes Loaded: ${allNodes.length}\n`);
    } catch (e) { process.stdout.write(`\n[ERROR] Sync failed\n`); }
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        // Socket.IOのリクエスト（WebSocket）を検知
        const isSocketIO = request.url.includes('socket.io');
        if (isSocketIO) {
            process.stdout.write(`[CHAT-WS] Active Socket.IO Connection\n`);
        }

        // リストから生きているプロキシを3周リトライで探す
        for (let loop = 1; loop <= 3; loop++) {
            const testLimit = Math.min(allNodes.length, 50);
            for (let i = 0; i < testLimit; i++) {
                const targetNode = allNodes[i];
                if (await isAlive(targetNode)) {
                    return {
                        upstreamProxyUrl: targetNode,
                        requestHeaders: {
                            ...request.headers,
                            'x-forwarded-for': undefined,
                            'via': undefined,
                            'connection': 'keep-alive' // Socket.IO維持のために重要
                        }
                    };
                }
            }
        }
        return {}; // 全滅時は直結
    },
});

bridge.listen(() => {
    process.stdout.write(`\n[READY] chochat Optimized Proxy Running\n`);
});
