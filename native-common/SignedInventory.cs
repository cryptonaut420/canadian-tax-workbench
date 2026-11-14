using System.Globalization;
using System.Text.RegularExpressions;

// Explicit source-accounting extension: preserve a signed inventory movement.
// Closing stock is not replaced and this does not invent another income item.
internal sealed class SignedInventory
{
    internal static bool IsMetadata(string code)=>code.StartsWith("WBINV:",StringComparison.Ordinal);
    private readonly List<object> reports=new();
    internal SignedInventory(object primary,Dictionary<string,string>? fields,object? spouse=null,Dictionary<string,string>? spouseFields=null)
    {Install(primary,fields,"primary");if(spouse!=null)Install(spouse,spouseFields,"spouse");}
    private void Install(object data,Dictionary<string,string>? fields,string scope)
    {
        fields??=new();var keys=fields.Keys.Where(IsMetadata).ToArray();
        foreach(string key in keys)if(!Regex.IsMatch(key,@"^WBINV:(?:0000[13]:B|00002:T):[1-9]\d{0,3}$"))throw new ArgumentException("Unknown signed-inventory control.");
        foreach(string id in keys.Select(k=>k.Split(':')[3]).Distinct()){
            if(fields.GetValueOrDefault($"WBINV:00001:B:{id}")!="true")throw new ArgumentException("Explicitly confirm signed inventory accounting.");
            string basis=fields.GetValueOrDefault($"WBINV:00002:T:{id}")??"";
            if(string.IsNullOrWhiteSpace(basis)||basis.Length>2000)throw new ArgumentException("Signed inventory requires its source accounting basis (up to2000characters).");
            if(fields.GetValueOrDefault($"BUSIN:00046:R:{id}")!="ACCR")throw new ArgumentException("Signed inventory requires accrual accounting.");
            decimal Read(string code)=>decimal.Parse(fields.GetValueOrDefault($"BUSIN:{code}:C:{id}")??"0",NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture);
            foreach(string code in new[]{"00111","00112","00113","00114","00116","00117"})if(Read(code)<0)throw new ArgumentException("Inventory and goods-cost source inputs must be nonnegative.");
            if(fields.GetValueOrDefault($"BUSIN:00110:R:{id}")!="Yes")throw new ArgumentException("Signed inventory requires the original goods-cost schedule.");
            decimal signed=Read("00111")+Read("00112")+Read("00113")+Read("00114")+Read("00116")-Read("00117");
            var table=BusinessDataTable.For(data,id);
            table.Transforms.Add((key,value,_)=>key=="08518"&&signed<0?signed:value);
            reports.Add(new{businessId=id,scope,sourceValuesConfirmed=fields.GetValueOrDefault($"WBINV:00003:B:{id}")=="true",signedCostOfGoods=signed,sourceBasis=basis,extension="Explicit signed-inventory accounting; original closing stock and source goods costs preserved. Source values and accounting treatment require review."});
        }
    }
    internal object[] Report()=>reports.ToArray();
}
