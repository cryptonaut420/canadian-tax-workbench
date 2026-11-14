# Third-party notices

Tax Workbench Canada is a mixed-license distribution. The MIT license applies
to its original application and adapters, not to upstream components bundled
with it. Inclusion here is not a grant of an upstream sublicense or a statement
that the upstream software is open source.

## GenuTax Standard — GenuSource Consulting Inc.

Upstream: https://www.genutax.ca/

The yearly calculation assemblies in `engines/`, the derived offline-only
assemblies in `native-filing/offline-engines/`, and the original resources
represented in `native-interview/*.json.gz` and `native-preview/*.json.gz`
originate from GenuTax Standard. GenuSource retains its copyrights and applicable
license terms. The supplied agreement is preserved at
`third_party/genutax/EULA.rtf`; this project's MIT license does not override it.

The calculation assemblies have their CLR architecture flag adjusted for native
.NET loading. The separate offline serializer assemblies additionally replace
the original IP lookup helper. Manifests record identities and changes. The
original calculation instructions otherwise remain unchanged. Workbench source
extensions and explicit XML corrections are separate from these assemblies.

Field-code inventories, recovered mappings and catalogs identify the original
interfaces. They do not imply endorsement, ownership of upstream content, or
transfer of CRA certification to this project.

## J4L RBarcode PDF417

`native-barcode/original/pdf417_20.dll` is the upstream PDF417 component supplied
with the original application. Its upstream rights are retained. The Workbench
translation/rendering host is separate original source; its MIT license does not
relicense the bundled DLL, original encoder instructions or lookup tables.

## Other dependencies

Electron (MIT), Node.js (MIT and bundled third-party notices), .NET (MIT and
applicable component notices), and SQLite (public domain) retain their own terms.
They are installed separately or supplied by the user's runtime. Refer to their
own distributions for complete notices. No Electron runtime or `node_modules/`
installation is committed here.
