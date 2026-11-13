const WATCH = new Set(["AAPL","MSFT","AMZN","GOOGL","GOOG","META","NVDA","AVGO","ORCL","TSLA","NFLX","PLTR","AMD","MU","CRM","QCOM"]);
const NAMES = {
 AAPL:"Apple",MSFT:"Microsoft",AMZN:"Amazon",GOOGL:"Alphabet",GOOG:"Alphabet",META:"Meta",
 NVDA:"NVIDIA",AVGO:"Broadcom",ORCL:"Oracle",TSLA:"Tesla",NFLX:"Netflix",PLTR:"Palantir",
 AMD:"AMD",MU:"Micron",CRM:"Salesforce",QCOM:"Qualcomm"
};
const dateFmt=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const asOfDate=dateFmt.format(new Date());
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shiftDate=(iso,days)=>{const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/[$,%]/g,"").replace(/,/g,""));return Number.isFinite(n)?n:null;};
function field(row,...keys){for(const k of keys){if(row[k]!==undefined&&row[k]!==null&&row[k]!=="")return row[k];}return null;}
async function getDay(date){
 const url="https://api.nasdaq.com/api/calendar/earnings?date="+date;
 const r=await fetch(url,{headers:{
  "Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9",
  "Origin":"https://www.nasdaq.com","Referer":"https://www.nasdaq.com/market-activity/earnings",
  "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
 }});
 if(!r.ok)throw new Error("Nasdaq calendar HTTP "+r.status);
 const j=await r.json(),rows=j?.data?.rows||j?.data?.rows?.data||[];
 if(!Array.isArray(rows))throw new Error("Nasdaq calendar response shape changed");
 return rows;
}
export async function fetchEarningsCalendar(){
 const dates=Array.from({length:9},(_,i)=>shiftDate(asOfDate,i-2));
 const events=[],errors=[];
 for(const date of dates){
  try{
   const rows=await getDay(date);
   for(const row of rows){
    const symbol=String(field(row,"symbol","Symbol","ticker")||"").toUpperCase();
    if(!WATCH.has(symbol))continue;
    const reportTime=String(field(row,"time","Time","reportTime")||"Time not supplied");
    const epsForecast=num(field(row,"epsForecast","eps_forecast","consensusEPS","consensus_eps"));
    const actualEPS=num(field(row,"eps","actualEPS","actual_eps","reportedEPS"));
    const surprise=num(field(row,"surprise","surprisePercent","surprise_pct"));
    events.push({
     date,symbol,name:String(field(row,"name","companyName","company")||NAMES[symbol]),
     reportTime,marketCap:num(field(row,"marketCap","market_cap")),
     epsForecast,actualEPS,surprise,
     estimateCount:num(field(row,"noOfEsts","numberOfEstimates","number_of_estimates")),
     fiscalQuarter:String(field(row,"fiscalQuarterEnding","fiscal_quarter_ending")||""),
     source:"Nasdaq earnings calendar",
     sourceUrl:"https://www.nasdaq.com/market-activity/stocks/"+symbol.toLowerCase()+"/earnings"
    });
   }
  }catch(e){errors.push({date,error:String(e.message||e)});}
  await sleep(120);
 }
 const unique=[...new Map(events.map(e=>[e.date+"_"+e.symbol,e])).values()]
  .sort((a,b)=>a.date.localeCompare(b.date)||(b.marketCap||0)-(a.marketCap||0));
 return {
  asOfDate,generatedAt:new Date().toISOString(),status:errors.length===0?"ok":events.length?"partial":"unavailable",
  source:"Nasdaq public earnings calendar",window:{from:dates[0],to:dates.at(-1)},
  events:unique,errors:errors.slice(0,4),
  note:"発表予定日は変更される場合があります。Nasdaq掲載情報を取得できない日は「決算なし」と判断しません。"
 };
}
