import fs from "node:fs/promises";
import { fetchFreeXSignals } from "./free-x-signals.mjs";
import { fetchEarningsCalendar } from "./earnings-calendar.mjs";

const assets = [
  {id:"fang",name:"NYSE FANG+（参考）",ticker:"^NYFANG",exp:{us:.22,nasdaq:.34,semi:.42,nvda:.28,fx:.08,rates:-.34,oil:-.14,risk:.22,japan:.02}},
  {id:"nikkei",name:"日経225",ticker:"^N225",exp:{us:.23,nasdaq:.20,semi:.34,nvda:.10,fx:.32,rates:-.10,oil:-.18,risk:.14,japan:.20}},
  {id:"topix",name:"TOPIX（1306連動ETF参考）",ticker:"1306.T",exp:{us:.14,nasdaq:.10,semi:.16,nvda:.05,fx:.22,rates:-.10,oil:-.15,risk:.13,japan:.32}}
];
const indicators = [
  ["us","^GSPC"],["nasdaq","^IXIC"],["semi","SOXX"],["nvda","NVDA"],
  ["fx","JPY=X"],["rates","^TNX"],["oil","CL=F"],["brent","BZ=F"],["risk","^VIX"],["japan","1306.T"]
];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const jstDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const dayName=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",weekday:"short"}).format(new Date());
if(["Sat","Sun"].includes(dayName)) process.exit(0);

function buildTechnicalSeries(closes){
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 const rows=[],widths=[];
 for(let i=0;i<closes.length;i++){
  const row={};
  for(const n of [5,25,75,200])row["sma"+n]=i+1>=n?mean(closes.slice(i-n+1,i+1)):null;
  if(i>=19){
   const w=closes.slice(i-19,i+1),m=mean(w),sd=Math.sqrt(w.reduce((s,v)=>s+(v-m)**2,0)/w.length);
   row.bbMiddle=m;row.bbUpper=m+2*sd;row.bbLower=m-2*sd;
   row.bbPercentB=sd?((closes[i]-row.bbLower)/(row.bbUpper-row.bbLower)):0.5;
   row.bbWidth=m?(row.bbUpper-row.bbLower)/m*100:0;
  }else{row.bbMiddle=null;row.bbUpper=null;row.bbLower=null;row.bbPercentB=null;row.bbWidth=null;}
  rows.push(row);if(row.bbWidth!==null)widths.push(row.bbWidth);
 }
 const last=rows.at(-1),price=closes.at(-1);
 const rank=last.bbWidth===null?null:widths.slice(-60).filter(v=>v<=last.bbWidth).length/Math.min(60,widths.length);
 let score=0;
 if(last.sma25!==null)score+=price>last.sma25 ? .18 : -.18;
 if(last.sma75!==null)score+=price>last.sma75 ? .14 : -.14;
 if(last.sma200!==null)score+=price>last.sma200 ? .10 : -.10;
 if(last.sma5!==null&&last.sma25!==null)score+=last.sma5>last.sma25 ? .14 : -.14;
 if(last.sma25!==null&&last.sma75!==null)score+=last.sma25>last.sma75 ? .12 : -.12;
 if(last.sma75!==null&&last.sma200!==null)score+=last.sma75>last.sma200 ? .08 : -.08;
 const p=last.bbPercentB;
 if(p!==null){if(p>1)score+=score>0 ? .05 : -.10;else if(p<0)score+=score<0 ? -.05 : .10;else if(p>=.5)score+=.07;else if(p<=.25)score-=.07;}
 const trend=score>.22?"上昇トレンド":score<-.22?"下降トレンド":"方向感が弱い";
 const crossState=last.sma5!==null&&last.sma25!==null?(last.sma5>last.sma25?"5日線＞25日線":"5日線＜25日線"):"短期線データ不足";
 const midCross=last.sma25!==null&&last.sma75!==null?(last.sma25>last.sma75?"25日線＞75日線":"25日線＜75日線"):"中期線データ不足";
 const bbState=p===null?"算出中":p>1?"+2σ上抜け":p<0?"-2σ下抜け":p>=.8?"上限寄り":p<=.2?"下限寄り":"バンド内";
 return {rows:rows.map(r=>({sma5:r.sma5,sma25:r.sma25,sma75:r.sma75,sma200:r.sma200,bbMiddle:r.bbMiddle,bbUpper:r.bbUpper,bbLower:r.bbLower})),current:{sma5:last.sma5,sma25:last.sma25,sma75:last.sma75,sma200:last.sma200,bbMiddle:last.bbMiddle,bbUpper:last.bbUpper,bbLower:last.bbLower,bbPercentB:p,bbWidth:last.bbWidth,bbWidthPercentile:rank,squeeze:rank!==null&&rank<=.2,bbState,trend,crossState,midCross,score:Math.max(-1,Math.min(1,score))}};
}
function fxInterventionRisk(q){
 if(!q)return {score:0,label:"データ不足"};
 const p=q.price;
 let base=p>=160.5 ? .95 : p>=159.5 ? .82 : p>=158.5 ? .62 : p>=157.5 ? .38 : .12;
 const smaStretch=q.technical?.sma25?(q.price/q.technical.sma25-1):0;
 const pace=(q.day>=.8 ? .10 : 0)+(q.week>=1.8 ? .10 : 0)+(q.technical?.bbPercentB>1 ? .06 : 0)+(smaStretch>.01 ? .05 : 0);
 const score=Math.min(1,base+pace);
 return {score,label:score>=.8?"非常に高い":score>=.6?"高い":score>=.35?"警戒":"通常"};
}
async function quote(ticker){
 const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(ticker)+"?range=1y&interval=1d";
 const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
 if(!r.ok)throw new Error("Yahoo HTTP "+r.status+" "+ticker);
 const j=await r.json(),x=j.chart?.result?.[0];
 if(!x)throw new Error("No Yahoo data: "+ticker);
 const q=x.indicators.quote[0],pairs=x.timestamp.map((t,i)=>({t,c:q.close[i]})).filter(v=>v.c!=null);
 if(pairs.length<25)throw new Error("Insufficient history: "+ticker);
 const c=pairs.map(v=>v.c),last=c.at(-1),prev=c.at(-2),w=c.at(-6),m=c.at(-22);
 const daily=c.slice(1).map((v,i)=>Math.log(v/c[i]));
 const vol=Math.sqrt(daily.slice(-20).reduce((s,v)=>s+v*v,0)/Math.min(20,daily.length))*Math.sqrt(252)*100;
 const avg60=c.slice(-Math.min(60,c.length)).reduce((s,v)=>s+v,0)/Math.min(60,c.length);
 const technical=buildTechnicalSeries(c);
 const series=pairs.map((v,i)=>({dateISO:new Date(v.t*1000).toISOString().slice(0,10),price:v.c,...technical.rows[i]}));
 return {price:last,day:(last/prev-1)*100,week:(last/w-1)*100,month:(last/m-1)*100,vol,avg60,technical:technical.current,series,dateISO:series.at(-1).dateISO};
}
const feeds=[
 ["rates","Federal Reserve interest rates inflation CPI Treasury yields"],
 ["tech","AI semiconductor chip demand Nvidia data center technology stocks"],
 ["ipo","Anthropic IPO index inclusion Nasdaq 100 S&P 500 passive inflows listing pricing demand"],
 ["ipo","Anthropic IPO valuation pricing range bookbuilding oversubscribed delay withdrawal investor demand"],
 ["japan","Japan economy BOJ yen Nikkei stocks"],
 ["geo","Iran war"],
 ["geo","Strait of Hormuz"],
 ["geo","Houthi attack"],
 ["oil","Brent crude OR WTI crude OR oil prices OR oil supply OR OPEC OR 原油価格 OR 原油高 OR 石油供給"]
];
function sentimentFor(title,category){
 const s=title.toLowerCase();
 if(category==="ipo"){
  const positive=["index inclusion","nasdaq 100","s&p 500","passive inflow","passive demand","index demand","oversubscribed","strong demand","priced above","pricing above","successful debut","strong debut","指数採用","指数組み入れ","パッシブ資金","資金流入","需要旺盛","応募超過","公開価格上限","好調な上場"];
  const negative=["delay","postpone","withdraw","pull","weak demand","undersubscribed","priced below","price range cut","valuation cut","valuation concern","延期","上場延期","撤回","需要低迷","応募不足","公開価格引き下げ","評価額引き下げ","割高懸念"];
  const p=positive.some(w=>s.includes(w)),n=negative.some(w=>s.includes(w));
  if(p&&!n)return .85;
  if(n&&!p)return -.9;
  return 0;
 }
 const relief=["ceasefire","truce","de-escalation","deescalation","peace deal","talks resume","tensions ease","easing tensions","停戦","和平","緊張緩和","協議再開","攻撃停止"];
 const escalation=["airstrike","air strike","missile attack","tanker hit","tanker attack","pipeline attack","oil facility attack","military escalation","blockade tightened","strait closure","shipping disrupted","attack","attacks","strike","strikes","explosion","explosions","爆発","攻撃","空爆","ミサイル","タンカー被害","石油施設","パイプライン攻撃","封鎖強化","航行停止"];
 if(category==="geo"){
  if(relief.some(w=>s.includes(w)))return .85;
  if(escalation.some(w=>s.includes(w)))return -.9;
  if(["war","conflict","iran","israel","houthi","hormuz","戦争","紛争","イラン","ホルムズ"].some(w=>s.includes(w)))return -.35;
 }
 const pos=["beat","surge","rally","rise","gain","growth","strong demand","upgrade","利下げ","需要増","好調","上昇","反発"];
 const neg=["miss","selloff","plunge","slump","fell","drop","decline","recession","downgrade","tariff","inflation","利上げ","急落","下落","景気後退","関税","懸念","売り"];
 const raw=clamp((pos.filter(w=>s.includes(w)).length-neg.filter(w=>s.includes(w)).length)*.45,-1,1);
 return category==="oil"?-raw:raw;
}
function parseItems(xml,category){
 const out=[];
 for(const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)){
  const b=m[1],get=k=>((b.match(new RegExp("<"+k+">([\\s\\S]*?)</"+k+">"))||[])[1]||"").replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<[^>]+>/g," ").trim();
  const title=get("title"); if(!title)continue;
  const sourceUrl=(b.match(/<source[^>]*url="([^"]+)"/i)||[])[1]||"";
  let domain="";try{domain=new URL(sourceUrl).hostname.toLowerCase().replace(/^www\\./,"")}catch{}
  out.push({title,category,score:sentimentFor(title,category),date:get("pubDate"),link:get("link"),domain});
 }
 return out.slice(0,7);
}
async function newsItems(){
 const all=[];
 for(const [category,q] of feeds){
  try{
   const url="https://news.google.com/rss/search?q="+encodeURIComponent(q+" when:7d")+"&hl=ja&gl=JP&ceid=JP:ja";
   const r=await fetch(url);if(r.ok)all.push(...parseItems(await r.text(),category));
  }catch{}
 }
 return all;
}
const earningsCalendar=await fetchEarningsCalendar();
const eventTickers=[...new Set(earningsCalendar.events.map(e=>e.symbol))];
const quoteJobs=[...indicators.map(async ([id,t])=>[id,await quote(t)]),...assets.map(async a=>[a.id,await quote(a.ticker)]),...eventTickers.map(async ticker=>[ticker,await quote(ticker)])];
const settled=await Promise.allSettled(quoteJobs),quotes={},errors=[];
for(const x of settled){if(x.status==="fulfilled")quotes[x.value[0]]=x.value[1];else errors.push(String(x.reason));}
let signalNews=[];
let xAttention={posts:0,authors:0,engagement:0};
function earningsRiskForAsset(assetId){
 const baseWeight=assetId==="fang"?.20:assetId==="nikkei"?.055:.045;
 const relevant=earningsCalendar.events.map(e=>{
  const dayDiff=Math.round((Date.parse(e.date+"T12:00:00Z")-Date.parse(earningsCalendar.asOfDate+"T12:00:00Z"))/86400000);
  const afterClose=/after/i.test(e.reportTime),beforeOpen=/before/i.test(e.reportTime);
  let windowWeight=dayDiff===0?(afterClose?1:beforeOpen ? .25 : .65)
   :dayDiff===1?(beforeOpen ? .8 : afterClose ? .7 : .65)
   :dayDiff===2 ? .35
   :dayDiff===-1?(afterClose ? .12 : .05)
   :dayDiff===-2?(afterClose ? .78 : .10):0;
  if(!windowWeight)return null;
  const q=quotes[e.symbol],nasdaq=quotes.nasdaq;
  const relativeStrength=q&&nasdaq?q.month-nasdaq.month:0;
  const bandStretch=q && q.technical && q.technical.bbPercentB > 0.8 ? 0.15 : 0;
  const pricedInScore=clamp((relativeStrength-2)/13,0,1)+bandStretch;
  const pricedIn=clamp(pricedInScore,0,1);
  return {...e,dayDiff,windowWeight,relativeStrength,pricedInScore:pricedIn,
   risk:windowWeight*baseWeight*(1+.35*pricedIn)};
 }).filter(Boolean);
 const score=clamp(relevant.reduce((sum,e)=>sum+e.risk,0),0,.85);
 const avgPriceIn=relevant.length?relevant.reduce((sum,e)=>sum+e.pricedInScore*e.risk,0)/Math.max(.001,relevant.reduce((sum,e)=>sum+e.risk,0)):0;
 return {score,pricedInScore:avgPriceIn,label:earningsCalendar.status==="unavailable"?"決算日程データ未取得":score>=.35?"非常に高い":score>=.18?"高い":score>=.07?"注意":"通常",
  dataStatus:earningsCalendar.status,events:relevant.map(e=>({symbol:e.symbol,name:e.name,date:e.date,reportTime:e.reportTime,epsForecast:e.epsForecast,estimateCount:e.estimateCount,dayDiff:e.dayDiff,relativeStrength:e.relativeStrength,pricedInScore:e.pricedInScore,risk:e.risk,sourceUrl:e.sourceUrl}))};
}
const news=await newsItems();
const xSignals=await fetchFreeXSignals(news);
const trustedX=xSignals.posts.filter(p=>p.verifiedForSignal).map(p=>({title:p.title,category:p.category,score:p.impactScore,date:p.createdAt,link:p.url,source:"X",trustScore:p.trustScore,label:"X "+p.sourceClass,verifiedForSignal:true}));
signalNews=[...news,...trustedX];
xAttention=xSignals.attention||xAttention;
await fs.writeFile("market-signals.json",JSON.stringify({date:jstDate,generatedAt:new Date().toISOString(),status:xSignals.status,reason:xSignals.reason,attention:xSignals.attention,usage:xSignals.usage,posts:xSignals.posts},null,2)+"\n");
await fs.writeFile("earnings-calendar.json",JSON.stringify(earningsCalendar,null,2)+"\n");
await fs.writeFile("earnings-calendar.json",JSON.stringify(earningsCalendar,null,2)+"\n");
function factorValue(id){
 if(id==="oil"){
  const oilQuotes=[quotes.oil,quotes.brent].filter(Boolean);
  if(!oilQuotes.length)return null;
  const signals=oilQuotes.map(v=>{
   const momentum=clamp((v.day*.4+v.week*.6)/4,-1,1);
   const premium=v.avg60?clamp(((v.price/v.avg60)-1)/.15,-1,1):0;
   return momentum*.55+premium*.45;
  });
  return clamp(signals.reduce((s,v)=>s+v,0)/signals.length,-1,1);
 }
 const q=quotes[id];if(!q)return null;
 let raw=q.week;if(id==="rates"||id==="risk")raw=-q.week;
 const scale=id==="rates"?1.4:id==="fx"?1.2:id==="risk"?2.2:id==="nvda"?3:2.5;
 const fxRisk=fxInterventionRisk(quotes.fx).score;
 return id==="fx" ? clamp((raw/scale)*(1-.65*fxRisk)-.10*fxRisk,-1,1) : clamp(raw/scale,-1,1);
}
function relFor(asset,cat){
 if(cat==="ipo")return asset.id==="fang"?1.0:asset.id==="nikkei"?.42:.30;
 if(cat==="tech")return asset.id==="fang"?1.25:asset.id==="nikkei"?1:.55;
 if(cat==="nvda")return asset.id==="fang"?1.55:asset.id==="nikkei"?.8:.4;
 if(cat==="rates")return asset.id==="fang"?1:asset.id==="nikkei"?.75:.7;
 if(cat==="japan")return asset.id==="fang"?.15:asset.id==="nikkei"?.8:1;
 if(cat==="geo")return 1.0;if(cat==="oil")return asset.id==="fang"?.65:asset.id==="nikkei"?.75:.65;
 return .3;
}
function forecast(a){
 const own=quotes[a.id];if(!own)return null;
 const fxRisk=fxInterventionRisk(quotes.fx);
 const earningsRisk=earningsRiskForAsset(a.id);
 const parts=[
  clamp(own.week/2.8,-1,1)*.24,
  clamp(own.month/7,-1,1)*.18,
  clamp((12-own.vol)/18,-.5,.5)*.05,
  (own.technical?.score||0)*.18,
  ...(a.id==="nikkei"?[-fxRisk.score*.12]:a.id==="topix"?[-fxRisk.score*.08]:[])
 ];
 for(const [id,exp] of Object.entries(a.exp)){const v=factorValue(id);if(v!==null&&Math.abs(exp)>.01)parts.push(v*exp*.42);}
 if(quotes.nvda&&a.exp.nvda)parts.push(clamp(quotes.nvda.day/4,-1,1)*a.exp.nvda*.7);
 let total=0,weight=0;
 for(const n of signalNews){const rel=relFor(a,n.category),sourceWeight=n.source==="X"?Number(n.trustScore||0):1;total+=n.score*rel*sourceWeight;weight+=rel*sourceWeight;}
 const ns=weight?clamp(total/Math.max(2,weight),-1,1):0;
 parts.push(ns*.28);
 const rawScore=clamp(parts.reduce((s,v)=>s+v,0),-.85,.85);
 const score=clamp(rawScore*(1-.65*earningsRisk.score)-.035*earningsRisk.pricedInScore*earningsRisk.score,-.85,.85);
 const coverage=Object.keys(a.exp).filter(id=>id==="oil"?(quotes.oil||quotes.brent):quotes[id]).length/Object.keys(a.exp).length;
 const coveredFeeds=new Set(signalNews.map(n=>n.category));
 const criticalCoverage=coveredFeeds.has("geo")&&coveredFeeds.has("oil")?1:0;
 const broadCoverage=["rates","tech","japan"].filter(id=>coveredFeeds.has(id)).length/3;
 const newsCoverage=.7*criticalCoverage+.3*broadCoverage;
 const baseQuality=clamp(.2+.4*coverage+.4*newsCoverage,.2,1);
 const xPosts=Number(xAttention.posts||0),xAuthors=Number(xAttention.authors||0),xEngagement=Number(xAttention.engagement||0);
 const attentionHeat=0; // RSS検索ヒット数はX上の実際の注目度ではないため、予測レンジに使わない
 const authorConcentration=0; // RSS検索結果では投稿者集中度を測定できない
 const attentionRisk=attentionHeat*(.5+.5*authorConcentration);
 const quality=clamp(baseQuality*(1-attentionRisk*.12)*(a.id==="fang"?1:1-fxRisk.score*.08)*(1-earningsRisk.score*.18),.2,1);
 if(!coveredFeeds.has("geo")||!coveredFeeds.has("oil")||quality<.7)return null;
 const probability=Math.round(clamp(50+score*.75*23*quality,28,72)*10)/10;
 const sigma=(own.vol/Math.sqrt(252))/100,rangePct=Math.max(.003,sigma*1.5*(1+attentionHeat*.2+earningsRisk.score*.8));
 return {id:a.id,name:a.name,basePrice:own.price,baseDate:own.dateISO,technical:own.technical,fxInterventionRisk:fxRisk,earningsRisk,probability,direction:probability>=50?"上昇":"下落",rangeLow:own.price*(1-rangePct*(1+earningsRisk.pricedInScore*.2)),rangeHigh:own.price*(1+rangePct),actual:null,actualUp:null,actualDate:null,hit:null,quality,score,source:"GitHub Actions daily model"};
}
const path="forecast-history.json";
let history=[];
try{history=JSON.parse(await fs.readFile(path,"utf8"));if(!Array.isArray(history))history=[];}catch{}
let changed=0;
for(const day of history){
 for(const x of day.results||[]){
  const q=quotes[x.id],firstNextClose=q?.series?.find(v=>v.dateISO>x.baseDate);
  if(firstNextClose&&(x.actual===null||x.actual===undefined)){
   x.actual=firstNextClose.price;x.actualDate=firstNextClose.dateISO;x.actualUp=x.actual>x.basePrice;
   x.hit=(x.actualUp&&x.probability>=50)||(!x.actualUp&&x.probability<50);changed++;
  }
 }
}
if(!history.some(x=>x.date===jstDate)){
 const results=assets.map(forecast);
 const age=date=>Math.round((Date.parse(jstDate+"T00:00:00Z")-Date.parse(date+"T00:00:00Z"))/86400000);
 const maxAge=dayName==="Mon"?3:1;
 const stale=assets.filter(a=>!quotes[a.id]||age(quotes[a.id].dateISO)>maxAge).map(a=>({id:a.id,date:quotes[a.id]?.dateISO||null}));
 const criticalOilAvailable=Boolean(quotes.oil||quotes.brent);
 if(results.every(Boolean)&&!stale.length&&criticalOilAvailable){
  const marketContext=Object.fromEntries(Object.entries(quotes).map(([id,q])=>[id,{price:q.price,day:q.day,week:q.week,avg60:q.avg60,dateISO:q.dateISO,technical:q.technical||null}]));
  const newsContext=signalNews.map(n=>({title:n.title,category:n.category,score:n.score,date:n.date,link:n.link,source:n.source||"RSS",trustScore:n.trustScore??1}));
  history.push({date:jstDate,savedAt:new Date().toISOString(),fxInterventionRisk:fxInterventionRisk(quotes.fx),earningsCalendarStatus:earningsCalendar.status,earningsRisk:results.map(x=>({id:x.id,...x.earningsRisk})),results,newsCount:news.length,xCount:xSignals.posts.length,xAttention,marketContext,newsContext});
 }else{
  console.log("Forecast not saved: stale or missing critical data",JSON.stringify({stale,criticalOilAvailable}));
 }
}
history=history.slice(-365);
await fs.writeFile(path,JSON.stringify(history,null,2)+"\n");
console.log(JSON.stringify({date:jstDate,quotes:Object.keys(quotes),earningsCalendarStatus:earningsCalendar.status,earningsEvents:earningsCalendar.events.length,news:news.length,xStatus:xSignals.status,xSearchHits:xSignals.posts.length,xCredible:xSignals.attention.crediblePosts,xUsage:xSignals.usage,newsCoverage:[...new Set(signalNews.map(n=>n.category))],errors,validated:changed,days:history.length}));
if(!assets.every(a=>quotes[a.id]))throw new Error("Not all three index prices were available; no daily forecast was recorded.");
