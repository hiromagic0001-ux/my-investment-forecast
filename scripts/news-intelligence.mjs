import fs from "node:fs/promises";

const searches = [
 ["rates","Federal Reserve Fed interest rates policy decision bond yields", "when:2d"],
 ["inflation","US CPI inflation PCE producer prices inflation expectations", "when:2d"],
 ["jobs","US jobs employment unemployment wages payrolls economic data", "when:2d"],
 ["central","ECB Bank of Japan BOJ PBOC central bank monetary policy", "when:2d"],
 ["japan","Japan economy yen Nikkei BOJ wages inflation GDP", "when:2d"],
 ["tech","AI semiconductor Nvidia chip data center hyperscaler capex", "when:2d"],
 ["oil","Brent WTI crude oil OPEC IEA EIA supply demand", "when:2d"],
 ["geo","Iran Strait of Hormuz shipping sanctions geopolitical risk energy", "when:2d"],
 ["fx","US dollar yen euro currency foreign exchange intervention", "when:2d"],
 ["credit","banking credit markets bond spreads liquidity financial stability", "when:2d"],
 ["trade","US China tariffs trade restrictions export controls supply chains", "when:2d"],
 ["macro","global economy GDP recession PMI retail sales manufacturing", "when:2d"],
 ["official","site:federalreserve.gov monetary policy press release", "when:7d"],
 ["official","site:bls.gov news release CPI employment", "when:7d"],
 ["official","site:bea.gov news GDP PCE", "when:7d"],
 ["official","site:boj.or.jp/en/ announcements monetary policy", "when:7d"],
 ["official","site:ecb.europa.eu press monetary policy", "when:7d"],
 ["official","site:iea.org news oil market report", "when:7d"]
];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const decode=s=>String(s||"").replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
function field(xml,name){const m=xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"));return m?decode(m[1]):"";}
function sourceWeight(name,link){
 const s=(name+" "+link).toLowerCase();
 if(/federal reserve|bls\.gov|bea\.gov|boj\.or\.jp|ecb\.europa|iea\.org|eia\.gov|imf\.org|worldbank\.org|oecd\.org|treasury\.gov|meti\.go\.jp|stat\.go\.jp/.test(s))return 1;
 if(/reuters|associated press|apnews|bloomberg|financial times|wall street journal|nikkei|cnbc|bbc|nhk/.test(s))return .92;
 if(/yahoo finance|marketwatch|investing\.com|the economist/.test(s))return .82;
 return .55;
}
function classify(id,title){
 const s=title.toLowerCase();
 if(id==="official")return /federal reserve|fed|interest rate|inflation|cpi|pce|treasury|yield|金利/.test(s)?"rates":/oil|energy|原油/.test(s)?"oil":/boj|japan|yen|日銀|日本|円/.test(s)?"japan":"global";
 if(["rates","inflation","jobs","central","japan","tech","oil","geo","fx","credit","trade","macro"].includes(id))return ({inflation:"rates",jobs:"rates",central:"rates",macro:"global"})[id]||id;
 return "global";
}
function score(title,category){
 const s=title.toLowerCase();
 const positive=["ceasefire","peace deal","tensions ease","rate cut","inflation cools","inflation slows","jobs growth","strong demand","earnings beat","upgrade","stimulus","利下げ","インフレ鈍化","停戦","緊張緩和","需要増","上方修正","景気回復"];
 const negative=["attack","airstrike","missile","sanction","war escalates","oil disruption","inflation rises","hot inflation","rate hike","recession","default","bank failure","downgrade","layoffs","tariff hike","急騰するインフレ","インフレ加速","利上げ","景気後退","銀行破綻","攻撃","制裁","供給障害","関税引き上げ"];
 const p=positive.filter(w=>s.includes(w)).length,n=negative.filter(w=>s.includes(w)).length;
 let v=clamp((p-n)*.38,-.76,.76);
 if(category==="geo"&&/iran|hormuz|houthi|war|missile|attack|タンカー|ホルムズ|イラン|攻撃/.test(s)&&!positive.some(w=>s.includes(w)))v=Math.min(v,-.35);
 if(category==="oil")v=-v;
 return v;
}
async function fetchSearch(id,q,window){
 const url="https://news.google.com/rss/search?q="+encodeURIComponent(q+" "+window)+"&hl=en-US&gl=US&ceid=US:en";
 const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; MarketNewsCollector/1.0)"},signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw new Error("RSS "+res.status);
 const xml=await res.text(),out=[];
 for(const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)){
  const b=m[1],title=field(b,"title"),link=field(b,"link"),date=field(b,"pubDate"),publisher=field(b,"source");
  if(!title||!link)continue;
  const category=classify(id,title),weight=sourceWeight(publisher,link),published=Date.parse(date);
  if(Number.isFinite(published)&&Date.now()-published>8*86400000)continue;
  const s=score(title,category);
  out.push({title,link,date,category,label:({rates:"金利・インフレ",tech:"AI・半導体",japan:"日本経済・日銀",oil:"原油・エネルギー",geo:"地政学",fx:"為替",credit:"金融システム",trade:"貿易・政策",global:"世界景気"})[category]||"経済ニュース",publisher,sourceWeight:weight,score:s,signalEligible:weight>=.8&&Math.abs(s)>=.30});
 }
 return out;
}
const settled=await Promise.allSettled(searches.map(([id,q,w])=>fetchSearch(id,q,w)));
const all=settled.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
const unique=new Map();
for(const n of all){
 const key=n.link.split("?")[0]||n.title;
 const prev=unique.get(key);
 if(!prev||n.sourceWeight>prev.sourceWeight)unique.set(key,n);
}
const items=[...unique.values()].sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).slice(0,180);
const successful=settled.filter(x=>x.status==="fulfilled").length;
const result={schemaVersion:1,generatedAt:new Date().toISOString(),status:successful===searches.length?"ok":successful>=Math.ceil(searches.length*.7)?"partial":"degraded",sources:{queries:searches.length,succeeded:successful,failed:searches.length-successful},items};
await fs.writeFile("market-news.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({status:result.status,queries:result.sources,items:items.length,signalEligible:items.filter(x=>x.signalEligible).length}));
if(successful===0)process.exitCode=1;
