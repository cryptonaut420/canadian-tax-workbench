# Original managed PDF417 encoder on Linux

This component executes the original `J4L.RBarcode.RPDF417` encoding instructions
and lookup tables from GenuTax's bundled `pdf417_20.dll`. It does not substitute
another PDF417 encoder, use Wine, instantiate Windows Forms, or call GDI.

The unchanged source DLL is hash-pinned before any dynamic code is emitted:
`dba352f2ea4c91a6afb267903f2eb0b71379155fcfc4fdf3871027ebd6c7ce9e`.

`Translator` uses .NET's PEReader/MetadataReader and Reflection.Emit to re-emit the
original class's 65 relevant methods and 50 fields. Source method/field/type tokens
are resolved to the corresponding emitted members. Branch targets and exception
filters retain their control flow; short branches are promoted to long branches
for relocation. The unrelated OnPaint and saveToFile methods are excluded.

The UI/drawing boundary is replaced:

- Windows Forms base constructor and Size property → a local minimal ControlStub.
- Graphics.Clear → clear a local line recorder.
- Graphics.DrawLine and Pen → record original line coordinates, width and color.

The original ProjectData.SetProjectError call is also observed by a diagnostic
wrapper that delegates to the original VB helper. Unexpected errors reject partial
barcodes; expected null-Graphics exceptions during the source macro precomputation
are retained as intended. The source bytes are hash-checked once and read from that
same immutable memory snapshot, preventing a changed file from being executed
after validation.

The original byte/text/numeric compaction, error correction, macro segmentation,
start/stop patterns and codeword pattern tables remain original managed logic.
System.Drawing.Color/PointF/Size come from cross-platform Drawing.Primitives.
Microsoft.VisualBasic.Core supplies the original VB helpers. The host registers
CodePagesEncodingProvider, because the original VB Asc operation requires the
English-Canada ANSI1252 code page. Without it, non-ASCII exceptions could be
swallowed by the original VB On Error Resume Next path and corrupt a barcode.

No source DLL is loaded as a UI type. No printer or network connection is opened.
The standalone encoder takes synthetic/raw payload text; the application must
supply `BarcodeData(true)` from the original calculation engine for real previews.

## Original renderer parameters

Evidence in research/previews/renderer.cil.txt (GenuTax.a, method0x06000178):

- Binary compaction mode0, error correction level4, auto rows0.
- DataColumns, DataRows and MaxCodes from the original yearly BarCode element.
- Zero margins; bar width Math.Round(DpiX/100,0), height three widths, adjusted
  downward when the original SFD row count is increased above50.
- Macro file IDs from executable field-RVA arrays: ordinary `[1,1,3,0]`, SFD
  header `[1,1,3,1]`, SFD detail `[1,1,3,2]`.
- Macro threshold initially truncates float32(columns*rows*1.13). SFD can increase
  its row budget from50 to60 using the source's threshold table before splitting.
- BarcodeData is split on CR: ordinary payload, optional SFD header and detail.
- Subsequent codes sit to the left, with a0.5-inch gap, vertically centered.

The review adapter uses a300-DPI reference and the original template's200 units
per inch. It never stretches barcode modules to fill an arbitrary rectangle.
Unsupported payload sizes or geometry fail explicitly.

## Independent verification

`tests/barcode.test.mjs` exercises original encoding, deterministic output,
Latin1 text and two-part macro data. When installed, Pillow + zxingcpp independently
rasterize/decode the resulting modules through `verify_decode.py`:

- ASCII bytes round trip exactly.
- `André éà£ÿ` round trips as original Latin1/ANSI bytes.
- A1200-byte macro fixture decodes as786+414 bytes; concatenation is identical.
- Macro file identifier decodes as `001001003000`, matching the original ID.

Pillow/zxingcpp are optional verification tools, not application requirements.
The source DLL, native .NET10 and the BCL are sufficient to generate previews.

## Limits

These checks establish encoding and representative decoded-data equivalence using
the original algorithm. They do not establish pixel-for-pixel Windows GDI output,
all possible payload/segmentation combinations, printer calibration, CRA paper
acceptance, or complete-return correctness. The preview remains a review copy.
