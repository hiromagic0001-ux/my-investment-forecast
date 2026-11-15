import fs from "node:fs/promises";

const COMPLETE_CACHE_MAX_AGE_MS=6*60*60*1000;
const PARTIAL_CACHE_MAX_AGE_MS=60*60*1000;
try{
 const cached=JSON.parse(await fs.readFile("macro-data.json","utf8"));
 const age=Date.now()-Date.parse(cached.generatedAt||"");
 const cacheLimit=cached.status==="ok"?COMPLETE_CACHE_MAX_AGE_MS:PARTIAL_CACHE_MAX_AGE_MS;
 if(["ok","partial"].includes(cached.status)&&Number(cached.fredSuccessCount||0)>0&&Array.isArray(cached.signals)&&cached.signals.length>=3&&age>=0&&age<cacheLimit){
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
let observations={},fredErrors=[];
const fredResults=await Promise.allSettled(series.map(async ([id])=>{
 const url="https://fred.stlouisfed.org/graph/fredgraph.csv?id="+encodeURIComponent(id)+"&cosd="+start.toISOString().slice(0,10);
 const response=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; MacroResearchBot/1.0)"},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Error(id+" HTTP "+response.status);
 const lines=(await response.text()).trim().split(/\\r?\\n/);
 if(lines.length<2)throw new Error(id+" returned no observations");
 const header=csvLine(lines.shift()||"");
 const dateIndex=header.findIndex(v=>/^(observation_date|date)$/i.test(v));
 const valueIndex=header.findIndex(v=>v===id);
 if(dateIndex<0||valueIndex<0)throw new Error(id+" CSV columns not recognized: "+header.join(","));
 const rows=[];
 for(const line of lines){const row=csvLine(line),value=Number(row[valueIndex]);if(row[dateIndex]&&Number.isFinite(value))rows.push({date:row[dateIndex],value});}
 if(!rows.length)throw new Error(id+" returned no numeric observations");
 return [id,rows];
}));
for(let i=0;i<fredResults.length;i++){
 const result=fredResults[i],id=series[i][0];
 if(result.status==="fulfilled")observations[result.value[0]]=result.value[1];
 else fredErrors.push(String(result.reason?.message||result.reason));
}
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