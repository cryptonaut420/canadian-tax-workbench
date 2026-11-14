import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCatalog, renderPreview, formatMoney } from '../server/preview.mjs';

test('all seven original template bundles load and every ordinary page renders', () => {
  let forms=0, pages=0, requiresPreparation=0;
  for(let year=2019;year<=2025;year++) {
    const catalog=previewCatalog(year);forms+=catalog.forms.length;
    assert.equal(catalog.parityVerified,false);
    for(const form of catalog.forms)for(const page of form.pages) {
      if(!page.supported) { requiresPreparation++;assert.equal(form.id,'T1KFSUM');continue; }
      const rendered=renderPreview({year,formId:form.id,page:page.page});pages++;
      assert.match(rendered.svg,/^<svg /);
      assert.equal(rendered.unresolved.length,0,`${year} ${form.id}/${page.page}`);
      assert.match(rendered.svg,/not for paper filing/);
    }
  }
  assert.equal(forms,2183);assert.equal(pages,4244);assert.equal(requiresPreparation,7);
});

test('original CPP form positions bind raw engine output, including changed string type tags', () => {
  const catalog=previewCatalog(2021,{'RESID:00002:O':'BC'},['T1GENP6:1:0','BC428FO:3:0']);
  assert.equal(catalog.selectionSource,'native-print-list');assert.deepEqual(catalog.recommended,['T1GENP6','BC428FO']);
  assert.equal(catalog.included[1].pages,3);
  const result=renderPreview({year:2021,formId:'T1GENP6',fields:{'SCH01:00308:C':'2875.95','T1GEN:00236:C':'71359.30'}});
  assert.match(result.svg,/data-field="SCH01:00308:C"/);
  assert.match(result.svg,/>2,875<\/text>/);assert.match(result.svg,/>95<\/text>/);
  assert.equal(result.warnings.length,0);
  const xss=renderPreview({year:2021,formId:'T2209MU',fields:{'FORTX:00021:T:1':'<script>alert(1)</script>'}});
  assert.ok(!xss.svg.includes('<script>'));assert.ok(xss.svg.includes('&lt;script&gt;'));
});

test('sorted repeating rows paginate and nested multiple instances stay separate', () => {
  const fields={};for(let i=1;i<=10;i++)fields[`PRINF:00002:C:${i}`]=`${100+i}.01`;
  const catalog=previewCatalog(2021,fields);assert.equal(catalog.forms.find(f=>f.id==='ABINFIR').pages.length,2);
  const first=renderPreview({year:2021,formId:'ABINFIR',page:1,fields});
  const second=renderPreview({year:2021,formId:'ABINFIR',page:2,fields});
  assert.ok(first.svg.includes('>101</text>'));assert.ok(!first.svg.includes('>110</text>'));
  assert.ok(second.svg.includes('>110</text>'));assert.ok(!second.svg.includes('>101</text>'));
  assert.throws(()=>renderPreview({year:2021,formId:'ABINFIR',page:3,fields}),/page not found/);
  const nested=renderPreview({year:2021,formId:'T2042CC',instance:2,fields:{'FRCCA:00022:C:1:99':'12345.67','FRCCA:00022:C:2:99':'76543.21'}});
  assert.ok(nested.svg.includes('>76,543</text>'));assert.ok(!nested.svg.includes('>12,345</text>'));
});

test('conditional keying summaries require native preparation and evaluate section boundaries', () => {
  assert.throws(()=>renderPreview({year:2021,formId:'T1KFSUM'}),/native condensed print preparation/);
  const fields={'T1GEN:00101:C':'60000.00','T1GEN:00150:C':'60000.00','T1GEN:00236:C':'59733.94','T1GEN:00260:C':'59733.94',
    'SCH01:00308:C':'2633.94','T1KFS:00002:T':'NONREF'};
  const printList=['T1KFSUM:2:0'];
  const first=renderPreview({year:2021,formId:'T1KFSUM',page:1,fields,printList});
  const second=renderPreview({year:2021,formId:'T1KFSUM',page:2,fields,printList});
  assert.ok(first.svg.includes('>60,000</text>'));assert.ok(!first.svg.includes('>2,633</text>'));
  assert.ok(second.svg.includes('>2,633</text>'));assert.ok(!second.svg.includes('>60,000</text>'));
  assert.equal(previewCatalog(2021,fields,printList).forms.find(f=>f.id==='T1KFSUM').pages.length,2);
});

test('display formatting preserves decimal cents without binary floating point loss', () => {
  assert.equal(formatMoney('12345678901234567890123.45').text,'12,345,678,901,234,567,890,123.45');
  assert.equal(formatMoney('-2875.95').text,'(2,875.95)');
  assert.equal(formatMoney('1.005').text,'1.01');
});
