const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const MACRO_WEIGHTS={
 fang:{macro_cpi:-.20,macro_core_cpi:-.35,macro_unemployment:.18,macro_payrolls:.20,macro_claims:.15,macro_indpro:.16,macro_sentiment:.10,macro_curve:.12,macro_10y:-.22,macro_hy:.28,macro_nfci:.20,macro_cli_JPN:.03,macro_cli_CHN:.10,macro_cli_EA:.08,macro_cli_DEU:.05,macro_cli_GBR:.04},
 nikkei:{macro_cpi:-.10,macro_core_cpi:-.16,macro_unemployment:.12,macro_payrolls:.14,macro_claims:.10,macro_indpro:.17,macro_sentiment:.08,macro_curve:.10,macro_10y:-.10,macro_hy:.15,macro_nfci:.12,macro_cli_JPN:.24,macro_cli_CHN:.13,macro_cli_EA:.06,macro_cli_DEU:.04,macro_cli_GBR:.03},
 topix:{macro_cpi:-.10,macro_core_cpi:-.16,macro_unemployment:.12,macro_payrolls:.14,macro_claims:.10,macro_indpro:.17,macro_sentiment:.08,macro_curve:.10,macro_10y:-.10,macro_hy:.15,macro_nfci:.12,macro_cli_JPN:.28,macro_cli_CHN:.14,macro_cli_EA:.06,macro_cli_DEU:.04,macro_cli_GBR:.03}
};
const EARNINGS_EXPOSURE={
 fang:{NVDA:1,MSFT:1,AAPL:1,AMZN:1,GOOGL:1,GOOG:1,META:1,TSLA:.85,NFLX:.75,AVGO:.85,ORCL:.7,AMD:.65,MU:.55,PLTR:.45,CRM:.5,QCOM:.5},
 nikkei:{NVDA:.85,AVGO:.8,AMD:.75,MU:.75,QCOM:.65,MSFT:.35,AAPL:.35,GOOGL:.25,GOOG:.25,AMZN:.25,META:.2,ORCL:.3,TSLA:.2,NFLX:.1,PLTR:.2,CRM:.2},
 topix:{NVDA:.55,AVGO:.55,AMD:.55,MU:.6,QCOM:.55,MSFT:.3,AAPL:.3,GOOGL:.2,GOOG:.2,AMZN:.2,META:.15,ORCL:.25,TSLA:.15,NFLX:.1,PLTR:.15,CRM:.15}
};
const freshnessDays=id=>id.includes("claims")||id.includes("nfci")?28:id.includes("10y")||id.includes("curve")||id.includes("hy")?10:id.includes("cli")||id.includes("cpi")||id.includes("payrolls")||id.includes("unemployment")||id.includes("indpro")||id.includes("sentiment")?100:35;
const ageDays=(from,to)=>Math.floor((Date.parse(to+"T12:00:00Z")-Date.parse(from+"T12:00:00Z"))/86400000);
export function buildFundamentalAnalysis({assetId,macroSignals=[],earningsEvents=[],asOfDate}){
 const weights=MACRO_WEIGHTS[assetId]||MACRO_WEIGHTS.topix;
 const usable=[],stale=[],future=[];
 for(const s of macroSignals){
  const w=weights[s.id],date=String(s.observationDate||"").slice(0,10);
  if(!Number.isFinite(w)||!Number.isFinite(s.value)||!date)continue;
  const age=ageDays(date,asOfDate);
  if(age<0){future.push({id:s.id,date});continue;}
  if(age>freshnessDays(s.id)){stale.push({id:s.id,date,ageDays:age});continue;}
  usable.push({id:s.id,label:s.label,value:clamp(s.value),weight:Math.abs(w),contribution:clamp(s.value)*w,source:s.source||"unknown",observationDate:date,ageDays:age});
 }
 const macroWeight=usable.reduce((n,s)=>n+s.weight,0);
 const macroScore=macroWeight?clamp(usable.reduce((n,s)=>n+s.contribution,0)/usable.reduce((n,s)=>n+Math.abs(weights[s.id]),0)) :0;
 const relevant=(earningsEvents||[]).filter(e=>{
  const exposure=EARNINGS_EXPOSURE[assetId]?.[String(e.symbol||"").toUpperCase()]||0;
  if(!exposure||!Number.isFinite(Number(e.actualEPS))||!Number.isFinite(Number(e.epsForecast))||Number(e.epsForecast)<=0)return false;
  const diff=ageDays(e.date,asOfDate);
  return diff>=0&&diff<=5;
 }).map(e=>{
  const symbol=String(e.symbol).toUpperCase(),exposure=EARNINGS_EXPOSURE[assetId][symbol];
  const surprisePct=(Number(e.actualEPS)/Number(e.epsForecast)-1)*100;
  const surpriseScore=clamp(surprisePct/15);
  const reactionPct=Number.isFinite(e.reaction?.excessPct)?e.reaction.excessPct:null;
  const reactionScore=reactionPct===null?null:clamp(reactionPct/5);
  const score=reactionScore===null?surpriseScore:clamp(surpriseScore*.55+reactionScore*.45);
  return {symbol,name:e.name,date:e.date,epsForecast:e.epsForecast,actualEPS:e.actualEPS,surprisePct:Number(surprisePct.toFixed(2)),surpriseScore:Number(surpriseScore.toFixed(3)),excessReturnPct:reactionPct===null?null:Number(reactionPct.toFixed(2)),score:Number(score.toFixed(3)),exposure,source:e.source||"Nasdaq public earnings calendar",sourceUrl:e.sourceUrl||null};
 });
 const earningsWeight=relevant.reduce((n,e)=>n+e.exposure,0);
 const earningsScore=earningsWeight?clamp(relevant.reduce((n,e)=>n+e.score*e.exposure,0)/earningsWeight):0;
 const hasMacro=usable.length>0,hasEarnings=relevant.length>0;
 const blendWeight=(hasMacro?.72:0)+(hasEarnings?.28:0);
 const score=blendWeight?clamp((macroScore*(hasMacro?.72:0)+earningsScore*(hasEarnings?.28:0))/blendWeight):0;
 const coverage=clamp((usable.length/8)*.72+(Math.min(1,relevant.length/3)*.28),0,1);
 return {
  status:hasMacro||hasEarnings?"available":"missing",score:Number(score.toFixed(4)),coverage:Number(coverage.toFixed(3)),
  macro:{score:Number(macroScore.toFixed(4)),signalCount:usable.length,signals:usable,stale,future},
  earnings:{score:Number(earningsScore.toFixed(4)),eventCount:relevant.length,events:relevant},
  valuation:{status:"not_available",reason:"無料公開ソースから同一基準日の指数構成銘柄PER・予想EPSを検証可能な形で取得できていないため、割高・割安評価は予測に混ぜない。"},
  methodology:"FRED/OECDの公表日付き景気・物価・雇用・金利・信用指標と、Nasdaq公表決算のEPS予想差・発表後NASDAQ超過リターンを指数別感応度で統合。未来日・鮮度期限切れのマクロ値は除外。"
 };
}
