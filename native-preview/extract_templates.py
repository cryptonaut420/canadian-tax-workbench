#!/usr/bin/env python3
"""Extract exact GenuTax layout/PNG resources; does not execute shipped code.

Run with Python dnfile available. REA resource inventories in research/previews
bind every resource and input assembly to its original SHA-256.
"""
import argparse, base64, gzip, hashlib, json, sys, zlib
from pathlib import Path
from xml.etree import ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('installation', type=Path)
parser.add_argument('--dnfile-path')
args = parser.parse_args()
if args.dnfile_path:
    sys.path.insert(0, args.dnfile_path)
import dnfile

root = Path(__file__).resolve().parent
def convert(node):
    return {'tag': node.tag, 'attrs': dict(node.attrib), 'text': node.text or '',
            'children': [convert(x) for x in node]}
manifest = []
for year in range(2019, 2026):
    source = args.installation / 'en-CA' / f'GT{year}Forms.resources.dll'
    evidence = json.loads((root.parent / 'research/previews' / f'forms{year}-artifact.json').read_text())
    identity = hashlib.sha256(source.read_bytes()).hexdigest()
    assert evidence['normalized_result']['artifact']['sha256'] == identity
    pe = dnfile.dnPE(str(source))
    resources = {str(r.name): bytes(r.data) for r in pe.net.resources}
    xml = zlib.decompress(resources['GenuTax.Forms.xzp'])
    parsed = ET.fromstring(xml)
    assert parsed.attrib['Year'] == str(year)
    forms = {f.attrib['ID']: convert(f) for f in parsed.findall('Form')}
    images = {name.removeprefix('GenuTax.'): base64.b64encode(data).decode()
              for name, data in resources.items() if name.lower().endswith('.png')}
    bundle = {'year': year, 'sourceSha256': identity, 'evidenceId': evidence['evidence_id'],
              'layoutSha256': hashlib.sha256(xml).hexdigest(), 'forms': forms, 'images': images}
    output = root / f'{year}.json.gz'
    output.write_bytes(gzip.compress(json.dumps(bundle, separators=(',', ':')).encode(), mtime=0))
    row = {k: bundle[k] for k in ['year', 'sourceSha256', 'evidenceId', 'layoutSha256']}
    row.update(forms=len(forms), images=len(images), pages=sum(len(f.findall('Page')) for f in parsed),
               bundleSha256=hashlib.sha256(output.read_bytes()).hexdigest())
    manifest.append(row)
    print(year, row['forms'], 'forms', row['pages'], 'pages', output.stat().st_size, 'bytes')
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
