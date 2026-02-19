const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
require('dotenv').config();

// ログ出力を即時反映
process.stdout.isTTY = true;

const DATA_SOURCE = process.env.DATA_SOURCE;
let allNodes = [];

// 生存確認 (0.1秒)
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        try {
            // "socks5://host:port" から host と port を取り出す
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

// リスト更新 (socks5:// が最初からついている前提でフィルタリング)
async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        // 空行を除去し、重複を排除
        allNodes = [...new Set(res.data.split('\n')
            .map(s => s.trim())
            .filter(s => s.startsWith('socks5://')))];
        process.stdout.write(`\n[SYSTEM] Nodes Loaded: ${allNodes.length}\n`);
    } catch (e) {
        process.stdout.write(`\n[ERROR] Failed to fetch list: ${e.message}\n`);
    }
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        // chochatのSocket.IO接続をログで確認
        if (request.url.includes('socket.io')) {
            process.stdout.write(`[CHAT-SESSION] WebSocket packet relayed\n`);
        }

        // リストの上から順に、生きている爆速プロキシを探す
        for (let loop = 1; loop <= 3; loop++) {
            const scanLimit = Math.min(allNodes.length, 50);
            for (let i = 0; i < scanLimit; i++) {
                const targetNode = allNodes[i]; // ここに既に socks5:// が入っている
                
                if (await isAlive(targetNode)) {
                    return {
                        upstreamProxyUrl: targetNode,
                        requestHeaders: {
                            ...request.headers,
                            'x-forwarded-for': undefined,
                            'connection': 'keep-alive' // チャットの切断防止
                        }
                    };
                }
            }
        }
        return {}; // 全滅時は直結
    },
});

bridge.listen(() => {
    process.stdout.write(`\n[READY] chochat Proxy started. DataSource: ${DATA_SOURCE}\n`);
});
