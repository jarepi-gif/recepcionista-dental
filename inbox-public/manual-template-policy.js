(function(root){
 'use strict';
 const START=Date.parse('2026-11-14T00:00:00-06:00');
 const END=Date.parse('2026-11-15T00:00:00-06:00');
 function allowed(data){
  const c=data?.commercial||{};
  if(c.doNotContact||c.followUp?.status==='declined'||['test','supplier','duplicate'].includes(c.classification))return false;
  if(c.manualTemplateAccess?.enabled===true)return true;
  const inbound=Date.parse(data?.lastInbound);
  return inbound>=START&&inbound<END;
 }
 const policy={allowed};
 if(typeof module==='object'&&module.exports)module.exports=policy;
 else root.TheraManualAccess=policy;
})(typeof window==='undefined'?{}:window);
