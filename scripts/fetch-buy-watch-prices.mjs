import fs from "node:fs";

const stocks = [["1343","NEXT FUNDS 東証REIT指数連動型上場投信"],["1414","ショーボンドホールディングス"],["1514","住石ホールディングス"],["1605","インペックス"],["1928","積水ハウス"],["2003","日東富士製粉"],["2124","ジェイエイシーリクルートメント"],["2169","CDS"],["2659","サンエー"],["2914","日本たばこ産業"],["3003","ヒューリック"],["3076","あい ホールディングス"],["3231","野村不動産ホールディングス"],["3333","あさひ"],["3371","ソフトクリエイトホールディングス"],["3817","SRAホールディングス"],["3844","コムチュア"],["3901","マークラインズ"],["3923","ラクス"],["4008","住友精化"],["4041","日本曹達"],["4042","東ソー"],["4097","高圧ガス工業"],["4206","アイカ工業"],["4248","竹本容器"],["4290","プレステージ・インターナショナル"],["4502","武田薬品工業"],["4540","ツムラ"],["4641","アルプス技研"],["4674","クレスコ"],["4746","東計電算"],["4755","楽天グループ"],["4958","長谷川香料"],["5108","ブリヂストン"],["5334","日本特殊陶業"],["5982","マルゼン"],["6345","アイチコーポレーション"],["6501","日立製作所"],["6785","鈴木"],["6976","太陽誘電"],["6981","村田製作所"],["7011","三菱重工業"],["7272","ヤマハ発動機"],["7723","愛知時計電機"],["7974","任天堂"],["7989","立川ブラインド工業"],["7994","オカムラ"],["8001","伊藤忠商事"],["8002","丸紅"],["8053","住友商事"],["8058","三菱商事"],["8130","サンゲツ"],["8267","イオン"],["8306","三菱UFJフィナンシャル・グループ"],["8309","三井住友トラストグループ"],["8424","芙蓉総合リース"],["8584","ジャックス"],["8593","三菱HCキャピタル"],["8725","MS&ADインシュアランスグループホールディングス"],["8766","東京海上ホールディングス"],["9364","上組"],["9381","エーアイテイー"],["9432","NTT"],["9434","ソフトバンク"],["9757","船井総研ホールディングス"],["9769","学究社"],["9984","ソフトバンクグループ"],["9986","蔵王産業"],["9989","サンドラッグ"]];

const output = { generatedAt: new Date().toISOString(), source: "Yahoo Finance chart API", stocks: {} };
let failures = 0;

for (const [code, fallbackName] of stocks) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=1y&interval=1d`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; InvestmentForecast/1.0)" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const result = json.chart?.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) throw new Error("価格データなし");
    const q = result.indicators.quote[0];
    const name = fallbackName;
    const rows = result.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(x => Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
    if (rows.length < 200) throw new Error(`日足データ不足（${rows.length}件）`);
    output.stocks[code] = { name, rows, status: "ok" };
    console.log(`OK ${code}: ${rows.length} rows`);
  } catch (error) {
    failures++;
    output.stocks[code] = { name: fallbackName, rows: [], status: "error", error: String(error.message || error) };
    console.error(`FAILED ${code}: ${error.message || error}`);
  }
}
fs.writeFileSync("stock-prices.json", JSON.stringify(output, null, 2) + "\n");
console.log(`Saved stock-prices.json; failures=${failures}/${stocks.length}`);
if (failures === stocks.length) process.exitCode = 1;
