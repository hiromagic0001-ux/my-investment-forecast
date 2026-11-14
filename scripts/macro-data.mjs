import fs from "node:fs/promises";

const CACHE_MAX_AGE_MS=6*60*60*1000;
try{
 const cached=JSON.parse(await fs.readFile("macro-data.json","utf8"));
 const age=Date.now()-Date.parse(cached.generatedAt||"");
 if(cached.status==="ok"&&Array.isArray(cached.signals)&&cached.signals.length>=6&&age>=0&&age<CACHE_MAX_AGE_MS){
  console.log(JSON.stringify({status:"cached",signals:cached.signals.length,ageMinutes:Math.round(age/60000)}));
  process.exit(0);
 }
}catch{}
const series = [
  ["CPIAUCSL","米国CPI","monthly","inflation"],
  ["CPILFESL","米国コアCPI","monthly","inflation"],
  ["UNRATE","米国失業率","monthly","labor"],
  ["PAYEMS","米国非農業部門雇用者数","monthly","labor"],
  ["ICSA","米国新規失業保険申請","weekly","labor"],
  ["INDPRO","米国鉱工業生産","monthly","growth"],
  ["UMCSENT","米国消費者信頼感","monthly","growth"],
  ["T10Y2Y","米国10年-2年金利差","daily","rates"],
  ["DGS10","米国10年国債利回り","daily","rates"],
  ["BAMLH0A0HYM2","米国ハイイールド債スプレッド","daily","credit"],
  ["NFCI","米国金融環境指数","weekly","credit"]
];
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const csvLine=line=>{const out=[];let s="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){s+='"';i++;}else q=!q;}else if(c===","&&!q){out.push(s);s="";}else s+=c;}out.push(s);return out;};
const start=new Date();start.setUTCFullYear(start.getUTCFullYear()-5);
const url="https://fred.stlouisfed.org/graph/fredgraph.csv?id="+series.map(x=>x[0]).join(",")+"&cosd="+start.toISOString().slice(0,10);
let observations={},error=null;
try{
 const response=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; MacroResearchBot/1.0)"} ,signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Error("FRED CSV HTTP "+response.status);
 const lines=(await response.text()).trim().split(/\r?\n/);
 const headers=csvLine(lines.shift()||"");
 for(const id of headers.slice(1))observations[id]=[];
 for(const line of lines){const row=csvLine(line);if(row.length<2)continue;const date=row[0];for(let i=1;i<headers.length;i++){const v=Number(row[i]);if(Number.isFinite(v))observations[headers[i]]?.push({date,value:v});}}
}catch(e){error=String(e.message||e);}
const latest=id=>observations[id]?.at(-1)||null;
const prior=(id,n)=>{const a=observations[id]||[];return a.length>n?a[a.length-1-n]:null;};
const change=(id,n,percent=false)=>{const a=latest(id),b=prior(id,n);if(!a||!b||!b.value)return null;return percent?(a.value/b.value-1)*100:a.value-b.value;};
const signals=[];
const add=(id,label,value,detail,sourceId)=>{if(Number.isFinite(value))signals.push({id,label,value:clamp(value),detail,source:"FRED",seriesId:sourceId,observationDate:latest(sourceId)?.date||null});};
const cpi=change("CPIAUCSL",12,true),core=change("CPILFESL",12,true);
if(cpi!==null)add("macro_cpi","米国CPI前年比",clamp((2.5-cpi)/2.5),`前年比 ${cpi.toFixed(2)}%`,"CPIAUCSL");
if(core!==null)add("macro_core_cpi","米国コアCPI前年比",clamp((2.5-core)/2.5),`前年比 ${core.toFixed(2)}%`,"CPILFESL");
const ur=change("UNRATE",3,false);if(ur!==null)add("macro_unemployment","米国失業率の3か月変化",clamp(-ur/0.8),`3か月で ${ur>=0?"+":""}${ur.toFixed(2)}pt`,"UNRATE");
const jobs=change("PAYEMS",3,true);if(jobs!==null)add("macro_payrolls","米国雇用者数の3か月変化",clamp(jobs/0.8),`3か月 ${jobs>=0?"+":""}${jobs.toFixed(2)}%`,"PAYEMS");
const claims=change("ICSA",4,true);if(claims!==null)add("macro_claims","新規失業保険申請の4週変化",clamp(-claims/15),`4週 ${claims>=0?"+":""}${claims.toFixed(1)}%`,"ICSA");
const ip=change("INDPRO",3,true);if(ip!==null)add("macro_indpro","米国鉱工業生産の3か月変化",clamp(ip/1.5),`3か月 ${ip>=0?"+":""}${ip.toFixed(2)}%`,"INDPRO");
const sent=change("UMCSENT",3,false);if(sent!==null)add("macro_sentiment","米国消費者信頼感の3か月変化",clamp(sent/12),`3か月 ${sent>=0?"+":""}${sent.toFixed(1)}pt`,"UMCSENT");
const curve=latest("T10Y2Y");if(curve)add("macro_curve","米国イールドカーブ",clamp(curve.value/1.5),`10年-2年 ${curve.value.toFixed(2)}pt`,"T10Y2Y");
const hy=latest("BAMLH0A0HYM2");if(hy)add("macro_hy","ハイイールド債信用スプレッド",clamp((4.5-hy.value)/3),`スプレッド ${hy.value.toFixed(2)}%`,"BAMLH0A0HYM2");
const nf=latest("NFCI");if(nf)add("macro_nfci","米国金融環境指数",clamp(-nf.value/0.7),`指数 ${nf.value.toFixed(3)}`,"NFCI");
const ten=change("DGS10",63,false);if(ten!==null)add("macro_10y","米国10年金利の約3か月変化",clamp(-ten/1.2),`約3か月 ${ten>=0?"+":""}${ten.toFixed(2)}pt`,"DGS10");
const result={schemaVersion:1,source:"FRED public data export",generatedAt:new Date().toISOString(),status:error?"degraded":signals.length>=6?"ok":"partial",seriesCount:series.length,signalCount:signals.length,signals,series:series.map(([id,label,frequency,category])=>({id,label,frequency,category,latest:latest(id)})),error};
await fs.writeFile("macro-data.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({status:result.status,signals:signals.length,series:series.length,error}));
if(signals.length<6)throw new Error("Insufficient official macro series; refusing to publish a new forecast.");
