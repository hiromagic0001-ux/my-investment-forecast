import fs from "node:fs";

const stocks = [
  ["9989","サンドラッグ"],["4097","高圧ガス工業"],["4206","アイカ工業"],
  ["4958","長谷川香料"],["8725","MS&ADインシュアランスグループHD"],
  ["6785","鈴木"],["7723","愛知時計電機"],["2169","CDS"],
  ["9757","船井総研HD"],["4641","アルプス技研"],
  ["3817","SRAホールディングス"],["3901","マークラインズ"]
];

const output = { generatedAt: new Date().toISOString(), source: "Yahoo Finance chart API", stocks: {} };
let failures = 0;

for (const [code, name] of stocks) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=1y&interval=1d`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InvestmentForecast/1.0)" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const result = json.chart?.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) throw new Error("価格データなし");
    const q = result.indicators.quote[0];
    const rows = result.timestamp.map((t, i) => ({
      t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i]
    })).filter(x => Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
    if (rows.length < 200) throw new Error(`日足データ不足（${rows.length}件）`);
    output.stocks[code] = { name, rows, status: "ok" };
    console.log(`OK ${code}: ${rows.length} rows`);
  } catch (error) {
    failures++;
    output.stocks[code] = { name, rows: [], status: "error", error: String(error.message || error) };
    console.error(`FAILED ${code}: ${error.message || error}`);
  }
}

fs.writeFileSync("stock-prices.json", JSON.stringify(output, null, 2) + "\n");
console.log(`Saved stock-prices.json; failures=${failures}/${stocks.length}`);
if (failures === stocks.length) process.exitCode = 1;
