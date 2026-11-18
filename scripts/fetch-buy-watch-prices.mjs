import fs from "node:fs";

const stocks = [["1343","1343"],["1414","1414"],["1514","1514"],["1605","インペックス"],["1928","積水ハウス"],["2003","2003"],["2124","2124"],["2914","日本たばこ産業"],["3003","3003"],["3076","3076"],["3231","3231"],["3371","3371"],["3844","3844"],["3923","3923"],["4008","4008"],["4041","4041"],["4042","東ソー"],["4248","4248"],["4290","4290"],["4502","武田薬品工業"],["4540","4540"],["4746","4746"],["4755","楽天グループ"],["5108","ブリヂストン"],["5334","5334"],["6501","日立製作所"],["6976","太陽誘電"],["6981","村田製作所"],["7011","三菱重工業"],["7272","ヤマハ発動機"],["7974","任天堂"],["7989","7989"],["7994","7994"],["8001","伊藤忠商事"],["8002","丸紅"],["8053","住友商事"],["8058","三菱商事"],["8130","8130"],["8267","イオン"],["8306","三菱ユーエフジェイフィナンシャル・グループ"],["8309","三井住友トラストグループ"],["8424","8424"],["8584","8584"],["8593","8593"],["8766","東京海上ホールディングス"],["9364","9364"],["9432","エヌティーティー"],["9434","ソフトバンク"],["9769","9769"],["9984","ソフトバンクグループ"],["9986","9986"],["2659","2659"],["3333","3333"],["9989","サンドラッグ"],["4097","高圧ガス工業"],["4206","アイカ工業"],["4958","長谷川香料"],["8725","MS&ADインシュアランスグループHD"],["6785","鈴木"],["7723","愛知時計電機"],["2169","CDS"],["9757","船井総研HD"],["4641","アルプス技研"],["3817","SRAホールディングス"],["3901","マークラインズ"],["4674","4674"],["6345","6345"],["9381","9381"],["5982","5982"]];

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
    const name = fallbackName===code ? (result.meta?.longName || result.meta?.shortName || code) : fallbackName;
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
fs.writeFileSync("stock-prices.json", JSON.stringify(output, null, 2) + "\\n");
console.log(`Saved stock-prices.json; failures=${failures}/${stocks.length}`);
if (failures === stocks.length) process.exitCode = 1;
