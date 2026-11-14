#!/usr/bin/env python3
"""Preserve original interview definitions without executing target code."""
import argparse,gzip,hashlib,json,sys,zlib
from pathlib import Path
from xml.etree import ElementTree as E
p=argparse.ArgumentParser();p.add_argument('installation',type=Path);p.add_argument('--dnfile-path');p.add_argument('--evidence-dir',type=Path,default=Path('/tmp'));a=p.parse_args()
if a.dnfile_path:sys.path.insert(0,a.dnfile_path)
import dnfile
root=Path(__file__).resolve().parent
text=lambda n:''.join(n.itertext()).strip() if n is not None else ''
def node(n):return {'tag':n.tag,'attrs':dict(n.attrib),'text':n.text or '', 'children':[node(c) for c in n]}
manifest=[]
for year in range(2019,2026):
 source=a.installation/'en-CA'/f'GT{year}Interview.resources.dll';sha=hashlib.sha256(source.read_bytes()).hexdigest()
 evidence=json.loads((a.evidence_dir/f'genutax-interview{year}-artifact.json').read_text());assert evidence['normalized_result']['artifact']['sha256']==sha
 pe=dnfile.dnPE(str(source));resources={str(r.name):bytes(r.data) for r in pe.net.resources}
 candidates=[(k,v) for k,v in resources.items() if k.endswith('.xzp')];assert len(candidates)==1
 xml=zlib.decompress(candidates[0][1]);tree=E.fromstring(xml);assert tree.attrib['Year']==str(year)
 logical=[{'section':n.attrib['Section'],'topic':n.attrib['Topic'],'title':text(n),'condition':n.attrib.get('Condition')} for n in tree.findall('./Indexes/Logical/Entry')]
 labels={n['section']:n['title'] for n in logical};sections=[]
 for sec in tree.findall('./Body/Section'):
  sid=sec.attrib['ID'];topics=[]
  for t in sec.findall('Topic'):
   fields=[]
   for row in t.findall('./DataEntry/Row'):
    rowlabels=[text(l) for l in row.iter('Label')]
    for f in row.findall('Field'):
     code=f.attrib.get('ID','null')
     if code=='null':continue
     ownlabels=[text(l) for l in f.iter('Label')]+[text(l) for l in f.iter('BoxText')]
     selections=[{'value':s.attrib.get('Tag',text(s)),'label':text(s),'attrs':dict(s.attrib)} for s in f.findall('Selection')]
     fields.append({'code':code,'kind':code.split(':')[2] if ':'in code else 'unknown','label':' '.join(ownlabels or rowlabels) or text(t.find('Title')),'attrs':dict(f.attrib),'options':selections,'loopDepth':int(t.attrib.get('LoopDepth','0')),'definition':node(f)})
   topics.append({'id':t.attrib['ID'],'section':sid,'title':text(t.find('Title')),'paragraphs':[text(n) for n in t.findall('Paragraph')], 'attrs':dict(t.attrib),'fields':fields,'branches':[{'attrs':dict(c.attrib),'target':text(c)} for c in t.findall('./Branch/Condition')],'actions':[{'attrs':dict(c.attrib),'label':text(c)} for c in t.findall('CmdButton')],'customValidations':[node(c) for c in t.iter('Validation')],'definition':node(t)})
  sections.append({'id':sid,'title':labels.get(sid,topics[0]['title'] if topics else sid),'topics':topics})
 bundle={'year':year,'sourceSha256':sha,'evidenceId':evidence['evidence_id'],'xmlSha256':hashlib.sha256(xml).hexdigest(),'logicalIndex':logical,'sections':sections}
 out=root/f'{year}.json.gz';out.write_bytes(gzip.compress(json.dumps(bundle,separators=(',',':')).encode(),mtime=0))
 row={k:bundle[k] for k in ['year','sourceSha256','evidenceId','xmlSha256']};row.update(sections=len(sections),topics=sum(len(s['topics']) for s in sections),fields=sum(len(t['fields']) for s in sections for t in s['topics']),bundleSha256=hashlib.sha256(out.read_bytes()).hexdigest());manifest.append(row)
 (root.parent/'research/interviews'/f'interview{year}-artifact.json').write_text(json.dumps(evidence,separators=(',',':')))
 print(year,row['topics'],'topics',out.stat().st_size,'bytes')
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
