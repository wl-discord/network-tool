const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
const cheerio = require('cheerio'); // HTML書き換え用
require('dotenv').config();

process.stdout.isTTY = true;

const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];
let requestCount = 0;

// 爆速生存確認 (0.1秒)
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

// --- プロキシサーバー設定 ---
const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        requestCount++;
        // SwitchyOmegaからのリクエストを処理
        for (let loop = 1; loop <= 2; loop++) {
            const testLimit = Math.min(allNodes.length, 30);
            for (let i = 0; i < testLimit; i++) {
                const targetNode = allNodes[i];
                if (await isAlive(targetNode)) {
                    return { upstreamProxyUrl: targetNode, requestHeaders: { ...request.headers, 'x-forwarded-for': undefined } };
                }
            }
        }
        return {};
    },
});

bridge.listen(async () => {
    process.stdout.write(`\n[READY] Hybrid Engine Active\n`);

    bridge.server.on('request', async (req, res) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;

        // 1. ダッシュボード
        if (urlParam === "" || urlParam === "index.html") {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getDashboardHTML());
            return;
        }

        // 2. フルWebプロキシ (リンク書き換えエンジン)
        if (urlParam.startsWith('http')) {
            try {
                const targetUrl = new URL(urlParam);
                process.stdout.write(`[WEB-PROXY] Fetching: ${targetUrl.href}\n`);

                const response = await axios.get(targetUrl.href, {
                    responseType: 'text',
                    headers: { 'User-Agent': req.headers['user-agent'] }
                });

                // HTML内のリンクを "/https://..." 形式に書き換える
                const $ = cheerio.load(response.data);
                $('a, link, script, img').each((i, el) => {
                    const attr = $(el).attr('href') ? 'href' : 'src';
                    const originalVal = $(el).attr(attr);
                    if (originalVal && !originalVal.startsWith('data:')) {
                        try {
                            const absoluteUrl = new URL(originalVal, targetUrl.href).href;
                            $(el).attr(attr, '/' + absoluteUrl);
                        } catch (e) {}
                    }
                });

                res.writeHead(200, { 'Content-Type': response.headers['content-type'] });
                res.end($.html());
            } catch (e) {
                res.writeHead(500);
                res.end("Proxy Error: " + e.message);
            }
            return;
        }
    });
});

function getDashboardHTML() {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Hybrid Proxy Dashboard</title>
        <style>
            body { background: #0a0a0a; color: #00d4ff; font-family: monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .box { border: 2px solid #00d4ff; padding: 40px; border-radius: 20px; box-shadow: 0 0 20px #00d4ff; text-align: center; }
            input { width: 300px; padding: 10px; border: 1px solid #00d4ff; background: #000; color: #fff; border-radius: 5px; }
            button { padding: 10px 20px; background: #00d4ff; color: #000; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
            .status { margin-top: 20px; font-size: 0.8rem; opacity: 0.7; }
        </style>
    </head>
    <body>
        <div class="box">
            <h1>HYBRID PROXY NODE</h1>
            <p>Enter URL to start FULL PROXY session:</p>
            <input type="text" id="url" placeholder="https://example.com">
            <button onclick="location.href='/' + document.getElementById('url').value">GO</button>
            <div class="status">
                Nodes: ${allNodes.length} | Total Hits: ${requestCount}<br>
                Mode: SwitchyOmega (443) + Direct Web Proxy
            </div>
        </div>
    </body>
    </html>`;
}
