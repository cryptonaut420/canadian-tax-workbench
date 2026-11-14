using System.Globalization;
using System.Text.RegularExpressions;

// Source-backed Workbench extension for costs ALREADY apportioned to business
// use. Original 2021 REA IL_02133f–021441 supplies the unchanged income cap,
// carryforward and net-income arithmetic. Never creates fake areas/home costs.
internal sealed class PreapportionedHomeOffice
{
    internal static bool IsMetadata(string code)=>code.StartsWith("WBHOM:",StringComparison.Ordinal);
    private sealed record Claim(string Id,decimal Current,decimal Prior,bool Confirmed,string Source,string Basis,string Scope,BusinessDataTable Table);
    private readonly List<Claim> claims=new();
    internal static PreapportionedHomeOffice Install(object data,Dictionary<string,string>? fields,string scope="primary")
    {
        var adapter=new PreapportionedHomeOffice();fields??=new();
        var keys=fields.Keys.Where(IsMetadata).ToArray();
        foreach(var key in keys)if(!Regex.IsMatch(key,@"^WBHOM:(?:0000[12]:C|00003:B|0000[45]:T):[1-9]\d{0,3}$"))throw new ArgumentException("Unknown Workbench pre-apportioned home-office control.");
        foreach(var id in keys.Select(k=>k.Split(':')[3]).Distinct()){
            decimal Amount(string number){var raw=fields.GetValueOrDefault($"WBHOM:{number}:C:{id}");if(raw==null||!Regex.IsMatch(raw,@"^\d+(?:\.\d{1,2})?$")||!decimal.TryParse(raw,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var value)||value<0||value>9999999999999.99m)throw new ArgumentException("Pre-apportioned home-office amounts require explicit nonnegative decimal strings with at most two places.");return value;}
            string Text(string number){var value=fields.GetValueOrDefault($"WBHOM:{number}:T:{id}");if(string.IsNullOrWhiteSpace(value)||value.Length>2000)throw new ArgumentException("Home-office source reference and business-use basis are required.");return value;}
            var confirmed=fields.GetValueOrDefault($"WBHOM:00003:B:{id}");if(confirmed is not ("true" or "false"))throw new ArgumentException("Explicitly set home-office eligibilityConfirmed.");
            if(string.IsNullOrWhiteSpace(fields.GetValueOrDefault($"BUSIN:00021:T:{id}")))throw new ArgumentException("A pre-apportioned home-office claim requires a named business.");
            if(fields.GetValueOrDefault($"BUSIN:00401:R:{id}")=="Yes"||fields.Any(p=>Regex.IsMatch(p.Key,@"^BUSIN:004(?:02|0[5-9]|1[01]):C:"+Regex.Escape(id)+"$")&&decimal.TryParse(p.Value,NumberStyles.Number,CultureInfo.InvariantCulture,out var value)&&value!=0))throw new ArgumentException("Whole-home costs and pre-apportioned home-office claims are mutually exclusive.");
            var claim=new Claim(id,Amount("00001"),Amount("00002"),confirmed=="true",Text("00004"),Text("00005"),scope,BusinessDataTable.For(data,id));adapter.claims.Add(claim);
            claim.Table.Transforms.Add((key,value,table)=>{
                decimal available=claim.Current+claim.Prior,cap=Math.Max(0m,table.Amount("00706"));
                return key switch{"00423"=>claim.Current,"00425"=>available,"00426"=>cap,"00427"=>Math.Max(0m,available-cap),"09945"=>Math.Min(available,cap),_=>value};
            });
        }
        return adapter;
    }
    // The original carryforward only copies 00427 when original whole-home
    // eligibility is Yes. Our explicit prepared-cost path deliberately leaves
    // that gate off, so transfer the real computed unused amount separately.
    internal static object[] CarryForward(Dictionary<string,string>? sourceInputs,Dictionary<string,string> sourceCalculated,Dictionary<string,string> target,string scope)
    {
        var reports=new List<object>();sourceInputs??=new();
        var targetIds=target.Keys.Where(k=>Regex.IsMatch(k,@"^BUSIN:00021:[A-Z]:[1-9]\d{0,3}$")).Select(k=>k.Split(':')[3]).Distinct().ToArray();
        string Get(Dictionary<string,string> fields,string group,string number,string id)=>fields.FirstOrDefault(p=>p.Key.StartsWith(group+":"+number+":",StringComparison.Ordinal)&&p.Key.Split(':').Length==4&&p.Key.Split(':')[3]==id).Value??"";
        foreach(var sourceId in sourceInputs.Keys.Where(IsMetadata).Select(k=>k.Split(':')[3]).Distinct()){
            if(sourceInputs.GetValueOrDefault($"BUSIN:00031:R:{sourceId}")=="Yes")continue;
            var unusedRaw=sourceCalculated.GetValueOrDefault($"BUSIN:00427:C:{sourceId}")??"0";
            decimal unused=decimal.Parse(unusedRaw,NumberStyles.Number,CultureInfo.InvariantCulture);
            if(unused<=0)continue;
            string name=Get(sourceInputs,"BUSIN","00021",sourceId);
            var matches=targetIds.Where(id=>Get(target,"BUSIN","00021",id)==name&&Get(target,"BUSIN","00038",id)==Get(sourceInputs,"BUSIN","00038",sourceId)&&Get(target,"BUSIN","00032",id)==Get(sourceInputs,"BUSIN","00032",sourceId)).ToArray();
            if(matches.Length!=1)throw new ArgumentException("Cannot uniquely carry unused home-office expenses for business "+sourceId+". Verify that the original final-year answer is No and the continuing business is uniquely identified; no carryforward was saved.");
            string targetId=matches[0];
            foreach(var key in target.Keys.Where(k=>k.Split(':').Length==4&&k.Split(':')[3]==targetId&&(IsMetadata(k)||Regex.IsMatch(k,@"^BUSIN:004(?:01|02|03|04|0[5-9]|1[013]):"))).ToArray())target.Remove(key);
            target[$"WBHOM:00001:C:{targetId}"]="0.00";
            target[$"WBHOM:00002:C:{targetId}"]=unused.ToString("0.00",CultureInfo.InvariantCulture);
            target[$"WBHOM:00003:B:{targetId}"]="false";
            target[$"WBHOM:00004:T:{targetId}"]="Previous calculated business-use-of-home closing unused expenses for "+name+" (business "+sourceId+").";
            target[$"WBHOM:00005:T:{targetId}"]="Only prior unused business-use expenses carried. Current-year expenses and continuing eligibility require review; no whole-home expense or area ratio is assumed.";
            reports.Add(new{scope,sourceBusinessId=sourceId,targetBusinessId=targetId,priorUnusedExpenses=unused,currentExpenses=0m,eligibilityConfirmed=false});
        }
        return reports.ToArray();
    }
    internal object[] Report()=>claims.Select(c=>(object)new{businessId=c.Id,scope=c.Scope,currentExpenses=c.Current,priorUnusedExpenses=c.Prior,eligibilityConfirmed=c.Confirmed,sourceReference=c.Source,basis=c.Basis,incomeBeforeHomeOffice=c.Table.Amount("00706"),deduction=c.Table.Amount("09945"),unusedExpenses=c.Table.Amount("00427"),extension="Pre-apportioned business-use costs; original income cap and unused-expense carryforward; no whole-home cost or area ratio asserted."}).ToArray();
}
