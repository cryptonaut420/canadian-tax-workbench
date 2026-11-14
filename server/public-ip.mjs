import https from 'node:https';
import {isPublicIPv4} from './live-filing.mjs';
import {ApiError} from './model.mjs';

// Fixed HTTPS destinations only. No taxpayer data, cookies or API credentials.
// IPv4 matches the address family used by the filing transport below.
export const IP_PROVIDERS=['https://icanhazip.com/','https://api.ipify.org/'];
export async function detectPublicIPv4({request=https.request,timeout=6000}={}){
 for(const provider of IP_PROVIDERS){
  try{
   const address=await new Promise((resolve,reject)=>{
    let req,timer,done=false,size=0;const chunks=[];
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    timer=setTimeout(()=>{finish(Error('IP lookup timed out'));req?.destroy();},timeout);
    try{
     req=request(provider,{method:'GET',family:4,headers:{Accept:'text/plain','User-Agent':'TaxWorkbench'}},res=>{
      if(res.statusCode!==200){finish(Error('IP lookup failed'));res.destroy();return;}
      res.on('data',chunk=>{size+=chunk.length;if(size>128){finish(Error('IP response too large'));res.destroy();req.destroy();return;}chunks.push(Buffer.from(chunk));});
      res.on('aborted',()=>finish(Error('IP response interrupted')));
      res.on('error',error=>finish(error));
      res.on('end',()=>{const value=Buffer.concat(chunks).toString('utf8').trim();isPublicIPv4(value)?finish(null,value):finish(Error('Invalid public IPv4'));});
     });
     req.on('error',error=>finish(error));req.end();
    }catch(error){finish(error);}
   });
   return {originatingIP:address,detectedAt:new Date().toISOString(),provider};
  }catch{}
 }
 throw new ApiError(502,'Could not detect this computer’s public IPv4. Check the connection or choose manual IP in Settings. No return was sent.');
}
