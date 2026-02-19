const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
require('dotenv').config();

const DATA_SOURCE = process.env.DATA_SOURCE;
let allNodes = [];

// 0.1秒の高速生存確認
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        try {
            const url = proxyUrl.replace('socks5://', '');
            const [host, port] = url.split(':');
            const socket = new net.Socket();
            
            socket.setTimeout(100); // 0.1秒足切り

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

// リスト取得
async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        // 重複削除と整形
        allNodes = [...new Set(res.data.split('\n')
            .map(s => s.trim())
            .filter(s => s.startsWith('socks5://')))];
        console.log(`[System] List updated: ${allNodes.length} nodes available.`);
    } catch (e) {
        console.error('[Error] Failed to fetch proxy list.');
    }
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    // SwitchyOmegaからの接続を処理
    prepareRequestFunction: async ({ request }) => {
        if (allNodes.length === 0) return {};

        // 最大3周リトライ
        for (let loop = 1; loop <= 3; loop++) {
            // 無料プロキシはリストの下の方は死んでいることが多いので、
            // 効率化のために上位100件程度をスキャン
            const testLimit = Math.min(allNodes.length, 100);
            
            for (let i = 0; i < testLimit; i++) {
                const targetNode = allNodes[i];
                
                if (await isAlive(targetNode)) {
                    // 生存確認が取れたら、ブラウザ側のリクエストを通す
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
            // 1周して見つからなければ、少し待って次へ（サーバーの負荷軽減）
            await new Promise(r => setTimeout(r, 500));
        }

        return {}; // 3周して全滅なら直結（エラー回避）
    },
});

bridge.listen(() => {
    console.log(`[Ready] SwitchyOmega-optimized Proxy on port ${bridge.port}`);
});
