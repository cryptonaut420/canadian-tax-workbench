import{ApiError}from'./model.mjs';
// Explicit accounting choice. Source inventory values stay in the original inputs.
export function readInventoryAccounting(fields,id){return fields[`WBINV:00001:B:${id}`]==='true'?{signedCostOfGoods:true,sourceBasis:fields[`WBINV:00002:T:${id}`]||'',sourceValuesConfirmed:fields[`WBINV:00003:B:${id}`]==='true'}:null;}
export function writeInventoryAccounting(fields,id,input){
 if(!/^[1-9]\d{0,3}$/.test(String(id)))throw new ApiError(400,'Business id must be a positive integer up to9999.');
 const next={...fields};for(const k of Object.keys(next))if(k.startsWith('WBINV:')&&k.split(':')[3]===String(id))delete next[k];
 if(input==null)return next;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['signedCostOfGoods','sourceBasis','sourceValuesConfirmed'].includes(k)))throw new ApiError(400,'Inventory accounting needs signedCostOfGoods and sourceBasis.');
 if(input.signedCostOfGoods!==true)throw new ApiError(400,'Explicitly confirm signed cost-of-goods accounting.');
 if(typeof input.sourceBasis!=='string'||!input.sourceBasis.trim()||input.sourceBasis.length>2000)throw new ApiError(400,'Describe the inventory accounting source basis (up to2000characters).');
 if(next[`BUSIN:00046:R:${id}`]!=='ACCR')throw new ApiError(400,'Signed inventory movement requires accrual accounting.');
 if(input.sourceValuesConfirmed!==undefined&&typeof input.sourceValuesConfirmed!=='boolean')throw new ApiError(400,'Inventory sourceValuesConfirmed must be a boolean.');
 next[`WBINV:00003:B:${id}`]=String(input.sourceValuesConfirmed===true);next[`WBINV:00001:B:${id}`]='true';next[`WBINV:00002:T:${id}`]=input.sourceBasis.trim();return next;
}
export function validateInventoryAccounting(fields){
 for(const code of Object.keys(fields).filter(k=>k.startsWith('WBINV:')))if(!/^WBINV:(?:0000[13]:B|00002:T):[1-9]\d{0,3}$/.test(code))throw new ApiError(400,'Unknown signed-inventory control.');
 const ids=[...new Set(Object.keys(fields).filter(k=>k.startsWith('WBINV:')).map(k=>k.split(':')[3]))];
 for(const id of ids){
  writeInventoryAccounting(fields,id,{signedCostOfGoods:fields[`WBINV:00001:B:${id}`]==='true',sourceBasis:fields[`WBINV:00002:T:${id}`]});
  if(fields[`BUSIN:00110:R:${id}`]!=='Yes')throw new ApiError(400,'Signed inventory requires the original goods-cost schedule.');
  for(const c of ['00111','00112','00113','00114','00116','00117'])if(!/^\d+(?:\.\d{1,28})?$/.test(fields[`BUSIN:${c}:C:${id}`]??'0'))throw new ApiError(400,'Inventory source amounts must be nonnegative decimal strings.');
 }
}

export function inventoryAccountingIssues(fields){return [...new Set(Object.keys(fields).filter(k=>k.startsWith('WBINV:')).map(k=>k.split(':')[3]))].filter(id=>fields[`WBINV:00003:B:${id}`]!=='true').map(id=>`Business ${id}: confirm source inventory counts, valuation method and opening/closing stock before review or filing. Signed inventory is currently a provisional source schedule.`);}
