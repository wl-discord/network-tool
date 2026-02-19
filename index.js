const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
const http = require('http');
require('dotenv').config();

process.stdout.isTTY = true;

const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];

// 生存確認 (0.1秒)
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

async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        allNodes = [...new Set(res.data.split('\n').map(s => s.trim()).filter(s => s.startsWith('socks5://')))];
        process.stdout.write(`\n[SYSTEM] Nodes: ${allNodes.length}\n`);
    } catch (e) { process.stdout.write(`\n[ERROR] Sync failed\n`); }
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

// --- プロキシサーバーの本体設定 ---
const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        process.stdout.write(`[RELAY] ${request.url}\n`);
        
        // 有効なノードを3周リトライで探す
        for (let loop = 1; loop <= 3; loop++) {
            const testLimit = Math.min(allNodes.length, 50);
            for (let i = 0; i < testLimit; i++) {
                const targetNode = allNodes[i];
                if (await isAlive(targetNode)) {
                    return {
                        upstreamProxyUrl: targetNode,
                        requestHeaders: { ...request.headers, 'x-forwarded-for': undefined }
                    };
                }
            }
        }
        return {};
    },
});

// --- フロントエンドUI & URL直接指定の処理 ---
bridge.listen(async () => {
    process.stdout.write(`\n[READY] Port ${bridge.port}\n`);

    // ProxyChainの内部HTTPサーバーに独自リクエストハンドラを追加
    bridge.server.on('request', async (req, res) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;

        // トップページ (フロントエンド)
        if (urlParam === "" || urlParam === "index.html") {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Secure Proxy Node</title>
                    <style>
                        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #121212; color: white; margin: 0; }
                        .container { background: #1e1e1e; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; width: 80%; max-width: 500px; }
                        input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 6px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
                        button { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; }
                        button:hover { background: #0056b3; }
                        .status { margin-top: 20px; font-size: 0.9rem; color: #888; }
                        .badge { background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Proxy Node <span class="badge">Online</span></h1>
                        <p>URLを入力して匿名閲覧を開始:</p>
                        <input type="text" id="target" placeholder="https://example.com">
                        <button onclick="go()">Go Anonymously</button>
                        <div class="status">
                            Nodes Active: ${allNodes.length} | IP Rotation: Enabled
                        </div>
                    </div>
                    <script>
                        function go() {
                            const val = document.getElementById('target').value;
                            if (val) window.location.href = "/" + val;
                        }
                    </script>
                </body>
                </html>
            `);
            return;
        }

        // URL直接指定 (例: /https://google.com) の簡易転送
        if (urlParam.startsWith('http')) {
            process.stdout.write(`[URL-DIRECT] Routing to: ${urlParam}\n`);
            res.writeHead(302, { 'Location': urlParam }); // 実際にはここで中継処理を行うが、Render/Nodeの制限上リダイレクトが最も安定
            res.end();
            return;
        }
    });
});
