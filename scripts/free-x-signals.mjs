const SEARCHES = [
 ...["CENTCOM","USNavy","WhiteHouse","StateDept","OSINTtechnical","sentdefender","clashreport"].map(account=>({category:"geo",account,query:'site:x.com/'+account+' (Iran OR Hormuz OR Houthi OR tanker OR airstrike OR ceasefire OR イラン OR ホルムズ)'})),
 ...["EIAgov","IEA","OPECSecretariat","ReutersBiz","Bloomberg"].map(account=>({category:"oil",account,query:'site:x.com/'+account+' (WTI OR Brent OR crude OR OPEC OR oil supply OR 原油 OR 石油供給)'})),
 ...["NVIDIA","Reuters","Bloomberg"].map(account=>({category:"tech",account,query:'site:x.com/'+account+' (semiconductor OR AI data center OR chip OR 半導体 OR エヌビディア)'}))
];
const OFFICIAL=["CENTCOM","USNavy","WhiteHouse","StateDept","EIAgov","IEA","OPECSecretariat","NVIDIA"];
const MEDIA=["Reuters","ReutersBiz","Bloomberg","business"];
const TRUSTED=["reuters.com","apnews.com","bloomberg.com","cnbc.com","wsj.com","ft.com","nikkei.com","eia.gov","iea.org","opec.org","defense.gov","whitehouse.gov","state.gov"];
const host=u=>{try{return new URL(u).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}};
const decode=s=>s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function classify(text,category){
 const s=text.toLowerCase();
 const positive=["ceasefire","truce","de-escalation","peace deal","tensions ease","停戦","和平","緊張緩和","協議再開"];
 const negative=["airstrike","missile attack","tanker hit","blockade","strait closure","shipping disrupted","explosion","攻撃","空爆","ミサイル","タンカー被害","封鎖","航行停止"];
 if(category==="geo")return {eventType:positive.some(x=>s.includes(x))?"緊張緩和":negative.some(x=>s.includes(x))?"攻撃・供給障害":"地政学リスク",impactScore:positive.some(x=>s.includes(x))?.8:negative.some(x=>s.includes(x))?-.85:-.2};
 if(category==="oil")return {eventType:negative.some(x=>s.includes(x))?"供給懸念・原油高":/(surge|jumps|rises|increase|原油高|急騰|減産)/i.test(s)?"原油高":/(falls|drops|oversupply|increase production|原油安|増産)/i.test(s)?"原油安":"原油関連・方向未確定",impactScore:negative.some(x=>s.includes(x))?-.65:/(surge|jumps|rises|increase|原油高|急騰|減産)/i.test(s)?-.5:/(falls|drops|oversupply|原油安|増産)/i.test(s)?.35:0};
 return {eventType:/(export ban|sanctions|weak demand|規制強化|輸出規制|需要減)/i.test(s)?"半導体・AI逆風":/(earnings beat|record revenue|strong demand|capex increase|上方修正|需要拡大|設備投資増)/i.test(s)?"半導体・AI追い風":"半導体・AI関連",impactScore:/(export ban|sanctions|weak demand|規制強化|輸出規制|需要減)/i.test(s)?-.65:/(earnings beat|record revenue|strong demand|capex increase|上方修正|需要拡大|設備投資増)/i.test(s)?.55:0};
}
function tokens(s){return new Set((s.toLowerCase().match(/[a-z0-9$]{3,}|[\u3040-\u30ff\u4e00-\u9faf]{2,}/g)||[]).filter(x=>!["the","and","for","with","from","that","this","will","have","has"].includes(x)))}
function overlap(a,b){const x=tokens(a),y=tokens(b);return [...x].filter(t=>y.has(t)).length}
function parse(xml,category,account){
 const items=[];
 for(const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)){
  const block=m[1],get=(tag)=>decode((block.match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+tag+">","i"))||[])[1]||"");
  const title=get("title"),link=get("link"),date=get("pubDate"),source=get("source");
  if(!title||!link)continue;
  const match=title.match(/@([A-Za-z0-9_]{1,15})/);
  const author=account||match?.[1]||"";
  const official=OFFICIAL.some(x=>x.toLowerCase()===author.toLowerCase());
  const media=MEDIA.some(x=>x.toLowerCase()===author.toLowerCase());
  const event=classify(title,category);
  items.push({id:link,title,author:author||source||"検索結果",createdAt:date,url:link,category,sourceClass:official?"公的機関候補":media?"主要報道機関候補":"X検索掲載",sourceScore:official?.78:media?.65:.35,officialUrl:false,trustedUrl:false,impactScore:event.impactScore,eventType:event.eventType,engagement:0,independentPosts:0,copyClusterPosts:0,coordinationFlag:false,verifiedForSignal:false,confidence:"未確認・予測不採用",trustScore:official?.78:media?.65:.35,via:"Google News RSS（X公開投稿の検索インデックス）"});
 }
 return items;
}
export async function fetchFreeXSignals(rssNews=[]){
 const all=[],errors=[];
 for(const q of SEARCHES){
  try{
   const url="https://news.google.com/rss/search?q="+encodeURIComponent(q.query+" when:3d")+"&hl=ja&gl=JP&ceid=JP:ja";
   const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; MarketSignalReader/1.0)"}});
   if(!res.ok){errors.push("RSS "+res.status+" "+q.category);continue;}
   all.push(...parse(await res.text(),q.category,q.account));
  }catch(e){errors.push(String(e.message||e).slice(0,100));}
 }
 const unique=[...new Map(all.map(p=>[p.id,p])).values()];
 for(const p of unique){
  const independent=rssNews.filter(n=>n.category===p.category&&TRUSTED.some(d=>host(n.link)===d||host(n.link).endsWith("."+d))&&overlap(p.title,n.title)>=2).length;
  const otherX=unique.filter(q=>q.id!==p.id&&q.category===p.category&&overlap(p.title,q.title)>=2).length;
  p.independentPosts=independent;
  p.copyClusterPosts=otherX;
  p.coordinationFlag=otherX>=3;
  p.rssCorroborated=independent>0;
  p.verifiedForSignal=!p.coordinationFlag&&p.rssCorroborated&&(p.sourceScore>=.6);
  p.confidence=p.coordinationFlag?"同文・類似投稿の集中":p.verifiedForSignal?"報道裏付けあり・予測反映候補":"検索掲載のみ・未確認";
  if(p.verifiedForSignal)p.trustScore=clamp(p.sourceScore+.12,0,.9);
 }
 unique.sort((a,b)=>(b.verifiedForSignal-a.verifiedForSignal)||(b.trustScore-a.trustScore)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
 const authors=new Set(unique.map(p=>p.author).filter(Boolean));
 return {status:errors.length?"partial":"free-indexed",reason:errors.join(" | "),posts:unique.slice(0,30),attention:{posts:unique.length,authors:authors.size,engagement:0,crediblePosts:unique.filter(p=>p.verifiedForSignal).length,coordinationFlags:unique.filter(p=>p.coordinationFlag).length},usage:{maxPosts:30,requests:SEARCHES.length,postsRead:unique.length,estimatedUsd:0,method:"Google News RSSの公開検索インデックス。X公式API不使用。"}};
}
