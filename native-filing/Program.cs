using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Schema;
using System.Text.RegularExpressions;
using System.Numerics;

// No network API is called by this host. Separate offline-only modules replace
// the exact public-IP helper with a constant, preserving all calculation IL.
internal static class Program
{
    const string Soap = "http://schemas.xmlsoap.org/soap/envelope/";
    const string Response = "http://www.cra-arc.gc.ca/xmlns/t1rsp/response/1-0-0";
    const string Request = "http://www.cra-arc.gc.ca/xmlns/t1rq/request/1-0-0";
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    static int Main(string[] args)
    {
        try {
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-CA");
            var input = JsonSerializer.Deserialize<Input>(Console.In.ReadToEnd(), Json) ?? throw new ArgumentException("JSON input required.");
            var assembly = Load(input.Year);
            var output = (args.FirstOrDefault() ?? "prepare") switch {
                "prepare" => Prepare(assembly, input),
                "parse-response" => ParseResponse(assembly, input.Xml ?? ""),
                "validate" => ValidateRequest(assembly, input.Xml ?? "",input.Year),
                "terms-request" => TermsRequest(assembly,input),
                "finalize-live" => FinalizeLive(assembly,input),
                _ => throw new ArgumentException("Commands: prepare, parse-response, validate, terms-request, finalize-live.")
            };
            Console.WriteLine(JsonSerializer.Serialize(output, Json));
            return 0;
        } catch(Exception ex) {
            while(ex is TargetInvocationException && ex.InnerException != null) ex=ex.InnerException;
            Console.Error.WriteLine(JsonSerializer.Serialize(new { error=ex.GetType().Name, message=ex.Message },Json));
            return 1;
        }
    }
    static Assembly Load(int year)
    {
        var manifest = JsonSerializer.Deserialize<List<Identity>>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"engines/manifest.json")),Json)!;
        var identity = manifest.SingleOrDefault(x=>x.Year==year) ?? throw new ArgumentException("Supported years: 2019–2025.");
        var path=Path.Combine(AppContext.BaseDirectory,"engines",identity.File);
        if(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant()!=identity.Sha256)throw new InvalidDataException("Engine hash differs.");
        return AssemblyLoadContext.Default.LoadFromAssemblyPath(path);
    }
    static object NewData(Type type,int year,Dictionary<string,string>? fields) {
        var data=Activator.CreateInstance(type,new object[]{year})!;
        var indexer=type.GetProperty("Item")!;
        var addresses=new HashSet<string>(StringComparer.Ordinal);
        foreach(var (key,text) in fields ?? new()) {
            if(!Regex.IsMatch(key,"^[A-Z0-9]{5}:[0-9]{5}:[A-Z](?::[A-Za-z0-9_-]+)*$") || key.StartsWith("METAD:"))throw new ArgumentException("Invalid input field.");
            if(PartnershipAllocation.IsMetadata(key)||PreapportionedHomeOffice.IsMetadata(key)||SignedInventory.IsMetadata(key)||EnhancedCca2024.IsMetadata(key))continue;
            var parts=key.Split(':');
            if(!addresses.Add(string.Join(':',parts.Take(2).Concat(parts.Skip(3)))))throw new ArgumentException("Duplicate type aliases address the same input field.");
            object value=parts[2] switch {
                "C"=>ParseDecimalExact(text), "I"=>Regex.IsMatch(text,@"^-?\d+$")?int.Parse(text,CultureInfo.InvariantCulture):throw new ArgumentException("An Int32 input is required."),
                "B"=>text=="true"?true:text=="false"?false:throw new ArgumentException("Boolean inputs must be true or false."),"F" or "P"=>ParseFiniteDouble(text),
                "D"=>DateTime.ParseExact(text,"yyyy-MM-dd",CultureInfo.InvariantCulture),_=>text
            };
            indexer.SetValue(data,value,new object[]{key});
        }
        return data;
    }
    static decimal ParseDecimalExact(string text) {
        if(!Regex.IsMatch(text,@"^-?[0-9]+(?:\.[0-9]{1,28})?$"))throw new ArgumentException("A decimal string with at most 28 fractional places is required.");
        var unsigned=text.TrimStart('-');
        var parts=unsigned.Split('.');
        var fraction=parts.Length>1?parts[1]:"";
        var coefficient=BigInteger.Parse(parts[0]+fraction,CultureInfo.InvariantCulture);
        int scale=fraction.Length;
        while(scale>0 && coefficient%10==0){coefficient/=10;scale--;}
        if(coefficient>BigInteger.Parse("79228162514264337593543950335",CultureInfo.InvariantCulture))throw new ArgumentException("The decimal value cannot be represented exactly by System.Decimal.");
        return decimal.Parse(text,NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture);
    }
    static double ParseFiniteDouble(string text) {
        var value=double.Parse(text,NumberStyles.Float,CultureInfo.InvariantCulture);
        if(!double.IsFinite(value))throw new ArgumentException("Floating-point inputs must be finite.");
        return value;
    }
    static object Prepare(Assembly assembly,Input input)
    {
        if(input.Mode!="netfile" && input.Mode!="refile")throw new ArgumentException("Mode must be netfile or refile.");
        var type=assembly.GetType($"GenuTax{input.Year}.GTCalculations",true)!;
        var dataType=assembly.GetType("GenuTax.GTTaxReturnData",true)!;
        var primary=NewData(dataType,input.Year,input.Fields);
        var spouse=NewData(dataType,input.Year,input.SpouseFields);
        var table=dataType.GetProperty("TableData")!;
        CryptoSchedule.Install(primary,input.Fields,input.Year);
        if(spouse!=null)CryptoSchedule.Install(spouse,input.SpouseFields,input.Year);
        var homeClaims=PreapportionedHomeOffice.Install(primary,input.Fields);
        var spouseHomeClaims=input.SpouseFields==null?null:PreapportionedHomeOffice.Install(spouse,input.SpouseFields,"spouse");
        var enhancedCca=EnhancedCca2024.Install(primary,input.Fields,input.Year);
        var spouseEnhancedCca=spouse==null?null:EnhancedCca2024.Install(spouse,input.SpouseFields,input.Year,"spouse");
        var inventory=new SignedInventory(primary,input.Fields,input.SpouseFields==null?null:spouse,input.SpouseFields);
        var calc=Activator.CreateInstance(type,new object[]{table.GetValue(primary)!,input.SpouseFields==null?new Hashtable():table.GetValue(spouse)!})!;
        var primaryTable=(Hashtable)table.GetValue(primary)!;
        var spouseTable=input.SpouseFields==null?new Hashtable():(Hashtable)table.GetValue(spouse)!;
        // Original desktop caller GenuTax.l.a (0x060000b9) invokes exactly
        // three passes. The fourth is a verification pass, not another rounding
        // algorithm: a changed result is rejected instead of silently iterating.
        var allocations=new PartnershipAllocation(primary,input.Fields,input.SpouseFields==null?null:spouse,input.SpouseFields);
        int calculationPasses=3;
        for(int pass=0;pass<3;pass++)allocations.Run(()=>type.GetMethod("PerformCalc")!.Invoke(calc,null));
        string[] PrintList() => ((IEnumerable?)type.GetMethod("PrintList")?.Invoke(calc,new object[]{false,false}))?.Cast<object>().Select(x=>Convert.ToString(x,CultureInfo.InvariantCulture)??"").ToArray() ?? Array.Empty<string>();
        var printList=PrintList();
        var originalSnapshot=Snapshot(primaryTable,spouseTable);
        allocations.Run(()=>type.GetMethod("PerformCalc")!.Invoke(calc,null));
        var verificationPrintList=PrintList();
        bool converged=originalSnapshot==Snapshot(primaryTable,spouseTable) && printList.SequenceEqual(verificationPrintList);
        bool baselineSupplied=false;
        if(input.Mode=="refile" && !string.IsNullOrWhiteSpace(input.BaselinePayloadXml)) {
            var baseline=Payload(input.BaselinePayloadXml);
            if(baseline.Name!=XName.Get("FileReturnRequest",Request) || Validate(assembly,baseline,"request").Count!=0)throw new ArgumentException("The ReFILE baseline must be a schema-valid accepted original request.");
            CheckFilingIdentity(baseline,input.Year,input.Fields?.GetValueOrDefault("TAXPY:00001:S")??"");
            var indexer=dataType.GetProperty("Item")!;
            indexer.SetValue(primary,input.BaselinePayloadXml,new object[]{"REFIL:00001:T"});
            indexer.SetValue(primary,1,new object[]{"REFIL:10001:I"});
            type.GetMethod("RefileDifference")!.Invoke(calc,new object[]{true});baselineSupplied=true;
        }
        var calculationFields=Flatten(primaryTable);
        var calculationSpouseFields=input.SpouseFields==null?null:Flatten(spouseTable);
        string? termsXml=type.GetMethod(input.Mode=="refile"?"RefileTermsRequestXML":"TermsRequestXML")?.Invoke(calc,null) as string;
        if(termsXml!=null)termsXml=NormalizeForTransport(termsXml);
        var errors=new List<string>(); errors.AddRange(allocations.FilingIssues()); var schemaErrors=new List<string>(); string eligibility="",xml="";
        if(!converged)errors.Add("The original three calculation passes changed during the independent fourth-pass stability check. No filing payload can be prepared.");
        try {
            if(converged) {
            eligibility=(string)(input.Mode=="refile"?type.GetMethod("RefileEligible")!.Invoke(calc,new object[]{true}):type.GetMethod("NetfileEligible")!.Invoke(calc,new object[]{true,"en-CA"}))!;
            xml=(string)type.GetMethod(input.Mode=="refile"?"RefileXML":"NetfileXML")!.Invoke(calc,new object[]{true,true})!;
            }
        }catch(Exception ex){while(ex is TargetInvocationException && ex.InnerException!=null)ex=ex.InnerException;errors.Add(ex.Message);}
        if(!string.IsNullOrWhiteSpace(eligibility))errors.Add(eligibility);
        string? payloadXml=null;var partnershipGrossAdjustments=new List<object>();
        if(xml.TrimStart().StartsWith("<?xml") || xml.TrimStart().StartsWith("<")) {
            try { payloadXml=NormalizeForTransport(PartnershipGross.Normalize(xml,input.Fields,partnershipGrossAdjustments));schemaErrors.AddRange(Validate(assembly,Payload(payloadXml),"request")); } catch(Exception ex){schemaErrors.Add(ex.Message);}
        } else if(!string.IsNullOrWhiteSpace(xml))errors.Add(xml);
        if(payloadXml==null && errors.Count==0)errors.Add("The original serializer did not generate a return payload.");
        return new {
            interviewConditions=InterviewConditions.Read(primary,input.Year),spouseInterviewConditions=input.SpouseFields==null?null:InterviewConditions.Read(spouse,input.Year),
            year=input.Year,mode=input.Mode,liveReady=false,payloadXml,calculationPasses,verificationPasses=1,converged,baselineSupplied,calculationFields,calculationSpouseFields,
            partnershipGrossAdjustments,refileDifferences=primaryTable["REFCH"] is Hashtable changes?SnapshotFields(changes):new SortedDictionary<string,string>(),
            payloadSha256=payloadXml==null?null:Convert.ToHexString(SHA256.HashData(System.Text.Encoding.Latin1.GetBytes(payloadXml))).ToLowerInvariant(),
            schemaValidated=payloadXml!=null && schemaErrors.Count==0,validationErrors=errors.Concat(schemaErrors).ToArray(),eligibilityMessage=eligibility,
            warnings=new[]{"Offline serializer copy replaces only the public-IP helper with 0.0.0.0. This payload is for local verification and must not be transmitted.","Schema compatibility alone does not establish complete-return parity, CRA certification, or current filing availability.","No return or terms request has been transmitted.",input.Mode=="refile" && !baselineSupplied?"No immutable accepted request baseline was supplied; ReFILE differences are not verified.":"The supplied baseline is trusted as an accepted record by the calling server; this host cannot independently establish CRA acceptance."},
            allocationAdjustments=allocations.Report(), homeOfficeClaims=homeClaims.Report().Concat(spouseHomeClaims?.Report()??Array.Empty<object>()).ToArray(), inventoryAdjustments=inventory.Report(), ccaAdjustments=enhancedCca.Report().Concat(spouseEnhancedCca?.Report()??Array.Empty<object>()).ToArray(),termsRequestXml=termsXml,termsSchemaValidated=termsXml!=null && Validate(assembly,Payload(termsXml),"request").Count==0,
            transport=new {endpoint="https://apps.cra-arc.gc.ca/ebci/pfno/ws/services/FileReturnService",method="POST",contentType="text/xml;charset=iso-8859-1",soapAction="",acceptEncoding="gzip,deflate",encoding="iso-8859-1",automaticRetries=false},
            offlineOnly=true,originatingIP="0.0.0.0",
            evidence=new {serializer="Original serializer in separate offline-only module; only public-IP helper replaced, then explicit T5013 gross-source preservation (see partnershipGrossAdjustments) and original sender XmlDocument.LoadXml/Save stream serialization reproduced. See offline-engines/manifest.json for exact method/byte hashes.",response="Embedded t1wsresponse.xsd and GenuTax.an response parser."}
        };
    }
    static Dictionary<string,string> Flatten(Hashtable table) {
        var result=new Dictionary<string,string>();
        foreach(DictionaryEntry group in table)if(group.Value is Hashtable fields)Walk(Convert.ToString(group.Key)!,fields,new List<string>());
        return result;
        void Walk(string group,Hashtable fields,List<string> loops) {
            foreach(DictionaryEntry entry in fields) {
                string name=Convert.ToString(entry.Key)!;
                if(entry.Value is Hashtable nested){var next=new List<string>(loops){name.StartsWith('L')?name[1..]:name};Walk(group,nested,next);continue;}
                string kind=entry.Value switch {decimal=>"C",double=>"F",int=>"I",bool=>"B",DateTime=>"D",_=>"T"};
                string value=entry.Value switch {null=>"",DateTime date=>date==DateTime.MinValue?"":date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture),double d=>d.ToString("R",CultureInfo.InvariantCulture),bool b=>b?"true":"false",_=>Convert.ToString(entry.Value,CultureInfo.InvariantCulture)??""};
                result[group+":"+name+":"+kind+(loops.Count==0?"":":"+string.Join(':',loops))]=value;
            }
        }
    }
    static object TermsRequest(Assembly assembly,Input input) {
        if(input.Mode!="netfile" && input.Mode!="refile")throw new ArgumentException("Mode must be netfile or refile.");
        var type=assembly.GetType($"GenuTax{input.Year}.GTCalculations",true)!;
        var calc=Activator.CreateInstance(type,new object[]{new Hashtable(),new Hashtable()})!;
        var xml=NormalizeForTransport((string)type.GetMethod(input.Mode=="refile"?"RefileTermsRequestXML":"TermsRequestXML")!.Invoke(calc,null)!);
        var errors=Validate(assembly,Payload(xml),"request");
        return new {year=input.Year,mode=input.Mode,payloadXml=xml,schemaValidated=errors.Count==0,validationErrors=errors};
    }
    static object FinalizeLive(Assembly assembly,Input input) {
        string xml=input.Xml ?? "";
        var payload=Payload(xml);
        if(payload.Name!=XName.Get("FileReturnRequest",Request))throw new ArgumentException("A complete filing SOAP request is required.");
        var errors=Validate(assembly,payload,"request");
        if(errors.Count!=0)throw new ArgumentException("The source filing payload does not pass schema validation.");
        CheckFilingIdentity(payload,input.Year);
        CheckRequestEncoding(xml);
        var addresses=payload.Descendants().Where(e=>e.Name.LocalName=="OriginatingIP").ToArray();
        var agreements=payload.Descendants(XName.Get("AgreementIndicator",Request)).ToArray();
        if(addresses.Length!=1 || addresses[0].Value!="0.0.0.0" || agreements.Length!=1 || agreements[0].Value!="1")throw new ArgumentException("Live preparation requires one original IP placeholder and pending-confirmation agreement indicator 1.");
        if(!System.Net.IPAddress.TryParse(input.OriginatingIP,out var ip) || ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork || ip.ToString()!=input.OriginatingIP || input.OriginatingIP=="0.0.0.0")throw new ArgumentException("Provide a valid explicit originating IPv4 address.");
        var matches=Regex.Matches(xml,@"<comm:OriginatingIP>0\.0\.0\.0</comm:OriginatingIP>");
        if(matches.Count!=1)throw new ArgumentException("The original serializer IP element cannot be replaced exactly once.");
        string finalized=xml.Replace("<comm:OriginatingIP>0.0.0.0</comm:OriginatingIP>","<comm:OriginatingIP>"+input.OriginatingIP+"</comm:OriginatingIP>",StringComparison.Ordinal);
        errors=Validate(assembly,Payload(finalized),"request");
        return new {payloadXml=finalized,schemaValidated=errors.Count==0,validationErrors=errors,originatingIP=input.OriginatingIP,payloadSha256=Convert.ToHexString(SHA256.HashData(System.Text.Encoding.Latin1.GetBytes(finalized))).ToLowerInvariant()};
    }
    static SortedDictionary<string,string> SnapshotFields(Hashtable table) {
        var flat=new SortedDictionary<string,string>();
        void Walk(Hashtable values,string path) {
            foreach(DictionaryEntry entry in values) {
                var key=path+"/"+Convert.ToString(entry.Key,CultureInfo.InvariantCulture);
                if(entry.Value is Hashtable nested)Walk(nested,key);
                else flat[key+":"+entry.Value?.GetType().FullName]=entry.Value switch {DateTime date=>date==DateTime.MinValue?"":date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture),double d=>d.ToString("R",CultureInfo.InvariantCulture),bool b=>b?"true":"false",_=>Convert.ToString(entry.Value,CultureInfo.InvariantCulture)??""};
            }
        }
        Walk(table,"");return flat;
    }
    static string Snapshot(Hashtable primary,Hashtable spouse) {
        SortedDictionary<string,SortedDictionary<string,string>> Groups(Hashtable table) {
            var result=new SortedDictionary<string,SortedDictionary<string,string>>();
            foreach(DictionaryEntry entry in table)if(entry.Value is Hashtable group)result[Convert.ToString(entry.Key)!]=SnapshotFields(group);
            return result;
        }
        return JsonSerializer.Serialize(new[]{Groups(primary),Groups(spouse)},Json);
    }
    static XDocument Document(string xml)
    {
        if(xml.Length>4*1024*1024)throw new ArgumentException("XML exceeds 4 MiB.");
        using var reader=XmlReader.Create(new StringReader(xml),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=4*1024*1024});
        return XDocument.Load(reader,LoadOptions.PreserveWhitespace);
    }
    static XElement Payload(string xml)
    {
        var doc=Document(xml);
        var root=doc.Root ?? throw new XmlException("Missing XML root.");
        if(root.Name!=XName.Get("Envelope",Soap))throw new XmlException("Expected SOAP 1.1 Envelope.");
        var children=root.Elements().ToArray();
        var bodies=children.Where(e=>e.Name==XName.Get("Body",Soap)).ToArray();
        var headers=children.Where(e=>e.Name==XName.Get("Header",Soap)).ToArray();
        if(bodies.Length!=1 || bodies[0].Elements().Count()!=1)throw new XmlException("Expected exactly one SOAP Body and one payload element.");
        if(headers.Length>1 || children.Any(e=>e.Name!=XName.Get("Body",Soap)&&e.Name!=XName.Get("Header",Soap)) || children.Last()!=bodies[0])throw new XmlException("Expected optional SOAP Header followed by one SOAP Body.");
        if(root.Nodes().OfType<XText>().Any(t=>!string.IsNullOrWhiteSpace(t.Value)) || bodies[0].Nodes().OfType<XText>().Any(t=>!string.IsNullOrWhiteSpace(t.Value)))throw new XmlException("Unexpected text outside the SOAP payload.");
        return bodies[0].Elements().Single();
    }
    static List<string> Validate(Assembly assembly,XElement payload,string kind)
    {
        var errors=new List<string>();
        var schemas=new XmlSchemaSet { XmlResolver=null };
        // All schemas are read from bundled resources; imports never access URLs.
        foreach(var name in assembly.GetManifestResourceNames().Where(x=>x.EndsWith(".xsd") && (kind=="request" || x.EndsWith(".t1wsresponse.xsd") || x.EndsWith(".standarddatatypes.xsd") || x.EndsWith(".xml.xsd")))) {
            using var stream=assembly.GetManifestResourceStream(name)!;
            using var reader=XmlReader.Create(stream,new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null});
            schemas.Add(null,reader);
        }
        schemas.Compile();
        var doc=new XDocument(new XElement(payload));
        doc.Validate(schemas,(_,e)=>errors.Add(e.Message));
        return errors;
    }
    // GenuTax.exe sender: GenuTax.an.a(string) 0x06000208 LoadXml;
    // nested an/a.a 0x0600020c calls XmlDocument.Save(requestStream).
    // Match that final serialization before hashing/exposing the request.
    static string NormalizeForTransport(string xml)
    {
        CheckRequestEncoding(xml);
        var document=new XmlDocument {XmlResolver=null,PreserveWhitespace=false};
        using(var reader=XmlReader.Create(new StringReader(xml),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=4*1024*1024}))document.Load(reader);
        using var bytes=new MemoryStream();document.Save(bytes);
        var result=System.Text.Encoding.Latin1.GetString(bytes.ToArray());
        CheckRequestEncoding(result);return result;
    }
    static void CheckFilingIdentity(XElement payload,int expectedYear,string? expectedSin=null)
    {
        static string One(XElement root,string name){var values=root.Descendants().Where(e=>e.Name.LocalName==name).Select(e=>e.Value).Distinct().ToArray();if(values.Length!=1)throw new ArgumentException("The filing request contains missing or mismatched "+name+" values.");return values[0];}
        if(One(payload,"TaxYear")!=expectedYear.ToString(CultureInfo.InvariantCulture))throw new ArgumentException("The filing request tax year does not match the selected yearly engine.");
        var sin=One(payload,"TaxpayerSocialInsuranceNumber");
        if(expectedSin!=null && (expectedSin.Replace(" ","").Replace("-","")!=sin || sin.Length!=9))throw new ArgumentException("The ReFILE baseline taxpayer does not match the current return.");
    }
    static void CheckRequestEncoding(string xml)
    {
        var declaration=Document(xml).Declaration;
        if(declaration==null || !string.Equals(declaration.Encoding,"iso-8859-1",StringComparison.OrdinalIgnoreCase))throw new ArgumentException("The source SOAP request must declare ISO-8859-1 encoding.");
        if(xml.Any(c=>c>255))throw new ArgumentException("The source SOAP request contains unescaped characters outside ISO-8859-1.");
    }
    static object ValidateRequest(Assembly assembly,string xml,int expectedYear)
    {
        var errors=new List<string>();
        try {
            var payload=Payload(xml);
            if(payload.Name.NamespaceName!=Request || !new[]{"FileReturnRequest","TermsAndConditionsRequest","RefileTermsAndConditionsRequest"}.Contains(payload.Name.LocalName)) errors.Add("Unexpected request payload.");
            else {
                errors.AddRange(Validate(assembly,payload,"request"));
                CheckRequestEncoding(xml);
                if(payload.Name.LocalName=="FileReturnRequest")CheckFilingIdentity(payload,expectedYear);
            }
        }catch(Exception ex){errors.Add(ex.Message);}
        string? taxYear=null,taxpayerSin=null,originatingIP=null,agreementIndicator=null;
        try {
            var p=Payload(xml);
            if(errors.Count==0 && p.Name==XName.Get("FileReturnRequest",Request)) {
                var years=p.Descendants().Where(e=>e.Name.LocalName=="TaxYear").Select(e=>e.Value).Distinct().ToArray();
                var sins=p.Descendants().Where(e=>e.Name.LocalName=="TaxpayerSocialInsuranceNumber").Select(e=>e.Value).Distinct().ToArray();
                if(years.Length==1)taxYear=years[0];else errors.Add("The filing request contains mismatched tax years.");
                if(sins.Length==1)taxpayerSin=sins[0];else errors.Add("The filing request contains mismatched taxpayer identities.");
                originatingIP=p.Descendants().SingleOrDefault(e=>e.Name.LocalName=="OriginatingIP")?.Value;
                agreementIndicator=p.Descendants(XName.Get("AgreementIndicator",Request)).SingleOrDefault()?.Value;
            }
        }catch(Exception ex){errors.Add(ex.Message);}
        return new {schemaValidated=errors.Count==0,validationErrors=errors,taxYear,taxpayerSin,originatingIP,agreementIndicator};
    }
    static object ParseResponse(Assembly assembly,string xml)
    {
        string status="unknown",kind="unrecognized",confirmationCode="",resultCode="";
        var messages=new List<string>();var errorCodes=new List<string>();var validationErrors=new List<string>();
        bool schemaValidated=false;var schemaCompatibility=new List<string>();
        try {
            var payload=Payload(xml);
            if(payload.Name==XName.Get("Fault",Soap)) {
                kind="soap-fault";messages.AddRange(payload.Elements().Where(e=>e.Name.LocalName=="faultstring").Select(e=>e.Value));
            }else {
                if(payload.Name.NamespaceName!=Response || !new[]{"NetfileReturnResponse","FileReturnResponse","TermsAndConditionsResponse"}.Contains(payload.Name.LocalName))throw new XmlException("Unrecognized CRA response payload or namespace.");
                // CRA's live response uses a two-digit ResultCode (observed 80),
                // while bundled historical schemas require six characters. Validate
                // a clone with zero padding ONLY for this exact numeric width.
                // Preserve raw response bytes/code and all other schema checks.
                // Response contracts belong to the current CRA service, not the
                // return's calculation year. 2019/2020 bundled response schemas
                // describe older contracts; use the latest bundled response schema.
                var responseAssembly=Load(payload.Name.LocalName=="FileReturnResponse"?2019:2025);
                var validationPayload=new XElement(payload);
                var code=validationPayload.Element(XName.Get("ResultCode",Response));
                if(payload.Name==XName.Get("NetfileReturnResponse",Response)&&code!=null&&Regex.IsMatch(code.Value,@"^[0-9]{2}$")){
                    code.Value=code.Value.PadLeft(6,'0');
                    schemaCompatibility.Add("Two-digit live ResultCode validated with historical six-character zero padding; original response preserved.");
                }
                if(code!=null&&!Regex.IsMatch(payload.Element(XName.Get("ResultCode",Response))!.Value,@"^(?:[0-9]{2}|[0-9]{6})$"))validationErrors.Add("Unrecognized CRA ResultCode format.");
                validationErrors.AddRange(Validate(responseAssembly,validationPayload,"response"));schemaValidated=validationErrors.Count==0;
                var ns=(XNamespace)Response;
                messages.AddRange(payload.Descendants(ns+"EnglishMessage").Elements(ns+"MessageText").Select(e=>e.Value));
                errorCodes.AddRange(payload.Descendants(ns+"ErrorCode").Select(e=>e.Value));
                if(payload.Name.LocalName=="TermsAndConditionsResponse") {
                    if(payload.Element(ns+"TermsAndConditions")!=null){kind="terms";status=schemaValidated?"terms":"unknown";}
                    else kind="system-error";
                }else {
                    resultCode=payload.Element(ns+"ResultCode")?.Value ?? "";
                    var result=payload.Name.LocalName=="FileReturnResponse"?payload:payload.Element(ns+"FileReturnResponse");
                    var confirmation=result?.Element(ns+"Confirmation");
                    if(confirmation!=null) {
                        kind="confirmation";confirmationCode=confirmation.Element(ns+"ConfirmationCode")?.Value.Trim()??"";
                        if(schemaValidated && confirmationCode.Length>0)status="accepted";
                        else validationErrors.Add(confirmationCode.Length==0?"Confirmation without a valid code is ambiguous; verify with CRA before retrying.":"Confirmation received but response validation failed; preserve the receipt and reconcile before retrying.");
                    }else if(result?.Element(ns+"Rejection")!=null) {kind="rejection";if(schemaValidated)status="rejected";}
                    else if(result?.Element(ns+"ProcessingError")!=null) {kind="processing-error";if(schemaValidated)status="rejected";}
                    else if(result?.Element(ns+"SystemError")!=null)kind="system-error";
                }
            }
        }catch(Exception ex){validationErrors.Add(ex.Message);}
        return new {status,kind,confirmationCode=confirmationCode.Length>0?confirmationCode:null,resultCode=resultCode.Length>0?resultCode:null,messages,errorCodes,schemaValidated,schemaCompatibility,validationErrors,requiresReconciliation=status=="unknown",automaticRetryAllowed=false,receivedAt=DateTimeOffset.UtcNow.ToString("O"),dateSource="Local receipt time; response schema has no CRA submission date."};
    }
    sealed record Input(int Year=2021,string Mode="netfile",string? Xml=null,Dictionary<string,string>? Fields=null,Dictionary<string,string>? SpouseFields=null,string? BaselinePayloadXml=null,string? OriginatingIP=null);
    sealed record Identity(int Year,string File,string Sha256);
}
