#!/usr/bin/env python3
"""Independently decode synthetic native PDF417 output, never real taxpayer data."""
import json,sys
from PIL import Image,ImageDraw
import zxingcpp
request=json.load(sys.stdin)
outputs=[]
for barcode in request['barcodes']:
    pad=10
    im=Image.new('L',(int(barcode['width'])+2*pad,int(barcode['height'])+2*pad),255)
    draw=ImageDraw.Draw(im)
    for bar in barcode['bars']:
        if bar['color']!=-16777216:continue
        x=int(bar['x1'])+pad;y=int(min(bar['y1'],bar['y2']))+pad
        w=int(bar['width']);h=int(abs(bar['y2']-bar['y1']))
        if w>0 and h>0:draw.rectangle((x,y,x+w-1,y+h-1),fill=0)
    im=im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST)
    decoded=zxingcpp.read_barcode(im)
    if decoded is None or not decoded.valid or decoded.format!=zxingcpp.BarcodeFormat.PDF417:
        raise ValueError('Native PDF417 output did not independently decode.')
    outputs.append({'bytesHex':decoded.bytes.hex(),'format':str(decoded.format),'extra':decoded.extra})
print(json.dumps({'decoded':outputs}))
