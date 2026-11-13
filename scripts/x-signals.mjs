const QUERIES = [
  {category:"geo",query:'Iran OR Hormuz OR Houthi OR tanker OR "oil supply" OR airstrike OR ceasefire OR イラン OR ホルムズ OR フーシ派 -is:retweet'},
  {category:"oil",query:'WTI OR Brent OR "crude oil" OR OPEC OR "oil price" OR 原油 OR 石油供給 OR 原油高 -is:retweet'},
  {category:"tech",query:'$NVDA OR Nvidia OR semiconductor OR "AI data center" OR 半導体 OR エヌビディア -is:retweet'}
];
const PRIMARY = new Set(["federalreserve","eia_gov","iea","opecsecretariat","whitehouse","centcom","usnavy","statedept","sec_news","sec_investor_ed"]);
const NEWS = new Set(["reuters","reutersbiz","reutersjapan","ap","apnews","bloomberg","business","cnbc","wsj","ft","nikkeiasia","nikkei"]);
const TRUSTED_DOMAINS = new Set(["reuters.com","apnews.com","bloomberg.com","cnbc.com","wsj.com","ft.com","nikkei.com","nikkei.com","eia.gov","iea.org","opec.org","federalreserve.gov","sec.gov","state.gov","defense.gov","whitehouse.gov"]);
const OFFICIAL_DOMAINS = new Set(["eia.gov","iea.org","opec.org","federalreserve.gov","sec.gov","state.gov","defense.gov","whitehouse.gov"]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hostOf=value=>{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}};
function eventSignal(text,category){
  const s=text.toLowerCase();
  const relief=["ceasefire","truce","de-escalation","deescalation","peace deal","talks resume","tensions ease","停戦","和平","緊張緩和","協議再開","攻撃停止"];
  const escalation=["airstrike","air strike","missile attack","tanker hit","tanker attack","pipeline attack","oil facility attack","blockade","strait closure","shipping disrupted","military escalation","explosion","爆発","攻撃","空爆","ミサイル","タンカー被害","石油施設","封鎖","航行停止"];
  if(category==="geo"){
    if(relief.some(w=>s.includes(w)))return {eventType:"緊張緩和・停戦",impactScore:.85};
    if(escalation.some(w=>s.includes(w)))return {eventType:"攻撃・供給障害",impactScore:-.9};
    return {eventType:"地政学リスク",impactScore:-.25};
  }
  if(category==="oil"){
    if(["supply disruption","production cut","output cut","shortage","price surge","crude jumps","oil jumps","原油高","供給停止","減産","急騰"].some(w=>s.includes(w)))return {eventType:"原油高・供給懸念",impactScore:-.7};
    if(["supply restored","production increase","output increase","oversupply","crude falls","oil drops","price plunge","原油安","供給再開","増産"].some(w=>s.includes(w)))return {eventType:"原油安・供給改善",impactScore:.65};
    return {eventType:"原油関連・方向未確定",impactScore:0};
  }
  if(["export ban","export controls","sanctions","guidance cut","weak demand","chip restrictions","規制強化","輸出規制","需要減","下方修正"].some(w=>s.includes(w)))return {eventType:"半導体・AI逆風",impactScore:-.75};
  if(["earnings beat","record revenue","strong demand","capex increase","guidance raise","受注増","上方修正","需要拡大","設備投資増"].some(w=>s.includes(w)))return {eventType:"半導体・AI追い風",impactScore:.65};
  return {eventType:"半導体・AI関連",impactScore:0};
}
function tokenize(text){
  return [...new Set((text.toLowerCase().match(/[a-z0-9$]{3,}|[\u3040-\u30ff\u4e00-\u9faf]{2,}/g)||[]).filter(x=>!["the","and","for","with","from","that","this","will","have","has","about","into","over","after","before"].includes(x)))];
}
function overlaps(a,b){
  const aa=new Set(tokenize(a)),bb=tokenize(b);
  return bb.filter(x=>aa.has(x)).length;
}
function accountTrust(user,urls){
  const handle=(user.username||"").toLowerCase();
  const primary=PRIMARY.has(handle),news=NEWS.has(handle);
  const officialUrl=urls.some(u=>OFFICIAL_DOMAINS.has(hostOf(u)));
  const trustedUrl=urls.some(u=>[...TRUSTED_DOMAINS].some(d=>hostOf(u)===d||hostOf(u).endsWith("."+d)));
  const created=Date.parse(user.created_at||"");
  const ageYears=Number.isFinite(created)?(Date.now()-created)/31557600000:0;
  const verifiedType=user.verified_type||"";
  let score=primary?.95:news?.82:verifiedType==="government"?.72:verifiedType==="business"?.58:.22;
  if(ageYears>=5)score+=.04;
  if(officialUrl)score+=.08;
  else if(trustedUrl)score+=.05;
  return {score:clamp(score,0,.99),primary,news,officialUrl,trustedUrl,ageYears,verifiedType};
}
export async function fetchXSignals(rssNews=[]){
  const disabled={status:"disabled",reason:"X API未接続。X_API_ENABLED=true と X_BEARER_TOKEN が設定されるまでAPIを呼び出しません。",posts:[],attention:{posts:0,authors:0,engagement:0},usage:{maxPosts:30,requests:0}};
  if(process.env.X_API_ENABLED!=="true"||!process.env.X_BEARER_TOKEN)return disabled;
  const token=process.env.X_BEARER_TOKEN;
  const raw=[],errors=[];
  let requests=0,reads=0;
  for(const item of QUERIES){
    if(reads>=30)break;
    const params=new URLSearchParams({
      query:item.query,
      max_results:String(Math.min(10,30-reads)),
      "tweet.fields":"created_at,public_metrics,lang,author_id,entities,referenced_tweets",
      expansions:"author_id",
      "user.fields":"created_at,public_metrics,verified,verified_type,username"
    });
    try{
      requests++;
      const response=await fetch("https://api.x.com/2/tweets/search/recent?"+params.toString(),{headers:{Authorization:"Bearer "+token}});
      if(!response.ok){
        const body=await response.text();
        errors.push("X API "+response.status+": "+body.slice(0,180));
        continue;
      }
      const json=await response.json();
      const users=new Map((json.includes?.users||[]).map(u=>[u.id,u]));
      for(const post of json.data||[]){
        const user=users.get(post.author_id)||{username:"unknown"};
        const urls=(post.entities?.urls||[]).map(u=>u.expanded_url||u.unwound_url||u.url).filter(Boolean);
        raw.push({post,user,urls,category:item.category});
        reads++;
      }
    }catch(error){errors.push(String(error.message||error).slice(0,180));}
  }
  const unique=[...new Map(raw.map(x=>[x.post.id,x])).values()];
  const prepared=unique.map(x=>{
    const source=accountTrust(x.user,x.urls);
    const event=eventSignal(x.post.text,x.category);
    const engagement=x.post.public_metrics||{};
    const url="https://x.com/"+(x.user.username||"i")+"/status/"+x.post.id;
    return {id:x.post.id,text:x.post.text,author:x.user.username||"unknown",authorId:x.user.id||"",createdAt:x.post.created_at||"",url,category:x.category,sourceScore:source.score,sourceClass:source.primary?"一次情報候補":source.news?"主要報道機関":source.verifiedType==="government"?"政府認証アカウント":"一般アカウント",officialUrl:source.officialUrl,trustedUrl:source.trustedUrl,ageYears:Number(source.ageYears.toFixed(1)),followers:x.user.public_metrics?.followers_count||0,verifiedType:source.verifiedType,eventType:event.eventType,impactScore:event.impactScore,engagement:(engagement.like_count||0)+(engagement.retweet_count||0)*2+(engagement.reply_count||0)+(engagement.quote_count||0)*2,urls:x.urls};
  });
  for(const p of prepared){
    const independent=prepared.filter(q=>q.id!==p.id&&q.authorId!==p.authorId&&q.category===p.category&&overlaps(p.text,q.text)>=2).length;
    const rssMatch=rssNews.some(n=>n.category===p.category&&overlaps(p.text,n.title)>=2);
    p.independentPosts=independent;
    p.rssCorroborated=rssMatch;
    p.verifiedForSignal=(p.sourceClass==="一次情報候補"&&(p.officialUrl||p.verifiedType==="government"||independent>=1||rssMatch))
      ||(p.sourceClass==="主要報道機関"&&(p.trustedUrl||rssMatch||independent>=2));
    p.confidence=p.verifiedForSignal?"予測反映候補":p.sourceScore>=.55?"要裏付け":"未確認・方向予測に不採用";
    p.trustScore=clamp(p.sourceScore+(p.officialUrl?.04:0)+(p.rssCorroborated?.06:0)+(independent>=2?.04:0),0,.99);
  }
  prepared.sort((a,b)=>(b.verifiedForSignal-a.verifiedForSignal)||(b.trustScore-a.trustScore)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const authors=new Set(prepared.map(p=>p.authorId).filter(Boolean));
  const attention={posts:prepared.length,authors:authors.size,engagement:prepared.reduce((s,p)=>s+p.engagement,0),crediblePosts:prepared.filter(p=>p.verifiedForSignal).length};
  return {status:errors.length?"partial":"active",reason:errors.join(" | "),posts:prepared.slice(0,30),attention,usage:{maxPosts:30,requests,postsRead:reads,estimatedUsd:Math.round(reads*.005*1000)/1000}};
}
