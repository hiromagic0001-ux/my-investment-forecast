import fs from "node:fs/promises";

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

async function quote(ticker){
 const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(ticker)+"?range=6mo&interval=1d";
 const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
 if(!r.ok) throw new Error("Yahoo HTTP "+r.status+" "+ticker);
 const j=await r.json(),x=j.chart?.result?.[0];
 if(!x) throw new Error("No Yahoo data: "+ticker);
 const q=x.indicators.quote[0],pairs=x.timestamp.map((t,i)=>({t,c:q.close[i]})).filter(v=>v.c!=null);
 if(pairs.length<25) throw new Error("Insufficient history: "+ticker);
 const c=pairs.map(v=>v.c),last=c.at(-1),prev=c.at(-2),w=c.at(-6),m=c.at(-22);
 const daily=c.slice(1).map((v,i)=>Math.log(v/c[i]));
 const vol=Math.sqrt(daily.slice(-20).reduce((s,v)=>s+v*v,0)/Math.min(20,daily.length))*Math.sqrt(252)*100;
 const avg60=c.slice(-Math.min(60,c.length)).reduce((s,v)=>s+v,0)/Math.min(60,c.length);
 const series=pairs.map(v=>({dateISO:new Date(v.t*1000).toISOString().slice(0,10),price:v.c}));
 return {price:last,day:(last/prev-1)*100,week:(last/w-1)*100,month:(last/m-1)*100,vol,avg60,series,dateISO:series.at(-1).dateISO};
}
const feeds=[
 ["rates","Federal Reserve interest rates inflation CPI Treasury yields"],
 ["tech","AI semiconductor chip demand Nvidia data center technology stocks"],
 ["japan","Japan economy BOJ yen Nikkei stocks"],
 ["geo","Iran war OR Israel Iran conflict OR Strait of Hormuz OR Houthi attack OR tanker attack OR Saudi oil facility OR ceasefire OR イラン戦争 OR ホルムズ海峡 OR フーシ派 OR タンカー攻撃"],
 ["oil","Brent crude OR WTI crude OR oil prices OR oil supply OR OPEC OR 原油価格 OR 原油高 OR 石油供給"]
];
function sentimentFor(title,category){
 const s=title.toLowerCase();
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
  out.push({title,category,score:sentimentFor(title,category),date:get("pubDate"),link:get("link")});
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
const quoteJobs=[...indicators.map(async ([id,t])=>[id,await quote(t)]),...assets.map(async a=>[a.id,await quote(a.ticker)])];
const settled=await Promise.allSettled(quoteJobs),quotes={},errors=[];
for(const x of settled){if(x.status==="fulfilled")quotes[x.value[0]]=x.value[1];else errors.push(String(x.reason));}
const news=await newsItems();
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
 return clamp(raw/scale,-1,1);
}
function relFor(asset,cat){
 if(cat==="tech")return asset.id==="fang"?1.25:asset.id==="nikkei"?1:.55;
 if(cat==="nvda")return asset.id==="fang"?1.55:asset.id==="nikkei"?.8:.4;
 if(cat==="rates")return asset.id==="fang"?1:asset.id==="nikkei"?.75:.7;
 if(cat==="japan")return asset.id==="fang"?.15:asset.id==="nikkei"?.8:1;
 if(cat==="geo")return 1.0;if(cat==="oil")return asset.id==="fang"?.65:asset.id==="nikkei"?.75:.65;
 return .3;
}
function forecast(a){
 const own=quotes[a.id];if(!own)return null;
 const parts=[
  clamp(own.week/2.8,-1,1)*.24,
  clamp(own.month/7,-1,1)*.18,
  clamp((12-own.vol)/18,-.5,.5)*.05
 ];
 for(const [id,exp] of Object.entries(a.exp)){const v=factorValue(id);if(v!==null&&Math.abs(exp)>.01)parts.push(v*exp*.42);}
 if(quotes.nvda&&a.exp.nvda)parts.push(clamp(quotes.nvda.day/4,-1,1)*a.exp.nvda*.7);
 let total=0,weight=0;
 for(const n of news){const rel=relFor(a,n.category);total+=n.score*rel;weight+=rel;}
 const ns=weight?clamp(total/Math.max(2,weight),-1,1):0;
 parts.push(ns*.28);
 const score=clamp(parts.reduce((s,v)=>s+v,0),-.85,.85);
 const coverage=Object.keys(a.exp).filter(id=>id==="oil"?(quotes.oil||quotes.brent):quotes[id]).length/Object.keys(a.exp).length;
 const coveredFeeds=new Set(news.map(n=>n.category));
 const criticalCoverage=["geo","oil"].filter(id=>coveredFeeds.has(id)).length/2;
 const broadCoverage=["rates","tech","japan"].filter(id=>coveredFeeds.has(id)).length/3;
 const newsCoverage=.7*criticalCoverage+.3*broadCoverage;
 const quality=clamp(.2+.4*coverage+.4*newsCoverage,.2,1);
 if(quality<.7)return null;
 const probability=Math.round(clamp(50+score*.75*23*quality,28,72)*10)/10;
 const sigma=(own.vol/Math.sqrt(252))/100,rangePct=Math.max(.003,sigma*1.5);
 return {id:a.id,name:a.name,basePrice:own.price,baseDate:own.dateISO,probability,direction:probability>=50?"上昇":"下落",rangeLow:own.price*(1-rangePct),rangeHigh:own.price*(1+rangePct),actual:null,actualUp:null,actualDate:null,hit:null,quality,score,source:"GitHub Actions daily model"};
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
  const marketContext=Object.fromEntries(Object.entries(quotes).map(([id,q])=>[id,{price:q.price,day:q.day,week:q.week,avg60:q.avg60,dateISO:q.dateISO}]));
  const newsContext=news.map(n=>({title:n.title,category:n.category,score:n.score,date:n.date,link:n.link}));
  history.push({date:jstDate,savedAt:new Date().toISOString(),results,newsCount:news.length,marketContext,newsContext});
 }else{
  console.log("Forecast not saved: stale or missing critical data",JSON.stringify({stale,criticalOilAvailable}));
 }
}
history=history.slice(-365);
await fs.writeFile(path,JSON.stringify(history,null,2)+"\n");
console.log(JSON.stringify({date:jstDate,quotes:Object.keys(quotes),news:news.length,newsCoverage:[...new Set(news.map(n=>n.category))],errors,validated:changed,days:history.length}));
if(!assets.every(a=>quotes[a.id]))throw new Error("Not all three index prices were available; no daily forecast was recorded.");
