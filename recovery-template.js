'use strict';
const NAME='thera_aura_recovery_v1';
let preparing;
async function prepare(client,body){
 if(preparing)return preparing;
 preparing=(async()=>{
  const contents=await client.content.v1.contents.list({limit:1000});
  let content=contents.find(c=>c.friendlyName===NAME&&c.types?.['twilio/text']?.body===body);
  if(!content)content=await client.content.v1.contents.create({friendly_name:NAME,language:'es_MX',types:{'twilio/text':{body}}});
  let approval;try{approval=await client.content.v1.contents(content.sid).approvalFetch().fetch();}catch(e){if(e.status!==404)throw e;}
  if(!approval?.whatsapp?.status||String(approval.whatsapp.status).toLowerCase()==='unsubmitted')await client.content.v1.contents(content.sid).approvalCreate.create({name:NAME,category:'MARKETING'});
  return content.sid;
 })();try{return await preparing;}finally{preparing=null;}
}
module.exports={prepare,NAME};
