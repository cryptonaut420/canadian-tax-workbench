using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

// Evaluate source logical-index visibility through the original typed getter.
// Absent Hashtable entries are not guessed false in JavaScript: the original
// GTTaxReturnData indexer supplies the result after the calculation has run.
internal static class InterviewConditions
{
    public static SortedDictionary<string,string> Read(object data,int year)
    {
        var dir=Path.Combine(AppContext.BaseDirectory,"interviews");
        var bytes=File.ReadAllBytes(Path.Combine(dir,$"{year}.json.gz"));
        using var manifest=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(dir,"manifest.json")));
        var entry=manifest.RootElement.EnumerateArray().Single(x=>x.GetProperty("year").GetInt32()==year);
        if(!string.Equals(Convert.ToHexString(SHA256.HashData(bytes)),entry.GetProperty("bundleSha256").GetString(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Original interview bundle hash differs.");
        using var compressed=new MemoryStream(bytes);using var gzip=new GZipStream(compressed,CompressionMode.Decompress);using var bundle=JsonDocument.Parse(gzip);
        var result=new SortedDictionary<string,string>();var indexer=data.GetType().GetProperty("Item")!;
        foreach(var section in bundle.RootElement.GetProperty("logicalIndex").EnumerateArray())
        {
            if(!section.TryGetProperty("condition",out var condition) || condition.ValueKind!=JsonValueKind.String)continue;
            var code=condition.GetString()!;if(!Regex.IsMatch(code,@"^[A-Z0-9]{5}:\d{5}:B$"))continue;
            var value=indexer.GetValue(data,new object[]{code});
            if(value is not bool flag)throw new InvalidDataException("Original section condition did not return Boolean.");
            result[code]=flag?"true":"false";
        }
        return result;
    }
}
