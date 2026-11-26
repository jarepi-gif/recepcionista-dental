'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage(),installed=new WeakMap();
function runProcess(name,fn){return context.run(name,fn);}
const routes=new Map([['/whatsapp','aura.inbound'],['/api/inbox/conversations','inbox.list'],['/api/inbox/messages','inbox.messages'],['/api/inbox/send','inbox.send'],['/api/inbox/mode','inbox.mode']]);
function middleware(req,res,next){
 const path=req.path||'';
 return runProcess(routes.get(path)||(path.startsWith('/api/inbox/recovery')?'recovery.api':path.startsWith('/api/inbox/')?'inbox.other':'background.other'),next);
}
// Never retain URLs, document identifiers, credentials or message contents.
function operation(opts){
 try{
  const url=new URL(opts.uri);if(!/^sync(?:\.[a-z0-9-]+)?\.twilio\.com$/.test(url.hostname))return null;
  const resource=url.pathname.includes('/Documents')?'documents':'other',method=String(opts.method||'GET').toUpperCase(),collection=url.pathname.endsWith('/Documents');
  return resource+'.'+(method==='GET'?(collection?'list':'fetch'):method==='POST'?(collection?'create':'update'):method==='DELETE'?'delete':'other');
 }catch{return null;}
}
function installUsage(client,{sink=line=>console.log(line),intervalMs=60000}={}){
 if(installed.has(client))return installed.get(client);
 const original=client.request,buckets=new Map();let started=new Date().toISOString();
 function record(process,op,error,durationMs){
  const key=process+'|'+op,row=buckets.get(key)||{process,operation:op,sdkRequests:0,errors:0,durationMs:0};
  row.sdkRequests++;if(error)row.errors++;row.durationMs+=durationMs;buckets.set(key,row);
 }
 function flush(){
  if(!buckets.size)return;const ended=new Date().toISOString();
  try{sink('AURA_SYNC_USAGE '+JSON.stringify({version:1,windowStart:started,windowEnd:ended,rows:[...buckets.values()]}));buckets.clear();started=ended;}catch{/* Retry next interval; telemetry cannot interrupt service. */}
 }
 if(typeof original==='function')client.request=function(opts){
  const op=operation(opts);if(!op)return original.apply(this,arguments);
  const name=context.getStore()||'background.other',begin=performance.now();
  const done=error=>{try{record(name,op,error,Math.round(performance.now()-begin));}catch{}};
  let result;try{result=original.apply(this,arguments);}catch(error){done(true);throw error;}
  return Promise.resolve(result).then(value=>{done(Number(value?.statusCode)>=400);return value;},error=>{done(true);throw error;});
 };
 const timer=setInterval(flush,intervalMs);timer.unref();
 const shutdown=()=>flush();process.once('SIGTERM',shutdown);
 const usage={flush,stop(){clearInterval(timer);flush();process.removeListener('SIGTERM',shutdown);client.request=original;installed.delete(client);}};
 installed.set(client,usage);return usage;
}
module.exports={installUsage,runProcess,middleware};
