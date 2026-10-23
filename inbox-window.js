'use strict';
const WINDOW=24*60*60*1000;
function isOpen(value,now=Date.now()) {const date=Date.parse(value);return Number.isFinite(date)&&date<=now&&now-date<WINDOW;}
async function reconcile(store,phone,messages,now=Date.now()){
 const latest=messages.filter(m=>m.from===phone&&m.status==='received').map(m=>({message:m,date:Date.parse(m.dateSent||m.dateCreated)})).filter(x=>Number.isFinite(x.date)&&x.date<=now).sort((a,b)=>b.date-a.date)[0];
 if(!latest)return (await store.ensure(phone)).data;
 const current=(await store.ensure(phone)).data;
 // Provider timestamps are authoritative for the same message; never overwrite a newer inbound webhook.
 if(current.lastInboundSid!==latest.message.sid&&Date.parse(current.lastInbound)>=latest.date)return current;
 if(current.lastInboundSid===latest.message.sid&&Date.parse(current.lastInbound)===latest.date)return current;
 return store.mutate(phone,data=>{
  if(data.lastInboundSid!==latest.message.sid&&Date.parse(data.lastInbound)>=latest.date)return data;
  return {...data,lastInbound:new Date(latest.date).toISOString(),lastInboundSid:latest.message.sid};
 });
}
module.exports={isOpen,reconcile};
