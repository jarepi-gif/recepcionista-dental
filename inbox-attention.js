'use strict';
const canonical=value=>String(value||'').replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52');
const sentStatuses=new Set(['sent','delivered','read']);
function flags(data,outbound,coverage=true){
 const incoming=Date.parse(data.lastInbound),reviewed=Date.parse(data.lastReviewedInbound);
 const unread=Number.isFinite(incoming)&&(!Number.isFinite(reviewed)||incoming>reviewed);
 const needsHuman=['pending'].includes(data.commercial?.handoff?.status);
 const replied=Date.parse(outbound?.time)>=incoming;
 const pending=Number.isFinite(incoming)&&(needsHuman||(!replied&&coverage));
 return {unread,pending,unknown:Number.isFinite(incoming)&&!replied&&!coverage&&!needsHuman};
}
function createAttention({client,store,from}){
 let outgoing=new Map(),loaded=false,oldest=null,refreshing=null,lastLoad=0;
 async function sync(){
  if(refreshing)return refreshing;
  if(loaded&&Date.now()-lastLoad<30000)return;
  refreshing=(async()=>{
   const messages=await client.messages.list({from,limit:10000,...(loaded?{dateSentAfter:new Date(lastLoad-120000)}:{})});
   const next=loaded?new Map(outgoing):new Map();let min=Infinity;
   for(const m of messages){const key=canonical(m.to);if(outgoing.get(key)?.sid===m.sid&&!sentStatuses.has(m.status))next.delete(key);}
   for(const m of messages){const time=+(m.dateSent||m.dateCreated);min=Math.min(min,time);if(!sentStatuses.has(m.status))continue;const key=canonical(m.to);if(!next.has(key)||time>Date.parse(next.get(key).time))next.set(key,{sid:m.sid,time:new Date(time).toISOString()});}
   outgoing=next;if(!loaded)oldest=messages.length===10000?min:null;loaded=true;lastLoad=Date.now();
  })();try{await refreshing;}finally{refreshing=null;}
 }
 async function list(){
  try{await sync();}catch(e){console.error('Inbox attention:',e.code||e.status||'unavailable');}
  return (await store.list()).map(data=>({...data,attention:flags(data,outgoing.get(canonical(data.phone)),loaded&&(oldest===null||Date.parse(data.lastInbound)>=oldest))}));
 }
 async function review(phone,snapshot){
  const date=Date.parse(snapshot);if(!Number.isFinite(date)||date>Date.now())throw new Error('Fecha de lectura inválida.');
  return store.mutate(phone,data=>{
   if(!Number.isFinite(Date.parse(data.lastInbound))||date>Date.parse(data.lastInbound))throw new Error('La conversación cambió; actualiza antes de marcarla como leída.');
   return {...data,lastReviewedInbound:new Date(Math.max(date,Date.parse(data.lastReviewedInbound)||0)).toISOString()};
  });
 }
 return {list,review,invalidate(){lastLoad=0;}};
}
module.exports={createAttention,flags};
