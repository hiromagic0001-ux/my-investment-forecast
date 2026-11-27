import fs from "node:fs/promises";

const history=JSON.parse(await fs.readFile("forecast-history.json","utf8"));
const snapshot=JSON.parse(await fs.readFile("market-snapshot.json","utf8"));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const zones={fang:"America/New_York",nikkei:"Asia/Tokyo",topix:"Asia/Tokyo"};
const sessionOpen={fang:9*60+30,nikkei:9*60,topix:9*60};
const sessionCloseBuffer={fang:16*60+15,nikkei:15*60+45,topix:15*60+45};

function localDate(value,timeZone){
 return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}
function localMinutes(value,timeZone){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
 return Number(parts.find(x=>x.type==="hour")?.value||0)*60+Number(parts.find(x=>x.type==="minute")?.value||0);
}
function sessionAt(savedAt,id,series){
 const timeZone=zones[id],date=localDate(savedAt,timeZone),minutes=localMinutes(savedAt,timeZone);
 const isSessionDate=series.some(x=>x.dateISO===date);
 const open=sessionOpen[id],closeBuffer=sessionCloseBuffer[id];
 return {date,minutes,isSessionDate,beforeOpen:minutes<open,afterClose:minutes>=closeBuffer,
  duringSession:minutes>=open&&minutes<closeBuffer};
}
function technicalAt(series,baseDate){
 const end=series.findIndex(x=>x.dateISO===baseDate);
 if(end<19)return null;
 const closes=series.slice(0,end+1).map(x=>Number(x.price));
 const last=closes.at(-1),window=closes.slice(-20),mean=window.reduce((s,x)=>s+x,0)/20;
 const sd=Math.sqrt(window.reduce((s,x)=>s+(x-mean)**2,0)/20);
 const percentB=sd?(last-(mean-2*sd))/(4*sd):.5;
 const recent=closes.slice(-15),changes=recent.slice(1).map((x,i)=>x-recent[i]);
 const gain=changes.reduce((s,x)=>s+Math.max(0,x),0)/Math.max(1,changes.length);
 const loss=changes.reduce((s,x)=>s+Math.max(0,-x),0)/Math.max(1,changes.length);
 const rsi=loss===0?100:gain===0?0:100-(100/(1+gain/loss));
 let reversal=0;
 if(percentB>1)reversal-=.08;
 else if(percentB<0)reversal+=.08;
 else if(percentB>=.85)reversal-=.035;
 else if(percentB<=.15)reversal+=.035;
 if(rsi<30)reversal+=.06;else if(rsi<38)reversal+=.025;
 if(rsi>70)reversal-=.06;else if(rsi>62)reversal-=.025;
 return {percentB,rsi,reversal};
}
function metrics(rows,key){
 const n=rows.length;
 if(!n)return {n:0,accuracy:null,brier:null,meanUpProbability:null};
 const hits=rows.filter(r=>(r[key]>=.5)===r.actualUp).length;
 return {n,correct:hits,accuracy:Number((hits/n*100).toFixed(1)),
  brier:Number((rows.reduce((s,r)=>s+(r[key]-(r.actualUp?1:0))**2,0)/n).toFixed(5)),
  meanUpProbability:Number((rows.reduce((s,r)=>s+r[key],0)/n*100).toFixed(1)),
  actualUpRate:Number((rows.filter(r=>r.actualUp).length/n*100).toFixed(1))};
}

const eligible=[],excluded=[],qualityIssues=[];
for(const day of history){
 for(const forecast of day.results||[]){
  const id=forecast.id,series=snapshot.quotes?.[id]?.series||[];
  if(!zones[id])continue;
  const savedAt=Date.parse(day.savedAt||"");
  if(!Number.isFinite(savedAt)){excluded.push({date:day.date,id,reason:"missing_savedAt"});continue;}
  const session=sessionAt(savedAt,id,series);
  const base=series.find(x=>x.dateISO===forecast.baseDate);
  const next=series.find(x=>x.dateISO>forecast.baseDate);
  if(!base||!next){excluded.push({date:day.date,id,reason:!base?"base_close_missing":"next_close_missing"});continue;}
  const timingValid=!session.isSessionDate||session.beforeOpen||session.afterClose;
  const baseValid=!session.isSessionDate||
   (session.beforeOpen&&forecast.baseDate<session.date)||
   (session.afterClose&&forecast.baseDate===session.date);
  const resultKnownAfterSave=next.dateISO>session.date||
   (next.dateISO===session.date&&session.beforeOpen);
  if(!timingValid){excluded.push({date:day.date,id,reason:"forecast_saved_during_session"});continue;}
  if(!baseValid){excluded.push({date:day.date,id,reason:"base_price_not_last_completed_close"});continue;}
  if(!resultKnownAfterSave){excluded.push({date:day.date,id,reason:"target_close_known_before_forecast"});continue;}
  const baseDiff=Math.abs(Number(forecast.basePrice)-Number(base.price))/Number(base.price);
  if(!Number.isFinite(baseDiff)||baseDiff>.002){
   qualityIssues.push({date:day.date,id,issue:"saved_base_price_mismatch",saved:forecast.basePrice,source:base.price,diffPct:Number((baseDiff*100).toFixed(3))});
   excluded.push({date:day.date,id,reason:"base_price_mismatch"});continue;
  }
  const actualUp=Number(next.price)>Number(forecast.basePrice);
  const p=clamp(Number(forecast.probability)/100,.28,.72);
  const quality=Number(forecast.quality??.7);
  const storedScore=Number(forecast.score);
  const risk=(day.earningsRisk||[]).find(x=>x.id===id)||{};
  const riskScore=clamp(Number(risk.score||0),0,.85);
  const pricedIn=clamp(Number(risk.pricedInScore||0),0,1);
  const technical=technicalAt(series,forecast.baseDate);
  let adjusted=p;
  if(technical&&Number.isFinite(storedScore)){
   // Approximate counterfactual: preserve the archived model score and add
   // only the new reversal component (technical weight 0.18).
   const raw=(storedScore+.035*pricedIn*riskScore)/Math.max(.001,1-.65*riskScore);
   const revisedRaw=clamp(raw+technical.reversal*.18,-.85,.85);
   const revisedScore=revisedRaw*(1-.65*riskScore)-.035*pricedIn*riskScore;
   adjusted=clamp((50+revisedScore*.75*23*quality)/100,.28,.72);
  }
  const reconstructed=clamp((50+storedScore*.75*23*quality)/100,.28,.72);
  if(Math.abs(reconstructed-p)>.003)qualityIssues.push({date:day.date,id,issue:"probability_score_reconstruction_mismatch",stored:p,reconstructed});
  eligible.push({date:day.date,id,baseDate:forecast.baseDate,targetDate:next.dateISO,basePrice:Number(forecast.basePrice),actualPrice:Number(next.price),actualUp,baseline:p,adjusted,technical});
 }
}
const indices={};
for(const id of Object.keys(zones)){
 const rows=eligible.filter(x=>x.id===id);
 indices[id]={baseline:metrics(rows,"baseline"),reversalCounterfactual:metrics(rows,"adjusted")};
}
const report={
 generatedAt:new Date().toISOString(),
 source:{historyRecords:history.length,priceSnapshotGeneratedAt:snapshot.generatedAt,priceSnapshotDate:snapshot.date},
 sampleSize:eligible.length,
 indices,
 overall:{baseline:metrics(eligible,"baseline"),reversalCounterfactual:metrics(eligible,"adjusted")},
 excludedCount:excluded.length,
 exclusions:excluded,
 dataQualityIssues:qualityIssues,
 limitations:[
  "過去予測の保存数が少なく、統計的な優位性を結論づけられません。",
  "反転シグナルの比較は保存済みスコアに新しいRSI・ボリンジャー寄与だけを加えた近似反実仮想で、当時の全入力を再取得した完全なウォークフォワード再計算ではありません。",
  "確率校正や方向的中率の改善を保証するものではありません。"
 ]
};
console.log(JSON.stringify(report,null,2));
if(!eligible.length)throw new Error("No eligible next-session forecasts found.");
