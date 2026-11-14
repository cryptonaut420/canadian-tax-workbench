using System.Globalization;
using System.Text.RegularExpressions;

// Explicit narrow Workbench rule update, not GenuTax parity. Regulations
// 1100(2), A(c.3)(i): class50 AIIP acquired+AFU after2024-04-15 before2027
// receives adjustment9/11: (cost+cost*9/11)*55%=cost. The2024 engine lacks
// this factor; retain its original class calculation, limits and closing UCC.
internal sealed class EnhancedCca2024
{
    internal static bool IsMetadata(string code)=>code.StartsWith("WBCCA:",StringComparison.Ordinal);
    private sealed record Asset(string BusinessId,string ClassId,string AssetId,decimal Cost,bool Confirmed,string Acquired,string Available,string Source,string Basis,string Scope,BusinessDataTable Table);
    private readonly List<Asset> assets=new();
    internal static EnhancedCca2024 Install(object data,Dictionary<string,string>? fields,int year,string scope="primary")
    {
        var adapter=new EnhancedCca2024();fields??=new();
        var keys=fields.Keys.Where(IsMetadata).ToArray();
        foreach(var key in keys)if(!Regex.IsMatch(key,@"^WBCCA:(?:00001:B|0000[23]:D|0000[45]:T):[1-9]\d{0,3}:[1-9]\d{0,3}:[1-9]\d{0,3}$"))throw new ArgumentException("Unknown enhanced2024 CCA eligibility control.");
        if(keys.Length>0&&year!=2024)throw new ArgumentException("The enhanced class50 adapter is restricted to2024;2025 already includes the original rule.");
        foreach(var suffix in keys.Select(k=>string.Join(":",k.Split(':').Skip(3))).Distinct()){
            var ids=suffix.Split(':');string b=ids[0],c=ids[1],a=ids[2];
            string Meta(string n,string kind)=>fields.GetValueOrDefault($"WBCCA:{n}:{kind}:{suffix}")??"";
            string SourceField(string n,string kind)=>fields.GetValueOrDefault($"BUCCA:{n}:{kind}:{suffix}")??"";
            string Text(string n){var raw=Meta(n,"T");if(string.IsNullOrWhiteSpace(raw)||raw.Length>2000)throw new ArgumentException("Enhanced CCA requires its source reference and eligibility basis.");return raw;}
            DateTime Date(string n){if(!DateTime.TryParseExact(Meta(n,"D"),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var d)||d<=new DateTime(2024,4,15)||d>=new DateTime(2025,1,1))throw new ArgumentException("2024 enhanced CCA requires explicit acquisition and available-for-use dates after2024-04-15 and within2024.");return d;}
            var acquired=Date("00002");var available=Date("00003");if(available<acquired)throw new ArgumentException("CCA available-for-use date cannot precede acquisition.");
            var confirmed=Meta("00001","B");if(confirmed is not("true" or "false"))throw new ArgumentException("Explicitly set enhanced CCA eligibilityConfirmed.");
            if(fields.GetValueOrDefault($"BUCCA:00021:O:{b}:{c}")!="50"||SourceField("00128","R")!="Yes"||SourceField("00131","R")!="AFT23"||SourceField("00132","R")=="Yes")throw new ArgumentException("Enhanced2024 CCA requires original class50 AIIP acquired after2023, without designated immediate expensing.");
            if(fields.GetValueOrDefault($"BUSIN:00022:D:{b}")!="2024-01-01"||fields.GetValueOrDefault($"BUSIN:00023:D:{b}")!="2024-12-31")throw new ArgumentException("Enhanced2024 CCA currently requires a full calendar business year.");
            if(fields.GetValueOrDefault($"BUCCA:00040:R:{b}:{c}")=="Yes"||fields.Keys.Any(k=>k.StartsWith("BUDSP:",StringComparison.Ordinal)&&string.Join(":",k.Split(':').Skip(3).Take(2))==$"{b}:{c}"&&(k.Split(':').Length==6||(k.Split(':')[1]=="00001"&&fields[k]=="Yes"))))throw new ArgumentException("Enhanced2024 CCA with dispositions needs a reviewed disposition allocation; it is not inferred.");
            decimal Amount(string n){var raw=SourceField(n,"C");if(raw==""&&n=="00123")return 0m;if(!Regex.IsMatch(raw,@"^\d+(?:\.\d{1,2})?$")||!decimal.TryParse(raw,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var amount)||amount<0||amount>9999999999999.99m)throw new ArgumentException("Enhanced CCA uses explicit nonnegative original asset costs with at most two decimals.");return amount;}
            decimal cost=Amount("00122")-Amount("00123");if(cost<=0)throw new ArgumentException("Enhanced CCA requires a positive original business-use acquisition cost.");
            var table=BusinessDataTable.ForGroup(data,"BUCCA",b,c);
            adapter.assets.Add(new(b,c,a,cost,confirmed=="true",Meta("00002","D"),Meta("00003","D"),Text("00004"),Text("00005"),scope,table));
        }
        foreach(var group in adapter.assets.GroupBy(a=>a.Table)){
            decimal cost=group.Sum(a=>a.Cost);
            group.Key.Transforms.Add((key,value,table)=>key=="00308"&&value is decimal original?original+cost*9m/11m:value);
        }
        return adapter;
    }
    internal object[] Report()=>assets.Select(a=>(object)new{businessId=a.BusinessId,classId=a.ClassId,assetId=a.AssetId,scope=a.Scope,eligibleCost=a.Cost,eligibilityConfirmed=a.Confirmed,acquiredDate=a.Acquired,availableForUseDate=a.Available,sourceReference=a.Source,eligibilityBasis=a.Basis,classCcaClaim=a.Table.Amount("00309"),closingUcc=a.Table.Amount("00310"),extension="2024 class50 enhanced AIIP9/11 adjustment; original55% calculation, claim limit and UCC carryforward preserved."}).ToArray();
}
