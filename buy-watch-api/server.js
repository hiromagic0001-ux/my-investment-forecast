import http from "node:http";

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = "https://my-investment-forecast.onrender.com";
const stocks = [["1343","NEXT FUNDS 東証REIT指数連動型上場投信"],["1414","ショーボンドホールディングス"],["1514","住石ホールディングス"],["1605","インペックス"],["1928","積水ハウス"],["2003","日東富士製粉"],["2124","ジェイエイシーリクルートメント"],["2169","CDS"],["2659","サンエー"],["2914","日本たばこ産業"],["3003","ヒューリック"],["3076","あい ホールディングス"],["3231","野村不動産ホールディングス"],["3333","あさひ"],["3371","ソフトクリエイトホールディングス"],["3817","SRAホールディングス"],["3844","コムチュア"],["3901","マークラインズ"],["3923","ラクス"],["4008","住友精化"],["4041","日本曹達"],["4042","東ソー"],["4097","高圧ガス工業"],["4206","アイカ工業"],["4248","竹本容器"],["4290","プレステージ・インターナショナル"],["4502","武田薬品工業"],["4540","ツムラ"],["4641","アルプス技研"],["4674","クレスコ"],["4746","東計電算"],["4755","楽天グループ"],["4958","長谷川香料"],["5108","ブリヂストン"],["5334","日本特殊陶業"],["5982","マルゼン"],["6345","アイチコーポレーション"],["6501","日立製作所"],["6785","鈴木"],["6976","太陽誘電"],["6981","村田製作所"],["7011","三菱重工業"],["7272","ヤマハ発動機"],["7723","愛知時計電機"],["7974","任天堂"],["7989","立川ブラインド工業"],["7994","オカムラ"],["8001","伊藤忠商事"],["8002","丸紅"],["8053","住友商事"],["8058","三菱商事"],["8130","サンゲツ"],["8267","イオン"],["8306","三菱UFJフィナンシャル・グループ"],["8309","三井住友トラストグループ"],["8424","芙蓉総合リース"],["8584","ジャックス"],["8593","三菱HCキャピタル"],["8725","MS&ADインシュアランスグループホールディングス"],["8766","東京海上ホールディングス"],["9364","上組"],["9381","エーアイテイー"],["9432","NTT"],["9434","ソフトバンク"],["9757","船井総研ホールディングス"],["9769","学究社"],["9984","ソフトバンクグループ"],["9986","蔵王産業"],["9989","サンドラッグ"]];
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
        const displayName = name;
        const rows = result.timestamp.map((t,i)=>({t,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]}))
          .filter(x=>Number.isFinite(x.o)&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c));
        if (rows.length < 200) throw new Error(`日足データ不足（${rows.length}件）`);
        output.stocks[code] = {name:displayName,rows,status:"ok"};
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
