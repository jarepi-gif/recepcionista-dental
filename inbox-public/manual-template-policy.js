(function(root){
 'use strict';
 const RANGES=[
  ['2026-11-12T00:00:00-06:00','2026-11-17T00:00:00-06:00'],
  ['2026-11-20T00:00:00-06:00','2026-11-23T00:00:00-06:00']
 ].map(([start,end])=>[Date.parse(start),Date.parse(end)]);
 function allowed(data){
  const c=data?.commercial||{};
  if(c.doNotContact||c.followUp?.status==='declined'||['test','supplier','duplicate'].includes(c.classification))return false;
  if(c.manualTemplateAccess?.enabled===true)return true;
  const inbound=Date.parse(data?.lastInbound);
  return RANGES.some(([start,end])=>inbound>=start&&inbound<end);
 }
 const policy={allowed};
 if(typeof module==='object'&&module.exports)module.exports=policy;
 else root.TheraManualAccess=policy;
})(typeof window==='undefined'?{}:window);
