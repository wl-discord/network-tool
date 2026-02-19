const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
require('dotenv').config();

const DATA_SOURCE = process.env.DATA_SOURCE;
let allNodes = [];

// 0.1秒タイムアウトの生存確認関数
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        const url = proxyUrl.replace('socks5://', '');
        const [host, port] = url.split(':');
        const socket = new net.Socket();
        
        socket.setTimeout(100); // 0.1秒

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
    });
}

// リスト取得
async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        allNodes = res.data.split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        console.log(`List synced: ${allNodes.length} nodes.`);
    } catch (e) {
        console.error('Sync failed.');
    }
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        if (allNodes.length === 0) return {};

        // 最大3周（ループ）回す
        for (let loop = 1; loop <= 3; loop++) {
            console.log(`Loop ${loop}: Searching for an active node...`);
            
            // リストの上から順に試行
            for (let i = 0; i < allNodes.length; i++) {
                const targetNode = allNodes[i];
                
                // 接続テスト
                const success = await isAlive(targetNode);
                
                if (success) {
                    console.log(`Success! Using node: ${targetNode}`);
                    return {
                        upstreamProxyUrl: targetNode,
                        requestHeaders: {
                            ...request.headers,
                            'x-forwarded-for': undefined,
                            'via': undefined
                        }
                    };
                }
            }
            console.log(`Loop ${loop} failed: No active nodes found.`);
        }

        console.error("All 3 loops failed. Giving up.");
        return {}; // 3回全滅した場合は直結または拒否
    },
});

bridge.listen(() => {
    console.log(`Retry-heavy relay initialized. Timeout: 0.1s`);
});
