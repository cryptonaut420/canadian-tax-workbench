using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Numerics;

// Native CoreCLR only: no Wine, subprocess, Windows API, GenuTax executable,
// installed application, tax transmission, or authentication credential required.
// The reference calculation modules are bundled with this independent runner.
internal static class Program
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly Regex Code = new("^[A-Z0-9]{5}:[0-9]{5}:[A-Z](?::[A-Za-z0-9_-]+)*$", RegexOptions.CultureInvariant);
    private static int status;

    private static int Main(string[] args)
    {
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-CA");
        try
        {
            CheckArithmetic();
            string command = args.FirstOrDefault() ?? "doctor";
            object output = command switch
            {
                "doctor" => Doctor(),
                "calculate" => Calculate(JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(), Json)
                    ?? throw new ArgumentException("A JSON calculation request is required.")),
                "verify-stability" => Calculate(JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(), Json)
                    ?? throw new ArgumentException("A JSON calculation request is required."), true),
                "carry-forward" => CarryForward(JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(), Json)
                    ?? throw new ArgumentException("A source return and target year are required.")),
                "clean-inputs" => CleanInputs(JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(),Json)
                    ?? throw new ArgumentException("Source inputs are required.")),
                _ => throw new ArgumentException("Commands: doctor, calculate. calculate reads one JSON request from stdin.")
            };
            Console.WriteLine(JsonSerializer.Serialize(output, Json));
            return status;
        }
        catch (Exception ex)
        {
            while (ex is TargetInvocationException && ex.InnerException != null) ex = ex.InnerException;
            Console.Error.WriteLine(JsonSerializer.Serialize(new { error = ex.GetType().Name, message = ex.Message }, Json));
            return 1;
        }
    }

    private static void CheckArithmetic()
    {
        decimal amount = decimal.Parse("3166.45", CultureInfo.InvariantCulture);
        decimal percent = decimal.Parse("90.8256880733944954128440367", CultureInfo.InvariantCulture);
        if (decimal.Round(amount * percent / 100m, 2, MidpointRounding.AwayFromZero) != 2875.95m
            || amount * percent != percent * amount)
            throw new ArithmeticException("The host runtime failed the CPP operand-order check.");
    }

    private static string EngineDirectory => Path.Combine(AppContext.BaseDirectory, "engines");
    private static List<EngineIdentity> Identities() => JsonSerializer.Deserialize<List<EngineIdentity>>(
        File.ReadAllText(Path.Combine(EngineDirectory, "manifest.json")), Json)!;

    private static Assembly Load(EngineIdentity identity)
    {
        string path = Path.Combine(EngineDirectory, identity.File);
        string hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        if (hash != identity.Sha256) throw new InvalidDataException("Bundled engine hash differs for " + identity.Year);
        return AssemblyLoadContext.Default.LoadFromAssemblyPath(path);
    }

    private static object Doctor()
    {
        var engines = Identities().Select(identity =>
        {
            try
            {
                Assembly assembly = Load(identity);
                Type calculator = assembly.GetType($"GenuTax{identity.Year}.GTCalculations", true)!;
                Type data = assembly.GetType("GenuTax.GTTaxReturnData", true)!;
                object input = Activator.CreateInstance(data, new object[] { identity.Year })!;
                _ = calculator.GetConstructor(new[] { typeof(Hashtable), typeof(Hashtable) })
                    ?? throw new MissingMethodException("Expected two-dictionary constructor is missing.");
                _ = calculator.GetMethod("PerformCalc")
                    ?? throw new MissingMethodException("PerformCalc is missing.");
                return new { identity.Year, loaded = true, error = (string?)null, identity.Sha256 };
            }
            catch (Exception ex)
            {
                return new { identity.Year, loaded = false, error = (string?)ex.ToString(), identity.Sha256 };
            }
        }).ToArray();
        status = engines.All(engine => engine.loaded) ? 0 : 2;
        return new { runtime = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription,
            architecture = RuntimeInformation.ProcessArchitecture.ToString(), wineRequired = false,
            cppArithmetic = "passed", engines, calculationParityVerified = false };
    }

    private static object NewData(Type type, int year, Dictionary<string, string>? values)
    {
        object data = Activator.CreateInstance(type, new object[] { year })!;
        PropertyInfo indexer = type.GetProperty("Item")!;
        var identities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (key, text) in values ?? new())
        {
            if (!Code.IsMatch(key)) throw new ArgumentException("Invalid field code: " + key);
            if (key.StartsWith("METAD:", StringComparison.Ordinal))
                throw new ArgumentException("Year metadata is generated by the runner, not supplied as input.");
            if(PartnershipAllocation.IsMetadata(key)||PreapportionedHomeOffice.IsMetadata(key)||SignedInventory.IsMetadata(key)||EnhancedCca2024.IsMetadata(key))continue;
            var parts = key.Split(':');
            var identity = string.Join(':', parts.Take(2).Concat(parts.Skip(3)));
            if (!identities.Add(identity)) throw new ArgumentException("Conflicting type aliases address the same engine field: " + key);
            object value = key.Split(':')[2] switch
            {
                "C" => ExactDecimal(text),
                "I" => Regex.IsMatch(text, "^-?[0-9]+$") ? int.Parse(text, CultureInfo.InvariantCulture) : throw new ArgumentException("Integer fields require an integer string."),
                "B" => text is "true" or "false" ? bool.Parse(text) : throw new ArgumentException("Boolean fields require true or false."),
                "F" or "P" => FiniteDouble(text),
                "D" => DateTime.ParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                _ => text
            };
            indexer.SetValue(data, value, new object[] { key });
        }
        return data;
    }

    private static decimal ExactDecimal(string text)
    {
        if (!Regex.IsMatch(text,"^-?[0-9]+(?:\\.[0-9]{1,28})?$",RegexOptions.CultureInvariant))
            throw new ArgumentException("Monetary fields require a plain decimal string with at most 28 fractional digits.");
        string digits = text.TrimStart('-');
        int scale = digits.Contains('.') ? digits.Length-digits.IndexOf('.')-1 : 0;
        digits = digits.Replace(".","");
        while (scale > 0 && digits.EndsWith('0')) { digits=digits[..^1]; scale--; }
        if (BigInteger.Parse(digits, CultureInfo.InvariantCulture) > BigInteger.Parse("79228162514264337593543950335",CultureInfo.InvariantCulture))
            throw new ArgumentException("Monetary value cannot be represented exactly by the yearly engine’s decimal type.");
        return decimal.Parse(text, NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
    }

    private static double FiniteDouble(string text)
    {
        if (!Regex.IsMatch(text,"^-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",RegexOptions.CultureInvariant)
            || !double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture,out double value) || !double.IsFinite(value))
            throw new ArgumentException("Numeric and percentage fields require a finite numeric string.");
        return value;
    }

    private static string Scalar(object? value) => value switch
    {
        null => "",
        decimal x => x.ToString(CultureInfo.InvariantCulture),
        double x => x.ToString("R", CultureInfo.InvariantCulture),
        DateTime x => x == DateTime.MinValue ? "" : x.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        bool x => x ? "true" : "false",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? ""
    };

    private static Dictionary<string, string> Flatten(Hashtable table)
    {
        var result = new Dictionary<string, string>();
        foreach (DictionaryEntry group in table)
            if (group.Value is Hashtable fields) Walk(Convert.ToString(group.Key)!, fields, new List<string>());
        return result;
        void Walk(string group, Hashtable fields, List<string> loops)
        {
            foreach (DictionaryEntry entry in fields)
            {
                string name = Convert.ToString(entry.Key)!;
                if (entry.Value is Hashtable nested)
                {
                    var next = new List<string>(loops) { name.StartsWith('L') ? name[1..] : name };
                    Walk(group, nested, next);
                    continue;
                }
                string kind = entry.Value switch { decimal => "C", double => "F", int => "I", bool => "B", DateTime => "D", _ => "T" };
                result[group + ":" + name + ":" + kind + (loops.Count == 0 ? "" : ":" + string.Join(':', loops))] = Scalar(entry.Value);
            }
        }
    }

    private static object Calculate(Request request, bool verifyStability = false)
    {
        EngineIdentity identity = Identities().SingleOrDefault(x => x.Year == request.Year)
            ?? throw new ArgumentException("Bundled years are 2019–2025.");
        Assembly assembly = Load(identity);
        Type dataType = assembly.GetType("GenuTax.GTTaxReturnData", true)!;
        Type calcType = assembly.GetType($"GenuTax{request.Year}.GTCalculations", true)!;
        object primary = NewData(dataType, request.Year, request.Fields);
        object? spouse = request.SpouseFields == null ? null : NewData(dataType, request.Year, request.SpouseFields);
        PropertyInfo tableProperty = dataType.GetProperty("TableData")!;
        Hashtable primaryTable = (Hashtable)tableProperty.GetValue(primary)!;
        Hashtable spouseTable = spouse == null ? new Hashtable() : (Hashtable)tableProperty.GetValue(spouse)!;
        CryptoSchedule.Install(primary,request.Fields,request.Year);
        if(spouse!=null)CryptoSchedule.Install(spouse,request.SpouseFields,request.Year);
        var homeClaims=PreapportionedHomeOffice.Install(primary,request.Fields);
        var spouseHomeClaims=spouse==null?null:PreapportionedHomeOffice.Install(spouse,request.SpouseFields,"spouse");
        var enhancedCca=EnhancedCca2024.Install(primary,request.Fields,request.Year);
        var spouseEnhancedCca=spouse==null?null:EnhancedCca2024.Install(spouse,request.SpouseFields,request.Year,"spouse");
        var inventory=new SignedInventory(primary,request.Fields,spouse,request.SpouseFields);
        object calculator = Activator.CreateInstance(calcType, new object[] { primaryTable, spouseTable })!;
        var allocations=new PartnershipAllocation(primary,request.Fields,spouse,request.SpouseFields);
        // Original executable GenuTax.l.a (0x060000b9) calls PerformCalc
        // exactly three times and ignores its bool. Capture that same output.
        bool changed = false;
        const int calculationPasses = 3;
        for (int pass=0; pass<calculationPasses; pass++)
            changed |= (bool)allocations.Run(()=>calcType.GetMethod("PerformCalc")!.Invoke(calculator,null))!;
        string[] PrintList() => ((IEnumerable?)calcType.GetMethod("PrintList", new[] {typeof(bool),typeof(bool)})?
            .Invoke(calculator, new object[] {false,false}))?.Cast<object>().Select(Scalar).ToArray() ?? Array.Empty<string>();
        string BarcodeData()
        {
            // Original pure yearly barcode serializer. This is not the SOAP
            // serializer and performs no IP lookup or network transmission.
            try { return calcType.GetMethod("BarcodeData")?.Invoke(calculator,new object[]{true}) as string ?? ""; }
            catch (TargetInvocationException) { return ""; } // Incomplete identity cannot produce a filing barcode.
        }
        var printList = PrintList();
        var barcodeData = BarcodeData();
        var originalFields = Flatten(primaryTable);
        var originalSpouseFields = Flatten(spouseTable);
        // A fourth pass is validation only. Never silently substitute a different
        // iterative algorithm or return a result that still changes after the
        // source application's three passes.
        allocations.Run(()=>calcType.GetMethod("PerformCalc")!.Invoke(calculator,null));
        var validatedPrintList = PrintList();
        var validatedBarcodeData = BarcodeData();
        var validationFields = Flatten(primaryTable);
        var validationSpouseFields = Flatten(spouseTable);
        var changedOnSecondPass = originalFields.Keys.Union(validationFields.Keys)
            .Where(key => originalFields.GetValueOrDefault(key) != validationFields.GetValueOrDefault(key))
            .Concat(originalSpouseFields.Keys.Union(validationSpouseFields.Keys)
                .Where(key => originalSpouseFields.GetValueOrDefault(key) != validationSpouseFields.GetValueOrDefault(key)).Select(key => "spouse/"+key))
            .Order().ToArray();
        bool stable = changedOnSecondPass.Length == 0 && printList.SequenceEqual(validatedPrintList) && barcodeData == validatedBarcodeData;
        if (!stable) throw new ArithmeticException("The return changes after GenuTax's original three calculation passes. Correct or complete its source inputs before using this result. Changed fields: " + string.Join(", ",changedOnSecondPass.Take(20)));
        var lines = new SortedDictionary<string, string>();
        var lineFields = new SortedDictionary<string,string>();
        var lineLabels = new SortedDictionary<string,string>();
        void ReadLineMap(IDictionary map)
        {
            foreach (DictionaryEntry item in map)
                if (item.Value is IDictionary nested) ReadLineMap(nested);
                else if (item.Key is int && item.Value is string fieldCode && Code.IsMatch(fieldCode))
                {
                    string line = Convert.ToString(item.Key,CultureInfo.InvariantCulture)!;
                    lines[line] = Scalar(dataType.GetProperty("Item")!.GetValue(primary, new object[] { fieldCode }));
                    lineFields[line] = fieldCode;
                }
        }
        if (calcType.GetField("dictSectionSummaryMap",BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public)?.GetValue(null) is IDictionary nationalMap)
            ReadLineMap(nationalMap);
        string province = Scalar(dataType.GetProperty("Item")!.GetValue(primary,new object[]{"RESID:00100:O"}));
        if (calcType.GetField("dictProvSectionSummaryMap",BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public)?.GetValue(null) is IDictionary provincialMap
            && provincialMap[province] is IDictionary activeProvinceMap)
            ReadLineMap(activeProvinceMap);
        // 2019/2020 predate the original SectionSummary dictionaries. Recover
        // their direct scalar display associations from original NetfileEdi IL;
        // never infer a field from a CRA line number or execute network code.
        if (request.Year <= 2020)
        {
            using var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("NativeTax.legacy-lines.json")
                ?? throw new InvalidDataException("Original legacy line projection resource is missing.");
            using var legacy=JsonDocument.Parse(stream);
            var projection=legacy.RootElement.EnumerateArray().Single(item=>item.GetProperty("year").GetInt32()==request.Year);
            if(projection.GetProperty("engineSha256").GetString()!=identity.Sha256)
                throw new InvalidDataException("Original legacy line projection does not match the yearly engine.");
            var maps=projection.GetProperty("maps");
            foreach(string scope in new[]{"national",province})
                if(maps.TryGetProperty(scope,out var map))
                    foreach(var entry in map.EnumerateObject())
                    {
                        string fieldCode=entry.Value.GetString()!;
                        lines[entry.Name]=Scalar(dataType.GetProperty("Item")!.GetValue(primary,new object[]{fieldCode}));
                        lineFields[entry.Name]=fieldCode;
                    }
            if(calcType.GetField("dictRefileFieldMap",BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public)?.GetValue(null) is IDictionary legacyDescriptions)
                foreach(DictionaryEntry item in legacyDescriptions)
                    if(item.Key is int && item.Value?.GetType().GetProperty("Item2")?.GetValue(item.Value) is string label)
                        lineLabels[Convert.ToString(item.Key,CultureInfo.InvariantCulture)!]=label;
        }
        // Headline totals are not all in the interview's section-summary map.
        // Read the original typed indexer even when Flatten omits an absent zero.
        foreach (string line in new[]{"15000","23600","26000","42000","42800","43500","48400","48500"})
        {
            string fieldCode = "T1GEN:" + (int.Parse(line,CultureInfo.InvariantCulture)/100).ToString("D5",CultureInfo.InvariantCulture) + ":C";
            lines[line] = Scalar(dataType.GetProperty("Item")!.GetValue(primary,new object[]{fieldCode}));
            lineFields[line] = fieldCode;
        }
        if (calcType.GetField("dictFieldDescriptionMap",BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public)?.GetValue(null) is IDictionary descriptions)
            foreach (DictionaryEntry item in descriptions)
                if (item.Key is int && item.Value is string label)
                    lineLabels[Convert.ToString(item.Key,CultureInfo.InvariantCulture)!] = label;
        return new { year = request.Year, engineSha256 = identity.Sha256, runtime = RuntimeInformation.FrameworkDescription,
            interviewConditions=InterviewConditions.Read(primary,request.Year),spouseInterviewConditions=spouse==null?null:InterviewConditions.Read(spouse,request.Year),
            wineRequired = false, calculationChanged = changed, lines, lineFields, lineLabels, lineProvince = province,
            lineProjection = request.Year <= 2020 ? "Original direct EDI scalar associations; transformed values not projected" : "Original national and active-province section-summary maps",
            allocationAdjustments=allocations.Report(), homeOfficeClaims=homeClaims.Report().Concat(spouseHomeClaims?.Report()??Array.Empty<object>()).ToArray(), inventoryAdjustments=inventory.Report(), ccaAdjustments=enhancedCca.Report().Concat(spouseEnhancedCca?.Report()??Array.Empty<object>()).ToArray(), fields = originalFields, spouseFields = spouse == null ? null : originalSpouseFields, printList, barcodeData,
            convergence = new { stable, passes = calculationPasses, validationPasses = 1, orchestration = "Original GenuTax three-pass caller; fourth pass validates unchanged output." },
            stability = verifyStability ? new { stable = changedOnSecondPass!.Length == 0, changedFields = changedOnSecondPass } : null,
            filingReady = false, parityVerified = false };
    }

    private static object CarryForward(Request request)
    {
        int targetYear = request.TargetYear ?? request.Year+1;
        if (targetYear != request.Year+1) throw new ArgumentException("Native carryforward supports the immediately following tax year only.");
        var identities=Identities();
        var sourceIdentity=identities.SingleOrDefault(x=>x.Year==request.Year) ?? throw new ArgumentException("Source year is not bundled.");
        var targetIdentity=identities.SingleOrDefault(x=>x.Year==targetYear) ?? throw new ArgumentException("Target year is not bundled.");
        // Validate the exact original three-pass source snapshot before deriving
        // any carryforward. This never mutates the persisted source return.
        var calculated=JsonSerializer.SerializeToElement(Calculate(request),Json);
        Dictionary<string,string> CalculatedFields(string property) => calculated.GetProperty(property).EnumerateObject()
            .Where(pair=>!pair.Name.StartsWith("METAD:",StringComparison.Ordinal) && !(pair.Name.Split(':')[2]=="D" && pair.Value.GetString()==""))
            .ToDictionary(pair=>pair.Name,pair=>pair.Value.GetString()!);
        var sourceAssembly=Load(sourceIdentity);
        var sourceDataType=sourceAssembly.GetType("GenuTax.GTTaxReturnData",true)!;
        var source=NewData(sourceDataType,request.Year,CalculatedFields("fields"));
        var sourceSpouse=request.SpouseFields==null?null:NewData(sourceDataType,request.Year,CalculatedFields("spouseFields"));
        var sourceTable=(Hashtable)sourceDataType.GetProperty("TableData")!.GetValue(source)!;
        var sourceSpouseTable=sourceSpouse==null?null:(Hashtable)sourceDataType.GetProperty("TableData")!.GetValue(sourceSpouse)!;
        var targetAssembly=Load(targetIdentity);
        var targetDataType=targetAssembly.GetType("GenuTax.GTTaxReturnData",true)!;
        var targetCalcType=targetAssembly.GetType($"GenuTax{targetYear}.GTCalculations",true)!;
        var target=NewData(targetDataType,targetYear,null);
        var targetSpouse=sourceSpouseTable==null?null:NewData(targetDataType,targetYear,null);
        var targetTable=(Hashtable)targetDataType.GetProperty("TableData")!.GetValue(target)!;
        var targetSpouseTable=targetSpouse==null?new Hashtable():(Hashtable)targetDataType.GetProperty("TableData")!.GetValue(targetSpouse)!;
        var calculator=Activator.CreateInstance(targetCalcType,new object[]{targetTable,targetSpouseTable})!;
        var carry=targetCalcType.GetMethod("CarryForwardData")!;
        // Static original CIL: true selects the target calculator's primary;
        // its Hashtable argument supplies the previous year's calculated data.
        bool primaryCarried=(bool)carry.Invoke(calculator,new object[]{true,sourceTable})!;
        bool spouseCarried=sourceSpouseTable!=null && (bool)carry.Invoke(calculator,new object[]{false,sourceSpouseTable})!;
        var excluded=new List<string>();
        Dictionary<string,string> Inputs(Hashtable table,string scope)
        {
            var result=Flatten(table);
            foreach(var key in result.Keys.Where(key=>new[]{"METAD:","FILIN:","REFIL:","REFCH:"}.Any(prefix=>key.StartsWith(prefix,StringComparison.Ordinal)) || (key.Split(':')[2]=="D" && result[key]=="")).ToArray())
            { if(!key.StartsWith("METAD:"))excluded.Add(scope+key);result.Remove(key); }
            return result;
        }
        var carriedFields=Inputs(targetTable,"primary/");
        var carriedSpouseFields=targetSpouse==null?null:Inputs(targetSpouseTable,"spouse/");
        var homeCarry=PreapportionedHomeOffice.CarryForward(request.Fields,CalculatedFields("fields"),carriedFields,"primary");
        var spouseHomeCarry=carriedSpouseFields==null?Array.Empty<object>():PreapportionedHomeOffice.CarryForward(request.SpouseFields,CalculatedFields("spouseFields"),carriedSpouseFields,"spouse");
        return new {sourceYear=request.Year,targetYear,sourceEngineSha256=sourceIdentity.Sha256,targetEngineSha256=targetIdentity.Sha256,
            primaryCarried,spouseCarried,fields=carriedFields,spouseFields=carriedSpouseFields,homeOfficeCarryforwards=homeCarry.Concat(spouseHomeCarry).ToArray(),
            identityFields=request.Fields.Where(pair=>pair.Key.StartsWith("TAXPY:",StringComparison.Ordinal)).ToDictionary(pair=>pair.Key,pair=>pair.Value),
            spouseIdentityFields=request.SpouseFields?.Where(pair=>pair.Key.StartsWith("TAXPY:",StringComparison.Ordinal)).ToDictionary(pair=>pair.Key,pair=>pair.Value),
            excludedFilingFields=excluded,calculationRequired=true,reviewRequired=true,filingReady=false,parityVerified=false,
            provenance="Original target-year GTCalculations.CarryForwardData plus explicit pre-apportioned home-office unused-expense carryforward. Source calculated with original three-pass caller. Filing/access/consent metadata intentionally excluded from the new draft."};
    }

    private static object CleanInputs(Request request)
    {
        var identity=Identities().SingleOrDefault(x=>x.Year==request.Year) ?? throw new ArgumentException("Year is not bundled.");
        var assembly=Load(identity);
        var dataType=assembly.GetType("GenuTax.GTTaxReturnData",true)!;
        var calcType=assembly.GetType($"GenuTax{request.Year}.GTCalculations",true)!;
        var primary=NewData(dataType,request.Year,request.Fields);
        var spouse=request.SpouseFields==null?null:NewData(dataType,request.Year,request.SpouseFields);
        var property=dataType.GetProperty("TableData")!;
        var primaryTable=(Hashtable)property.GetValue(primary)!;
        var spouseTable=spouse==null?new Hashtable():(Hashtable)property.GetValue(spouse)!;
        CryptoSchedule.Install(primary,request.Fields,request.Year);
        if(spouse!=null)CryptoSchedule.Install(spouse,request.SpouseFields,request.Year);
        var homeClaims=PreapportionedHomeOffice.Install(primary,request.Fields);
        var spouseHomeClaims=spouse==null?null:PreapportionedHomeOffice.Install(spouse,request.SpouseFields,"spouse");
        var enhancedCca=EnhancedCca2024.Install(primary,request.Fields,request.Year);
        var spouseEnhancedCca=spouse==null?null:EnhancedCca2024.Install(spouse,request.SpouseFields,request.Year,"spouse");
        var inventory=new SignedInventory(primary,request.Fields,spouse,request.SpouseFields);
        var calculator=Activator.CreateInstance(calcType,new object[]{primaryTable,spouseTable})!;
        // Original cleanup consults derived residency/flags; prepare those with
        // the same three calls used by the application's calculation wrapper.
        var allocations=new PartnershipAllocation(primary,request.Fields,spouse,request.SpouseFields);
        for(int pass=0;pass<3;pass++)allocations.Run(()=>calcType.GetMethod("PerformCalc")!.Invoke(calculator,null));
        var beforePrimary=Flatten(primaryTable);var beforeSpouse=Flatten(spouseTable);
        var clean=calcType.GetMethod("ClearOrphanedData")!;
        clean.Invoke(calculator,new object[]{true});
        if(spouse!=null)clean.Invoke(calculator,new object[]{false});
        var afterPrimary=Flatten(primaryTable);var afterSpouse=Flatten(spouseTable);
        static string Address(string code)=>string.Join(':',code.Split(':').Take(2).Concat(code.Split(':').Skip(3)));
        object Changes(Dictionary<string,string> original,Dictionary<string,string> before,Dictionary<string,string> after)
        {
            var previous=before.ToDictionary(pair=>Address(pair.Key),pair=>pair.Value);
            var current=after.ToDictionary(pair=>Address(pair.Key),pair=>pair.Value);
            var removed=new List<string>();var changed=new List<string>();var fields=new Dictionary<string,string>(original);
            foreach(var (code,value) in original)
            {
                var id=Address(code);
                if((PartnershipAllocation.IsMetadata(code)||PreapportionedHomeOffice.IsMetadata(code)||SignedInventory.IsMetadata(code)||EnhancedCca2024.IsMetadata(code))&&!current.ContainsKey("BUSIN:00038:"+code.Split(':')[3])){fields.Remove(code);removed.Add(code);continue;}
                if(previous.ContainsKey(id) && !current.ContainsKey(id)){fields.Remove(code);removed.Add(code);}
                else if(previous.TryGetValue(id,out var oldValue) && current.TryGetValue(id,out var newValue) && oldValue!=newValue)
                {
                    if(code.Split(':')[2]=="D" && newValue==""){fields.Remove(code);removed.Add(code);}
                    else {fields[code]=newValue;changed.Add(code);}
                }
            }
            return new {fields,removedFields=removed,changedFields=changed};
        }
        var primaryChanges=Changes(request.Fields,beforePrimary,afterPrimary);
        var spouseChanges=request.SpouseFields==null?null:Changes(request.SpouseFields,beforeSpouse,afterSpouse);
        return new {year=request.Year,engineSha256=identity.Sha256,primary=primaryChanges,spouse=spouseChanges,
            provenance="Original GTCalculations.ClearOrphanedData on isolated clones after derived-field preparation. Only changes to supplied source fields are returned; source persistence is the caller's explicit action.",
            calculationRequired=true,reviewRequired=true,filingReady=false};
    }

    private sealed record Request(int Year, Dictionary<string, string> Fields, Dictionary<string, string>? SpouseFields, int? TargetYear = null);
    private sealed record EngineIdentity(int Year, string File, string Sha256);
}
