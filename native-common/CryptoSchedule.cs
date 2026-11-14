using System.Globalization;
using System.Reflection;

// The 2025 original Schedule 3 guard (GTCalculations.n IL_005abf–005e81)
// omits CAPCR although the following calculation reads it (IL_0086ba–0086eb).
// Bootstrap only those two real derived totals, using the exact original
// CAPCR arithmetic (IL_005259–0052eb). This makes the original guard enter;
// its complete Schedule 3 calculations and print logic then run unchanged.
// Never answers the unrelated flipped-housing question to trigger that guard.
internal static class CryptoSchedule
{
    internal static void Install(object data,Dictionary<string,string>? fields,int year)
    {
        if(year!=2025||fields==null||fields.GetValueOrDefault("CAPGA:00001:R")!="Yes"||fields.GetValueOrDefault("CAPCR:00001:R")!="Yes")return;
        var ids=fields.Keys.Where(k=>k.StartsWith("CAPCR:00021:T:",StringComparison.Ordinal)).Select(k=>k.Split(':')[3]).Distinct().ToArray();
        if(ids.Length==0)return;
        decimal Read(string code,string id)=>decimal.Parse(fields.GetValueOrDefault($"CAPCR:{code}:C:{id}")??"0",NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture);
        decimal proceeds=0m,gain=0m;
        foreach(string id in ids){var sold=Read("00027",id);proceeds+=sold;gain+=sold-Read("00025",id)-Read("00026",id)-Read("00028",id);}
        var indexer=data.GetType().GetProperty("Item")!;
        indexer.SetValue(data,proceeds,new object[]{"SCH03:15200:C"});
        indexer.SetValue(data,gain,new object[]{"SCH03:15301:C"});
    }
}
