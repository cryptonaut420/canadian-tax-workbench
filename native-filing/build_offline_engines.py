#!/usr/bin/env python3
"""Build an explicitly changed, offline-only serializer copy.
No network helper executes. Never replace the calculation engine originals.
"""
import hashlib,json,struct,sys
from pathlib import Path
sys.path.insert(0,'/tmp/genutax-check/lib')
import dnfile
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'native-filing/offline-engines';OUT.mkdir(exist_ok=True)
manifest=[]
for identity in json.loads((ROOT/'engines/manifest.json').read_text()):
 year=identity['year'];src=ROOT/'engines'/identity['file'];data=bytearray(src.read_bytes());sha=hashlib.sha256(data).hexdigest()
 if sha!=identity['sha256']:raise RuntimeError('Source hash mismatch')
 evidence=Path('/tmp/genutax-rea-analysis')/f'calculations{year}{"-expanded" if year==2025 else ""}.json'
 record=json.loads(evidence.read_text());x=record['normalized_result'];strings={s['token']:s['value'] for s in x['user_strings']['literals']}
 candidates=[m for m in x['methods'] if any(strings.get(a.get('operand'))=='https://icanhazip.com/' for a in m.get('body',{}).get('anchors',[]))]
 if len(candidates)!=1:raise RuntimeError(f'{year}: expected one IP helper, found {len(candidates)}')
 method=candidates[0];zero=next(s['token'] for s in x['user_strings']['literals'] if s['value']=='0.0.0.0')
 pe=dnfile.dnPE(data=bytes(data));row=int(method['token'],16)&0xffffff;m=pe.net.mdtables.MethodDef.rows[row-1];offset=pe.get_offset_from_rva(m.Rva)
 # Tiny CIL body: ldstr existing literal '0.0.0.0'; ret. The old body is
 # unreachable padding; method metadata and all other bodies are unchanged.
 replacement=bytes([0x1a,0x72])+struct.pack('<I',int(zero,16))+bytes([0x2a])
 before=bytes(data[offset:offset+len(replacement)]);data[offset:offset+len(replacement)]=replacement
 dest=OUT/identity['file'];dest.write_bytes(data)
 manifest.append({'year':year,'file':identity['file'],'sha256':hashlib.sha256(data).hexdigest(),'sourceSha256':sha,'offlineOnly':True,'originatingIP':'0.0.0.0','changedMethod':method['token'],'changedType':method['declaring_type'],'changedOffset':offset,'previousBytes':before.hex(),'replacementBytes':replacement.hex(),'sourceEvidenceId':record['evidence_id'],'mathematicalInstructionsChanged':False})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Built seven separate offline-only serializer modules. No network request made.')
