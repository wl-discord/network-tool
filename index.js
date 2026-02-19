const axios = require('axios');
require('dotenv').config();

// ライブラリ名を隠して読み込み
const Library = require('proxy-chain');

const URL = process.env.DATA_SOURCE;
let list = [];

async function update() {
    try {
        const res = await axios.get(URL);
        list = res.data.split('\n').filter(l => l.includes('socks5://'));
    } catch (e) {}
}
update();
setInterval(update, 1000 * 60 * 30);

const app = new Library.Server({
    port: process.env.PORT || 8080,
    host: '0.0.0.0',
    prepareRequestFunction: () => {
        const upstream = list[Math.floor(Math.random() * list.length)];
        return {
            upstreamProxyUrl: upstream,
            requestHeaders: {
                'x-forwarded-for': undefined,
                'via': undefined,
                'forwarded': undefined
            }
        };
    }
});

app.listen(() => console.log(`Service ready` || app.port));
