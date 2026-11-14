const identity=code=>{const p=code.split(':');return [p[0],p[1],...p.slice(3)].join(':');};
function amount(value){let s=String(value);if(!/^-?\d+(?:\.\d+)?$/.test(s))return Number.isFinite(Number(s))?String(Number(s)):s;let [whole,fraction='']=s.split('.');const sign=whole.startsWith('-')?'-':'';whole=whole.replace('-','').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');s=sign+whole+(fraction?'.'+fraction:'');return /^-?0$/.test(s)?'0':s;}
function financial(fields){return new Map(Object.entries(fields || {}).filter(([k])=>['C','F','P'].includes(k.split(':')[2])&&!/^(REFCH|REFIL|METAD):/.test(k)).map(([k,v])=>[identity(k),{code:k,value:amount(v)}]));}
export function financialDifferences(reviewed,prepared,{optional=false}={}){
 // A missing adapter property is not evidence of calculation parity. Only an
 // explicitly optional, absent pair (no spouse) may omit both snapshots.
 if(optional&&reviewed==null&&prepared==null)return [];
 const valid=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 if(!valid(reviewed)||!valid(prepared))return [{field:'[calculation snapshot]',reviewed:valid(reviewed)?'available':'missing or invalid',prepared:valid(prepared)?'available':'missing or invalid',reason:'Both complete calculation field maps are required to verify financial agreement.'}];
 const a=financial(reviewed),b=financial(prepared);
 return [...new Set([...a.keys(),...b.keys()])].filter(k=>a.get(k)?.value!==b.get(k)?.value).map(k=>({field:a.get(k)?.code || b.get(k)?.code,reviewed:a.get(k)?.value ?? null,prepared:b.get(k)?.value ?? null}));
}
