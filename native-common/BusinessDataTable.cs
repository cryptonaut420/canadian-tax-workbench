using System.Collections;
using System.Globalization;
using System.Reflection;

// Shared, explicit extension point for derived business values. Multiple
// source-backed adapters compose on one table; they cannot overwrite each other.
internal sealed class BusinessDataTable : Hashtable
{
    internal readonly List<Func<string,object?,BusinessDataTable,object?>> Transforms=new();
    private BusinessDataTable(Hashtable source){foreach(DictionaryEntry item in source)base[item.Key]=item.Value;}
    public override object? this[object key]{get=>base[key];set{foreach(var transform in Transforms)value=transform(Convert.ToString(key,CultureInfo.InvariantCulture)!,value,this);base[key]=value;}}
    public override void Remove(object key){
        object? value=null;foreach(var transform in Transforms)value=transform(Convert.ToString(key,CultureInfo.InvariantCulture)!,value,this);
        if(value==null)base.Remove(key);else base[key]=value;
    }
    internal decimal Amount(string key)=>this[key] is decimal d?d:0m;
    internal static BusinessDataTable For(object data,string id)=>ForGroup(data,"BUSIN",id);
    internal static BusinessDataTable ForGroup(object data,string name,params string[] ids){
        var outer=(Hashtable)data.GetType().GetProperty("TableData")!.GetValue(data)!;
        if(outer[name] is not Hashtable group)throw new ArgumentException("Source record is required: "+name);
        for(int i=0;i<ids.Length;i++){
            var loop=group.Keys.Cast<object>().FirstOrDefault(key=>Convert.ToString(key,CultureInfo.InvariantCulture)=="L"+ids[i])
                ?? throw new ArgumentException("Source loop not found: "+name+":"+string.Join(":",ids.Take(i+1)));
            if(group[loop] is not Hashtable source)throw new ArgumentException("Source fields are unavailable.");
            if(i<ids.Length-1){group=source;continue;}
            if(source is BusinessDataTable installed)return installed;
            var wrapper=new BusinessDataTable(source);group[loop]=wrapper;return wrapper;
        }
        throw new ArgumentException("At least one source loop is required.");
    }
}
