import http from "node:http";
import crypto from "node:crypto";

const PORT=Number(process.env.PORT||10000);
const ORIGIN="https://my-investment-forecast.onrender.com";
const REPO=process.env.GITHUB_REPOSITORY||"hiromagic0001-ux/my-investment-forecast";
const WORKFLOW=process.env.GITHUB_WORKFLOW_FILE||"daily-forecast.yml";
const REF=process.env.GITHUB_REF||"main";
const API_PIN=process.env.API_PIN||"";
// Set AUTH_REQUIRED=true in Render to re-enable PIN protection without changing code.
const AUTH_REQUIRED=String(process.env.AUTH_REQUIRED||"false").toLowerCase()==="true";
const GITHUB_TOKEN=process.env.GITHUB_TOKEN||"";
const sessionSecret=crypto.createHash("sha256").update("investment-refresh-session-v1:"+GITHUB_TOKEN).digest();
const sessions=new Map();
const attempts=new Map();
let lastDispatchAt=0;
const json=(res,status,data)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
const sign=value=>crypto.createHmac("sha256",sessionSecret).update(value).digest("hex");
const tokenFor=exp=>{const payload=Buffer.from(JSON.stringify({exp})).toString("base64url");return payload+"."+sign(payload);};
function validToken(req){
 const raw=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 const [payload,signature]=raw.split(".");
 if(!payload||!signature)return false;const got=Buffer.from(signature),expected=Buffer.from(sign(payload));if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return false;
 try{return JSON.parse(Buffer.from(payload,"base64url").toString()).exp>Date.now();}catch{return false;}
}
function cors(req,res){
 const origin=req.headers.origin;
 if(origin===ORIGIN){res.setHeader("Access-Control-Allow-Origin",ORIGIN);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");}
}
async function body(req){
 let s="";for await(const chunk of req){s+=chunk;if(s.length>4096)throw new Error("Request too large");}
 return s?JSON.parse(s):{};
}
async function gh(path,method="GET",data){
 const r=await fetch("https://api.github.com"+path,{method,headers:{"Authorization":"Bearer "+GITHUB_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
 if(r.status===204)return null;
 const raw=await r.text();let parsed={};try{parsed=JSON.parse(raw)}catch{}
 if(!r.ok)throw new Error("GitHub API "+r.status+": "+(parsed.message||raw.slice(0,180)));
 return parsed;
}
async function latestRun(){
 const data=await gh("/repos/"+REPO+"/actions/workflows/"+WORKFLOW+"/runs?branch="+encodeURIComponent(REF)+"&event=workflow_dispatch&per_page=5");
 return (data.workflow_runs||[]).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null;
}
const server=http.createServer(async(req,res)=>{
 cors(req,res);
 if(req.method==="OPTIONS"){res.writeHead(204);return res.end();}
 const url=new URL(req.url,"http://localhost");
 const pathname=url.pathname.replace(/\/+$/,"")||"/";
 console.log("HTTP request",req.method,pathname);
 if(pathname==="/health"&&req.method==="GET")return json(res,200,{ok:true,authRequired:AUTH_REQUIRED,configured:Boolean(GITHUB_TOKEN&&GITHUB_TOKEN!=="CHANGE_ME"&&(!AUTH_REQUIRED||(API_PIN&&API_PIN!=="CHANGE_ME")))});
 if(pathname==="/api/login"&&req.method==="POST"){
  const origin=req.headers.origin;if(origin!==ORIGIN)return json(res,403,{error:"Origin not allowed"});
  const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0].trim();
  const now=Date.now(),a=attempts.get(ip)||{count:0,start:now};
  if(now-a.start>10*60*1000){a.count=0;a.start=now;}
  a.count++;attempts.set(ip,a);if(a.count>8)return json(res,429,{error:"試行回数が多すぎます。10分後に再試行してください。"});
  let input;try{input=await body(req)}catch{return json(res,400,{error:"Invalid request"});}
  if(!API_PIN||API_PIN==="CHANGE_ME"||!GITHUB_TOKEN||GITHUB_TOKEN==="CHANGE_ME")return json(res,503,{error:"サーバー設定が未完了です。Renderの環境変数を設定してください。"});
  const got=Buffer.from(String(input.pin||"")),expected=Buffer.from(API_PIN);
  if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return json(res,401,{error:"暗証番号が違います。"});
  attempts.delete(ip);const expires=Date.now()+30*24*60*60*1000;return json(res,200,{token:tokenFor(expires),expiresAt:expires});
 }
 if(pathname.startsWith("/api/")){
  if(req.headers.origin!==ORIGIN)return json(res,403,{error:"Origin not allowed"});
  if(AUTH_REQUIRED&&!validToken(req))return json(res,401,{error:"ログイン期限が切れました。もう一度暗証番号を入力してください（30日間有効）。"});
  if(!GITHUB_TOKEN||GITHUB_TOKEN==="CHANGE_ME")return json(res,503,{error:"GitHub連携設定が未完了です。"});
  if(pathname==="/api/refresh"&&req.method==="POST"){
   if(Date.now()-lastDispatchAt<60*1000)return json(res,429,{error:"更新開始の間隔を1分以上空けてください。"});
   try{
    const current=await gh("/repos/"+REPO+"/actions/workflows/"+WORKFLOW+"/runs?branch="+encodeURIComponent(REF)+"&per_page=10");
    const active=(current.workflow_runs||[]).find(x=>["queued","in_progress","waiting","requested"].includes(x.status));
    if(active)return json(res,409,{error:"一括更新はすでに実行中です。",runId:active.id,htmlUrl:active.html_url});
    await gh("/repos/"+REPO+"/actions/workflows/"+WORKFLOW+"/dispatches","POST",{ref:REF});
    lastDispatchAt=Date.now();
    return json(res,202,{accepted:true,message:"一括更新を開始しました。"});
   }catch(e){return json(res,502,{error:e.message});}
  }
  if(pathname==="/api/status"&&req.method==="GET"){
   try{const run=await latestRun();if(!run||Date.parse(run.created_at)<lastDispatchAt-5000)return json(res,200,{status:"not_found"});
    return json(res,200,{status:run.status,conclusion:run.conclusion,runId:run.id,htmlUrl:run.html_url,createdAt:run.created_at,updatedAt:run.updated_at});
   }catch(e){return json(res,502,{error:e.message});}
  }
  return json(res,404,{error:"Not found"});
 }
 return json(res,404,{error:"Not found"});
});
server.listen(PORT,"0.0.0.0",()=>console.log("Investment refresh API listening on "+PORT));
