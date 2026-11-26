import assert from "node:assert/strict";
import { buildFundamentalAnalysis } from "./fundamental-analysis.mjs";
const result=buildFundamentalAnalysis({
 assetId:"fang",asOfDate:"2026-11-26",
 macroSignals:[
  {id:"macro_core_cpi",label:"Core CPI",value:.5,source:"FRED",observationDate:"2026-10-01"},
  {id:"macro_hy",label:"HY spread",value:.4,source:"FRED",observationDate:"2026-11-24"},
  {id:"macro_10y",label:"10y yield",value:-.3,source:"FRED",observationDate:"2026-11-24"},
  {id:"macro_nfci",label:"NFCI",value:.2,source:"FRED",observationDate:"2026-08-01"},
  {id:"macro_payrolls",label:"Payrolls",value:.8,source:"FRED",observationDate:"2026-11-27"}
 ],
 earningsEvents:[
  {symbol:"NVDA",name:"NVIDIA",date:"2026-11-25",epsForecast:1,actualEPS:1.2,reaction:{excessPct:2.5},source:"Nasdaq"}
 ]
});
assert.equal(result.status,"available");
assert.equal(result.macro.signalCount,3);
assert.equal(result.macro.stale.length,1);
assert.equal(result.macro.future.length,1);
assert.equal(result.earnings.eventCount,1);
assert.ok(result.earnings.score>0);
assert.ok(result.score>0);
assert.equal(result.valuation.status,"not_available");
const missing=buildFundamentalAnalysis({assetId:"nikkei",macroSignals:[],earningsEvents:[],asOfDate:"2026-11-26"});
assert.equal(missing.status,"missing");
assert.equal(missing.coverage,0);
console.log("Fundamental analysis tests passed",JSON.stringify({score:result.score,coverage:result.coverage,macroSignals:result.macro.signalCount,earningsEvents:result.earnings.eventCount}));
