import fs from "node:fs/promises";

const history=JSON.parse(await fs.readFile("forecast-history.json","utf8"));
const snapshot=JSON.parse(await fs.readFile("market-snapshot.json","utf8"));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const zones={fang:"America/New_York",nikkei:"Asia/Tokyo",topix:"Asia/Tokyo"};
const open={fang:570,nikkei:540,topix:540},close={fang:975,nikkei:945,topix:945};
const exposure={
 fang:{us:.22,nasdaq:.34,semi:.42,nvda:.28,fx:.08,rates:-.34,oil:-.14,risk:.22,japan:.02},
 nikkei:{us:.23,nasdaq:.20,semi:.34,nvda:.10,fx:.32,rates:-.10,oil:-.18,risk:.14,japan:.20},
 topix:{us:.14,nasdaq:.10,semi:.16,nvda:.05,fx:.22,rates:-.10,oil:-.15,risk:.13,japan:.32}
};
const budgets={
 fang:{growth:.14,fx:.07,rates:.05,energy:.07,risk:.07,japan:.01},
 nikkei:{growth:.12,fx:.10,rates:.05,energy:.08,risk:.08,japan:.09},
 topix:{growth:.08,fx:.09,rates:.05,energy:.09,risk:.08,japan:.12}
};
const rel=(id,cat)=>cat==="ipo"?(id==="fang"?1:id==="nikkei"?.42:.30)
 :cat==="tech"?(id==="fang"?1.25:id==="nikkei"?1:.55)
 :cat==="nvda"?(id==="fang"?1.55:id==="nikkei"?.8:.4)
 :cat==="rates"?(id==="fang"?1:id==="nikkei"?.75:.7)
 :cat==="japan"?(id==="fang"?.15:id==="nikkei"?.8:1)
 :cat==="geo"?1:cat==="oil"?(id==="fang"?.65:id==="nikkei"?.75:.65):.3;

function localDate(value,tz){return new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));}
function localMinutes(value,tz){const p=new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));return Number(p.find(x=>x.type==="hour")?.value||0)*60+Number(p.find(x=>x.type==="minute")?.value||0);}
function fxRisk(q){if(!q)return 0;const p=q.price;let v=p>=160.5?.95:p>=159.5?.82:p>=158.5?.62:p>=157.5?.38:.12;const stretch=q.technical?.sma25?q.price/q.technical.sma25-1:0;v+=(q.day>=.8?.10:0)+(q.week>=1.8?.10:0)+(q.technical?.bbPercentB>1?.06:0)+(stretch>.01?.05:0);return Math.min(1,v);}
function factor(q,id,risk){
 if(!q)return null;
 if(id==="oil"){
  const vals=[q.oil,q.brent].filter(Boolean);if(!vals.length)return null;
  return clamp(vals.reduce((s,v)=>{const mom=clamp((v.day*.4+v.week*.6)/4,-1,1),premium=v.avg60?clamp((v.price/v.avg60-1)/.15,-1,1):0;return s+mom*.55+premium*.45;},0)/vals.length,-1,1);
 }
 const v=q[id];if(!v)return null;
 const trend=v.week*.65+v.day*.35,raw=id==="rates"||id==="risk"?-trend:trend;
 const scale=id==="rates"?1.4:id==="fx"?1.2:id==="risk"?2.2:id==="nvda"?3:2.5;
 return id==="fx"?clamp((raw/scale)*(1-.65*risk)-.10*risk,-1,1):clamp(raw/scale,-1,1);
}
function reversal(series,baseDate){
 const i=series.findIndex(x=>x.dateISO===baseDate);if(i<19)return 0;
 const c=series.slice(0,i+1).map(x=>Number(x.price)),w=c.slice(-20),m=w.reduce((s,x)=>s+x,0)/20;
 const sd=Math.sqrt(w.reduce((s,x)=>s+(x-m)**2,0)/20),b=sd?(c.at(-1)-(m-2*sd))/(4*sd):.5;
 const d=c.slice(-15).slice(1).map((x,j)=>x-c.slice(-15)[j]);
 const gain=d.reduce((s,x)=>s+Math.max(0,x),0)/14,loss=d.reduce((s,x)=>s+Math.max(0,-x),0)/14;
 const r=loss===0?100:gain===0?0:100-100/(1+gain/loss);
 let z=0;if(b>1)z-=.08;else if(b<0)z+=.08;else if(b>=.85)z-=.035;else if(b<=.15)z+=.035;
 if(r<30)z+=.06;else if(r<38)z+=.025;if(r>70)z-=.06;else if(r>62)z-=.025;
 return z;
}
function groupedForecast(day,x){
 const q=day.marketContext,id=x.id,exp=exposure[id],budget=budgets[id];if(!q||!exp)return null;
 const risk=fxRisk(q.fx),vals={};
 for(const k of ["us","nasdaq","semi","nvda","fx","rates","oil","risk","japan"])vals[k]=factor(q,k,risk);
 const growthKeys=["us","nasdaq","semi","nvda"].filter(k=>vals[k]!==null&&exp[k]);
 const growthDen=growthKeys.reduce((s,k)=>s+Math.abs(exp[k]),0);
 const growth=growthDen?growthKeys.reduce((s,k)=>s+vals[k]*exp[k],0)/growthDen:0;
 const grouped=[];
 if(growthDen)grouped.push({name:"米国成長株・半導体（相関調整）",value:growth*budget.growth});
 for(const [key,budgetKey,name] of [["fx","fx","為替"],["rates","rates","金利"],["oil","energy","原油"],["risk","risk","市場ストレス"],["japan","japan","日本株市場"]]){
  if(vals[key]!==null)grouped.push({name,value:vals[key]*budget[budgetKey]});
 }
 const own=q[id],technical=own?.technical?.score||0,rev=reversal(snapshot.quotes[id]?.series||[],x.baseDate);
 const momentum=.35*clamp((own?.week||0)/2.8,-1,1)+.25*clamp((own?.month||0)/7,-1,1)+.40*clamp(technical+rev,-1,1);
 const trendContribution=momentum*.25;
 const macroContribution=Number(x.macroScore||0)*(id==="fang"?.06:.055);
 const news=day.newsContext||[];let total=0,weight=0;
 for(const n of news){const w=rel(id,n.category)*(n.source==="X"?Number(n.trustScore||0):1);total+=Number(n.score||0)*w;weight+=w;}
 const newsScore=weight?clamp(total/Math.max(2,weight),-1,1):0,newsContribution=newsScore*.10;
 const raw=trendContribution+macroContribution+grouped.reduce((s,v)=>s+v.value,0)+newsContribution;
 const score=clamp(raw,-.85,.85);
 const er=Number((day.earningsRisk||[]).find(v=>v.id===id)?.score||0);
 const priced=Number((day.earningsRisk||[]).find(v=>v.id===id)?.pricedInScore||0);
 const adjusted=score*(1-.65*er)-.035*priced*er;
 const quality=Number(x.quality??.7);
 const probability=clamp((50+adjusted*.75*23*quality)/100,.28,.72);
 return {probability,score,raw,trendContribution,macroContribution,newsContribution,groups:grouped,earningsRisk:er};
}
function metrics(rows,key){
 if(!rows.length)return {n:0,accuracy:null,brier:null,meanProbability:null};
 const hit=rows.filter(x=>(x[key]>=.5)===x.actualUp).length;
 const values=rows.map(x=>x[key]);if(values.some(v=>!Number.isFinite(v)))throw new Error("Non-finite probability in metric "+key);
 return {n:rows.length,correct:hit,accuracy:Number((hit/rows.length*100).toFixed(1)),
  brier:Number((rows.reduce((s,x)=>s+(x[key]-(x.actualUp?1:0))**2,0)/rows.length).toFixed(5)),
  meanProbability:Number((rows.reduce((s,x)=>s+x[key],0)/rows.length*100).toFixed(1))};
}
const rows=[],excluded=[];
for(const day of history)for(const x of day.results||[]){
 const id=x.id,tz=zones[id],series=snapshot.quotes?.[id]?.series||[];
 if(!tz||!day.marketContext){excluded.push({date:day.date,id,reason:"historical_market_context_missing"});continue;}
 const saved=Date.parse(day.savedAt||"");if(!Number.isFinite(saved)){excluded.push({date:day.date,id,reason:"savedAt_missing"});continue;}
 const d=localDate(saved,tz),m=localMinutes(saved,tz),base=series.find(v=>v.dateISO===x.baseDate),next=series.find(v=>v.dateISO>x.baseDate);
 if(!base||!next){excluded.push({date:day.date,id,reason:"base_or_target_close_missing"});continue;}
 const sessionDate=series.some(v=>v.dateISO===d);
 if(sessionDate&&m>=open[id]&&m<close[id]){excluded.push({date:day.date,id,reason:"forecast_saved_during_session"});continue;}
 if(sessionDate&&((m<open[id]&&x.baseDate>=d)||(m>=close[id]&&x.baseDate!==d))){excluded.push({date:day.date,id,reason:"base_not_last_completed_close"});continue;}
 if(!(next.dateISO>d||(next.dateISO===d&&m<open[id]))){excluded.push({date:day.date,id,reason:"target_close_known_before_forecast"});continue;}
 const mismatch=Math.abs(Number(x.basePrice)-Number(base.price))/Number(base.price);
 if(!Number.isFinite(mismatch)||mismatch>.002){excluded.push({date:day.date,id,reason:"base_price_mismatch"});continue;}
 const newModel=groupedForecast(day,x);if(!newModel){excluded.push({date:day.date,id,reason:"grouped_model_inputs_missing"});continue;}
 rows.push({date:day.date,id,baseDate:x.baseDate,targetDate:next.dateISO,actualUp:Number(next.price)>Number(x.basePrice),old:Number(x.probability)/100,new:newModel.probability,oldScore:Number(x.score),...newModel});
}
const report={sampleSize:rows.length,byIndex:{},overall:{baseline:metrics(rows,"old"),groupedModel:metrics(rows,"new")},
 oldSaturated:rows.filter(x=>Math.abs(x.oldScore)>=.849).length,
 groupedSaturated:rows.filter(x=>Math.abs(x.score)>=.849).length,
 excludedCount:excluded.length,exclusions:excluded,
 details:rows.map(x=>({date:x.date,id:x.id,target:x.targetDate,actualUp:x.actualUp,oldPct:Number((x.old*100).toFixed(1)),newPct:Number((x.new*100).toFixed(1)),oldScore:x.oldScore,newScore:Number(x.score.toFixed(3)),trend:Number(x.trendContribution.toFixed(3)),macro:Number(x.macroContribution.toFixed(3)),news:Number(x.newsContribution.toFixed(3)),groups:x.groups}))};
for(const id of Object.keys(zones)){const a=rows.filter(x=>x.id===id);report.byIndex[id]={baseline:metrics(a,"old"),groupedModel:metrics(a,"new")};}
report.limitations=["検証対象は保存済みの過去予測のみ。サンプル数が少なく、統計的優位性は判断できません。",
 "旧予測のニュースソース重み等の一部が履歴に保存されていないため、新モデル比較は保存入力からの近似再構成です。",
 "新モデルはシャドー評価専用で、本番予測には使用していません。"];
console.log(JSON.stringify(report,null,2));
if(!rows.length)throw new Error("No eligible forecasts with archived market context.");
