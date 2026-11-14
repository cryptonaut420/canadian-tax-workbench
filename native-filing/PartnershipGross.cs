using System.Globalization;
using System.Xml.Linq;

// Original NETFILE serialization substitutes $1 for missing T5013 gross income.
// Box118 is required for the active-business slip workflow. Never replace a
// missing source with the original $1 placeholder. An explicit zero stays zero.
internal static class PartnershipGross
{
    internal static string Normalize(string xml,Dictionary<string,string>? fields,List<object> adjustments)
    {
        if(fields==null)return xml;
        var ids=fields.Keys.Where(k=>k.StartsWith("T5013:")&&k.Split(':').Length==4).Select(k=>k.Split(':')[3]).Distinct().ToArray();
        XDocument? doc=null;
        string Read(string number,string id)=>fields.GetValueOrDefault($"T5013:{number}:M:{id}")??fields.GetValueOrDefault($"T5013:{number}:T:{id}")??"";
        foreach(var id in ids){
            bool hasNet=false,hasGross=false;decimal net=0,gross=0,other=0,statementNet=0;
            var netCodes=new HashSet<string>{"101","103","107","116","120","122","124","126","110","236","237"};var seen=new HashSet<string>();
            for(int slot=1;slot<=12;slot++){
                var box=fields.GetValueOrDefault($"T5013:{10000+slot}:O:{id}")??fields.GetValueOrDefault($"T5013:{10000+slot}:T:{id}");
                if(box==null)continue;
                if(box!="116"&&box!="118"&&box!="114"&&!netCodes.Contains(box))continue;
                if(!seen.Add(box))throw new ArgumentException($"T5013 {id}: duplicate box{box} source slots cannot be safely filed.");
                if(!decimal.TryParse(fields.GetValueOrDefault($"T5013:{20000+slot}:C:{id}"),NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var amount))throw new ArgumentException("T5013 net/gross box requires an explicit decimal amount.");
                if(netCodes.Contains(box))statementNet+=amount;
                if(box=="116"){hasNet=true;net=amount;}else if(box=="118"){hasGross=true;gross=amount;}else if(box=="114")other=amount;
            }
            if(!hasNet)continue;
            var percent=fields.GetValueOrDefault($"T5013:00005:P:{id}")??fields.GetValueOrDefault($"T5013:00005:F:{id}");
            if(percent!=null&&(!decimal.TryParse(percent,NumberStyles.Float,CultureInfo.InvariantCulture,out var pct)||pct<0||pct>100||decimal.Truncate(pct*100m)!=pct*100m))throw new ArgumentException($"T5013 {id}: the NETFILE allocation percentage supports at most two meaningful decimal places; do not silently round it.");
            if(!hasGross)throw new ArgumentException($"T5013 {id}: box118 gross business income is required from the corrected issued slip. No filing payload was prepared.");
            decimal covid=0;
            var covidText=fields.GetValueOrDefault($"T5013:01104:C:{id}");
            if(covidText!=null&&(!decimal.TryParse(covidText,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out covid)||covid<0||covid>Math.Max(0,other)))throw new ArgumentException($"T5013 {id}: COVID assistance must be a nonnegative portion of box114.");
            if(gross!=0&&covid==0)continue;
            doc??=XDocument.Parse(xml,LoadOptions.PreserveWhitespace);
            var bn=Read("00001",id);var end=fields.GetValueOrDefault($"T5013:01004:D:{id}")??"";
            string Value(XElement e,string name)=>e.Elements().FirstOrDefault(x=>x.Name.LocalName==name)?.Value??"";
            var candidates=doc.Descendants().Where(e=>e.Name.LocalName=="BusinessActivityData"&&Value(e,"PartnershipNumber")==bn&&Value(e,"FiscalPeriodEndDate")==end).ToArray();
            if(candidates.Length==0&&net==0&&covid==0)continue; // Original engine need not emit an all-zero slip statement.
            if(bn.Length!=9||candidates.Length!=1)throw new InvalidOperationException("Cannot uniquely match the T5013 statement for gross-income source preservation. No filing payload is safe to transmit.");
            var lines=candidates[0].Elements().Where(e=>e.Name.LocalName=="ReturnLine"&&Value(e,"FieldCode")=="8299").ToArray();
            if(lines.Length>1)throw new InvalidOperationException("Duplicate T5013 gross-income lines in the original request.");
            if(gross==0){
                foreach(var line in lines)line.Elements().Single(e=>e.Name.LocalName=="FieldValue").Value="0";
                adjustments.Add(new{slipId=id,partnershipNumber=bn,grossIncomeProvided=true,action="Preserved explicit box118 zero",originalPlaceholderRemoved=lines.Length>0});
            }
            if(covid!=0){
                var netLines=candidates[0].Elements().Where(e=>e.Name.LocalName=="ReturnLine"&&Value(e,"FieldCode")=="9946").ToArray();
                if(netLines.Length!=1||!decimal.TryParse(Value(netLines[0],"FieldValue"),NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var serializedNet)||serializedNet!=decimal.Truncate(statementNet))throw new InvalidOperationException("Cannot uniquely reconcile original T5013 net income with COVID assistance. No filing payload is safe to transmit.");
                netLines[0].Elements().Single(e=>e.Name.LocalName=="FieldValue").Value=decimal.Truncate(statementNet+covid).ToString("0",CultureInfo.InvariantCulture);
                adjustments.Add(new{slipId=id,partnershipNumber=bn,action="Included box114 COVID assistance in business net income9946",box116=net,covidAssistance=covid,netBusinessIncome=statementNet+covid,wireAmount=decimal.Truncate(statementNet+covid)});
            }
        }
        return doc==null?xml:(doc.Declaration?.ToString()??"<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>")+"\n"+doc.ToString(SaveOptions.DisableFormatting);
    }
}
