const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
const cheerio = require('cheerio');
const httpProxy = require('http-proxy'); // WS中継用に導入
require('dotenv').config();

const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];

// 生存確認 (0.1秒)
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        const url = proxyUrl.replace('socks5://', '');
        const [host, port] = url.split(':');
        const socket = new net.Socket();
        socket.setTimeout(100);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        const fail = () => { socket.destroy(); resolve(false); };
        socket.on('timeout', fail);
        socket.on('error', fail);
        socket.connect(port, host);
    });
}

async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        allNodes = [...new Set(res.data.split('\n').map(s => s.trim()).filter(s => s.startsWith('socks5://')))];
    } catch (e) {}
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        // SwitchyOmegaからのWebSocketはここを自動で通る
        for (let i = 0; i < Math.min(allNodes.length, 30); i++) {
            if (await isAlive(allNodes[i])) {
                return { upstreamProxyUrl: allNodes[i], requestHeaders: { ...request.headers, 'x-forwarded-for': undefined } };
            }
        }
        return {};
    },
});

bridge.listen(async () => {
    process.stdout.write(`[READY] WebSocket Enabled Hybrid Proxy\n`);

    // --- HTTPリクエスト処理 ---
    bridge.server.on('request', async (req, res) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;

        if (urlParam === "" || urlParam === "index.html") {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getDashboardHTML());
            return;
        }

        if (urlParam.startsWith('http')) {
            try {
                const targetUrl = new URL(urlParam);
                const response = await axios.get(targetUrl.href, { responseType: 'text', headers: { 'User-Agent': req.headers['user-agent'] } });
                const $ = cheerio.load(response.data);
                
                // WebSocketの接続先も自分のサーバーに向けるように書き換え（簡易版）
                $('a, link, script, img').each((i, el) => {
                    const attr = $(el).attr('href') ? 'href' : 'src';
                    const val = $(el).attr(attr);
                    if (val && !val.startsWith('data:')) {
                        try { $(el).attr(attr, '/' + new URL(val, targetUrl.href).href); } catch (e) {}
                    }
                });

                res.writeHead(200, { 'Content-Type': response.headers['content-type'] });
                res.end($.html());
            } catch (e) { res.end("Error: " + e.message); }
        }
    });

    // --- WebSocket中継処理 (Upgrade) ---
    // /:URL形式でアクセスしたサイトがWSを要求した場合に発火
    bridge.server.on('upgrade', (req, socket, head) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;
        if (urlParam.startsWith('http')) {
            const target = new URL(urlParam).origin;
            proxy.ws(req, socket, head, { target: target });
        }
    });
});

function getDashboardHTML() { /* 前回のHTMLと同じ */ }
