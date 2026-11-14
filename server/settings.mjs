import {ApiError} from './model.mjs';
import {isPublicIPv4} from './live-filing.mjs';
export const validPublicIPv4=isPublicIPv4;
export class Settings{
 constructor(store){this.store=store;this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS settings_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INTEGER NOT NULL,body TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,1,?,?)').run(JSON.stringify({liveSubmissions:false,originatingIP:'',interviewDefaults:'review',originatingIPMode:'automatic'}),new Date().toISOString());}
 get(){const s=this.db.prepare('SELECT * FROM settings WHERE id=1').get();return {originatingIPMode:'automatic',...JSON.parse(s.body),revision:s.revision,updatedAt:s.updated_at};}
 update(input,actor){return this.store.transaction(()=>{
  const current=this.get();if(input.expectedRevision!==current.revision)throw new ApiError(409,'Settings changed. Refresh them before saving.');
  const allowed=new Set(['expectedRevision','liveSubmissions','originatingIP','interviewDefaults','originatingIPMode']);for(const key of Object.keys(input))if(!allowed.has(key))throw new ApiError(400,`Unknown setting: ${key}`);
  const next={originatingIPMode:input.originatingIPMode??(Object.hasOwn(input,'originatingIP')?'manual':current.originatingIPMode),liveSubmissions:input.liveSubmissions??current.liveSubmissions,originatingIP:input.originatingIP??current.originatingIP,interviewDefaults:input.interviewDefaults??current.interviewDefaults};
  if(!['automatic','manual'].includes(next.originatingIPMode))throw new ApiError(400,'Choose automatic or manual IP detection.');
  if(typeof next.liveSubmissions!=='boolean')throw new ApiError(400,'liveSubmissions must be true or false.');
  if(typeof next.originatingIP!=='string' || (next.originatingIP && !validPublicIPv4(next.originatingIP)))throw new ApiError(400,'Enter a public IPv4 address, or leave it blank.');
  if(!['review','none'].includes(next.interviewDefaults))throw new ApiError(400,'Choose review or none for interviewDefaults.');
  const timestamp=new Date().toISOString(),revision=current.revision+1;
  this.db.prepare('UPDATE settings SET revision=?,body=?,updated_at=? WHERE id=1').run(revision,JSON.stringify(next),timestamp);
  this.db.prepare('INSERT INTO settings_audit(revision,body,actor,created_at) VALUES(?,?,?,?)').run(revision,JSON.stringify(next),actor,timestamp);
  return this.get();
 });}
}
