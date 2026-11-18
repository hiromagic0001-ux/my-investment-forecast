import http from "node:http";

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = "https://my-investment-forecast.onrender.com";
const stocks = [
  ["9989","サンドラッグ"],["4097","高圧ガス工業"],["4206","アイカ工業"],
  ["4958","長谷川香料"],["8725","MS&ADインシュアランスグループHD"],
  ["6785","鈴木"],["7723","愛知時計電機"],["2169","CDS"],
  ["9757","船井総研HD"],["4641","アルプス技研"],
  ["3817","SRAホールディングス"],["3901","マークラインズ"]
];
let lastRefreshAt = 0;

function send(res, status, body, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Vary": "Origin"
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    });
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") return send(res, 200, {ok:true}, origin);
  if (req.method !== "GET" || req.url !== "/api/prices") return send(res, 404, {error:"Not found"}, origin);
  if (origin !== ALLOWED_ORIGIN) return send(res, 403, {error:"Origin not allowed"}, origin);
  if (Date.now() - lastRefreshAt < 30000) return send(res, 429, {error:"更新間隔は30秒以上あけてください。"}, origin);
  lastRefreshAt = Date.now();

  const output = {generatedAt:new Date().toISOString(), source:"Yahoo Finance chart API", stocks:{}};
  let failures = 0;
  for (let i=0; i<stocks.length; i+=3) {
    const batch = stocks.slice(i,i+3);
    await Promise.all(batch.map(async ([code,name]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=1y&interval=1d`;
        const response = await fetch(url, {headers:{"User-Agent":"Mozilla/5.0 (compatible; InvestmentForecast/1.0)"}});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const result = json.chart?.result?.[0];
        if (!result?.timestamp || !result.indicators?.quote?.[0]) throw new Error("価格データなし");
        const q = result.indicators.quote[0];
        const rows = result.timestamp.map((t,i)=>({t,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]}))
          .filter(x=>Number.isFinite(x.o)&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c));
        if (rows.length < 200) throw new Error(`日足データ不足（${rows.length}件）`);
        output.stocks[code] = {name,rows,status:"ok"};
      } catch (error) {
        failures++;
        output.stocks[code] = {name,rows:[],status:"error",error:String(error.message||error)};
      }
    }));
  }
  output.failures = failures;
  send(res, failures === stocks.length ? 502 : 200, output, origin);
});

server.listen(PORT, "0.0.0.0", () => console.log(`Buy-watch price API listening on ${PORT}`));
