using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;

// Workbench extension, not an original GenuTax input or a change to tax IL.
// During original calculation ONLY, the percentage operand represents the
// explicitly agreed allocation. Restore legal ownership before previews/XML.
internal sealed class PartnershipAllocation
{
    internal static bool IsMetadata(string code)=>code.StartsWith("WBALC:",StringComparison.Ordinal);
    private sealed record Entry(object Data,PropertyInfo Indexer,string Id,double Ownership,double Profit,double Loss,string Scope)
    {internal double Effective;internal decimal EntityResult;}
    private readonly List<Entry> entries=new();
    internal PartnershipAllocation(object primary,Dictionary<string,string>? fields,object? spouse=null,Dictionary<string,string>? spouseFields=null)
    {Add(primary,fields,"primary");if(spouse!=null)Add(spouse,spouseFields,"spouse");}
    private void Add(object data,Dictionary<string,string>? fields,string scope)
    {
        fields??=new();var indexer=data.GetType().GetProperty("Item")!;
        var keys=fields.Keys.Where(IsMetadata).ToArray();
        foreach(string key in keys)if(!Regex.IsMatch(key,@"^WBALC:(?:0000[12]:P|00003:B):[1-9]\d{0,3}$"))throw new ArgumentException("Unknown Workbench allocation control.");
        foreach(string id in keys.Select(k=>k.Split(':')[3]).Distinct())
        {
            if(fields.GetValueOrDefault($"WBALC:00003:B:{id}")!="true")throw new ArgumentException("Explicitly confirm the separate partnership allocation agreement.");
            double Percent(string code){if(!double.TryParse(fields.GetValueOrDefault(code),NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out double v)||!double.IsFinite(v)||v<0.0001||v>100)throw new ArgumentException("Allocation percentages must be explicit numbers from0.0001 through100.");return v;}
            double profit=Percent($"WBALC:00001:P:{id}"),loss=Percent($"WBALC:00002:P:{id}");
            if(fields.GetValueOrDefault($"BUSIN:00038:R:{id}")!="PART")throw new ArgumentException("Separate allocation requires a partnership business.");
            double ownership=Percent($"BUSIN:00040:P:{id}");
            // Do not guess allocations for other partners' detailed records.
            if(fields.Keys.Any(k=>Regex.IsMatch(k,@"^BUSIN:000[5-9]5:[PF]:"+Regex.Escape(id)+"$")&&double.TryParse(fields[k],out double p)&&p!=0))throw new ArgumentException("Separate allocation with detailed other-partner percentages requires an explicit per-partner allocation mapping; do not infer their shares.");
            entries.Add(new(data,indexer,id,ownership,profit,loss,scope));
        }
    }
    internal object? Run(Func<object?> calculate)
    {
        try{
            foreach(var e in entries){e.EntityResult=Convert.ToDecimal(e.Indexer.GetValue(e.Data,new object[]{$"BUSIN:09369:C:{e.Id}"}),CultureInfo.InvariantCulture);e.Effective=e.EntityResult<0?e.Loss:e.Profit;e.Indexer.SetValue(e.Data,e.Effective,new object[]{$"BUSIN:00040:P:{e.Id}"});}
            return calculate();
        }finally{foreach(var e in entries)e.Indexer.SetValue(e.Data,e.Ownership,new object[]{$"BUSIN:00040:P:{e.Id}"});}
    }
    // Calculation support does not establish NETFILE encoding support. The
    // original serializer emits legal ownership but has no separate allocation
    // field; CRA rejects line 9946 when those percentages differ (280010).
    internal string[] FilingIssues()=>entries.Where(e=>Math.Abs(e.Ownership-e.Effective)>0.0000001)
        .Select(e=>$"{e.Scope} business {e.Id}: NETFILE export cannot currently represent the agreed {e.Effective}% income/loss allocation separately from {e.Ownership}% legal ownership. CRA rejects the resulting line 9946 arithmetic. Calculated amounts and the agreement are preserved; do not retry this return until a supported reporting method is established.").ToArray();
    internal object[] Report()=>entries.Select(e=>(object)new{businessId=e.Id,ownershipPercentage=e.Ownership,profitPercentage=e.Profit,lossPercentage=e.Loss,effectiveAllocationPercentage=e.Effective,partnershipIncomeBeforePartnerAdjustments=Convert.ToDecimal(e.Indexer.GetValue(e.Data,new object[]{$"BUSIN:09369:C:{e.Id}"}),CultureInfo.InvariantCulture),scope=e.Scope,extension="Explicit Workbench allocation adapter; original tax formulas unchanged; ownership restored before print/XML."}).ToArray();
}
