using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Collections.Immutable;
using System.Drawing;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

public class ControlStub { public Size Size {get;set;} }
public class PenStub { public Color Color; public float Width; public PenStub(Color c,float w){Color=c;Width=w;} }
public class Canvas {
 public readonly List<Bar> Bars=new();
 public void Clear(Color c){Bars.Clear();}
 public void DrawLine(PenStub p,PointF a,PointF b){Bars.Add(new(a.X,a.Y,b.X,b.Y,p.Width,p.Color.ToArgb()));}
}
public record Bar(float X1,float Y1,float X2,float Y2,float Width,int Color);
public static class EncoderDiagnostics {
 public static bool Precomputing;public static readonly List<Exception> Errors=new();
 public static void SetProjectError(Exception e){if(!(Precomputing && e is NullReferenceException))Errors.Add(e);Microsoft.VisualBasic.CompilerServices.ProjectData.SetProjectError(e);}
}
public class Program {
 public static int Main(){try{
  System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
  CultureInfo.CurrentCulture=CultureInfo.GetCultureInfo("en-CA");
  var request=JsonSerializer.Deserialize<Input>(Console.In.ReadToEnd(),new JsonSerializerOptions{PropertyNameCaseInsensitive=true}) ?? new();
  var path=Path.Combine(AppContext.BaseDirectory,"original/pdf417_20.dll");
  var sourceBytes=File.ReadAllBytes(path);
  if(Convert.ToHexString(SHA256.HashData(sourceBytes)).ToLowerInvariant()!="dba352f2ea4c91a6afb267903f2eb0b71379155fcfc4fdf3871027ebd6c7ce9e")throw new InvalidDataException("Original PDF417 source hash mismatch.");
  if(request.Text.Length>20000 || request.Columns<1 || request.Columns>30 || request.Rows<3 || request.Rows>90 || request.BarWidth<1 || request.BarWidth>10 || request.BarHeight<1 || request.BarHeight>30 || request.EcLevel<0 || request.EcLevel>8 || request.Segment<0 || request.Segment>20)throw new ArgumentException("Barcode input exceeds supported bounds.");
  var translator=new Translator(sourceBytes);var type=translator.Build();var encoder=Activator.CreateInstance(type)!;
  void Set(string name,object value)=>type.GetMethod("set_"+name)!.Invoke(encoder,new[]{value});
  object Get(string name)=>type.GetMethod("get_"+name)!.Invoke(encoder,null)!;
  Set("PDFCode",System.Text.Encoding.Latin1.GetString(System.Text.Encoding.Latin1.GetBytes(request.Text)));Set("PDFColumns",request.Columns);Set("PDFRows",0);Set("PDFMaxRows",request.Rows);
  Set("PDFMode",0);Set("PDFLeftMargin",0);Set("PDFTopMargin",0);Set("PDFECLevel",request.EcLevel);Set("PDFBarWidth",request.BarWidth);Set("PDFBarHeight",request.BarHeight);
  if(request.MacroId!=null)Set("PDFMacroFileId",request.MacroId);else Set("PDFMacroFileId",new[]{1,1,3,0});
  type.GetMethod("resetMacroPDF")!.Invoke(encoder,null);
  if(request.Macro){EncoderDiagnostics.Precomputing=true;try{type.GetMethod("prepareMacroPDF")!.Invoke(encoder,null);}finally{EncoderDiagnostics.Precomputing=false;}}
  Set("PDFMacroSegment",request.Macro?request.Segment:-1);
  var canvas=new Canvas();type.GetMethod("paintBarCode")!.Invoke(encoder,new object[]{canvas});
  if(EncoderDiagnostics.Errors.Count>0)throw new InvalidOperationException("Original PDF417 encoder encountered an error; partial barcode output is rejected.",EncoderDiagnostics.Errors[0]);
  if(request.Text.Length>0 && canvas.Bars.Count==0)throw new InvalidOperationException("Original PDF417 encoder produced no bars for nonempty input.");
  Console.WriteLine(JsonSerializer.Serialize(new {bars=canvas.Bars,width=Get("PaintedWidth"),height=Get("PaintedHeight"),segments=Get("PDFMacroSegmentCount"),segment=Get("PDFMacroSegment"),sourceSha256=Convert.ToHexString(SHA256.HashData(sourceBytes)).ToLowerInvariant(),algorithm="Original J4L PDF417 CIL; UI/drawing types replaced by local line recorder; no Wine or GDI."},new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase}));
  return 0;
 }catch(Exception e){while(e is TargetInvocationException && e.InnerException!=null)e=e.InnerException;Console.Error.WriteLine(e);return 1;}}
 public record Input(string Text="",int Columns=14,int Rows=50,int EcLevel=4,int BarWidth=1,int BarHeight=3,bool Macro=false,int Segment=0,int[]? MacroId=null);
}
public class Translator : ISignatureTypeProvider<Type,object?> {
 readonly PEReader pe;readonly MetadataReader reader;readonly TypeBuilder type;
 readonly Dictionary<int,FieldBuilder> fields=new();readonly Dictionary<int,MethodBase> methods=new();
 readonly Dictionary<short,OpCode> codes=typeof(OpCodes).GetFields(BindingFlags.Public|BindingFlags.Static).Where(f=>f.FieldType==typeof(OpCode)).Select(f=>(OpCode)f.GetValue(null)!).ToDictionary(o=>o.Value);
 readonly Dictionary<string,OpCode> named=typeof(OpCodes).GetFields(BindingFlags.Public|BindingFlags.Static).Where(f=>f.FieldType==typeof(OpCode)).Select(f=>(OpCode)f.GetValue(null)!).ToDictionary(o=>o.Name!);
 public Translator(byte[] source){pe=new PEReader(new MemoryStream(source,false));reader=pe.GetMetadataReader();var ab=AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("OriginalPdf417Native"),AssemblyBuilderAccess.Run);type=ab.DefineDynamicModule("native").DefineType("Native.RPDF417",TypeAttributes.Public,typeof(ControlStub));}
 public Type Build(){
  var def=reader.GetTypeDefinition(MetadataTokens.TypeDefinitionHandle(7));
  foreach(var h in def.GetFields()){var d=reader.GetFieldDefinition(h);var f=type.DefineField(reader.GetString(d.Name),d.DecodeSignature(this,null),(d.Attributes & ~FieldAttributes.HasFieldRVA));fields[MetadataTokens.GetToken(h)]=f;if(d.Attributes.HasFlag(FieldAttributes.Literal)){var c=reader.GetConstant(d.GetDefaultValue());f.SetConstant(ReadConstant(c));}}
  foreach(var h in def.GetMethods()){
   var d=reader.GetMethodDefinition(h);var name=reader.GetString(d.Name);if(name is "OnPaint" or "saveToFile")continue;
   var sig=d.DecodeSignature(this,null);var attrs=(d.Attributes & ~(MethodAttributes.Abstract|MethodAttributes.Virtual|MethodAttributes.NewSlot)) ;
   if(name==".ctor")methods[MetadataTokens.GetToken(h)]=type.DefineConstructor(MethodAttributes.Public,CallingConventions.Standard,sig.ParameterTypes.ToArray());
   else methods[MetadataTokens.GetToken(h)]=type.DefineMethod(name,attrs,sig.ReturnType,sig.ParameterTypes.ToArray());
  }
  foreach(var h in def.GetMethods()){if(!methods.TryGetValue(MetadataTokens.GetToken(h),out var target))continue;var d=reader.GetMethodDefinition(h);var il=target is ConstructorBuilder cb?cb.GetILGenerator():((MethodBuilder)target).GetILGenerator();Emit(d,il);}
  return type.CreateType()!;
 }
 object? ReadConstant(Constant c){var b=reader.GetBlobReader(c.Value);return c.TypeCode switch{ConstantTypeCode.Int32=>b.ReadInt32(),ConstantTypeCode.Int64=>b.ReadInt64(),ConstantTypeCode.String=>b.ReadUTF16(b.Length),ConstantTypeCode.Boolean=>b.ReadBoolean(),_=>null};}
 record Instruction(int Offset,OpCode Op,object? Operand);
 void Emit(MethodDefinition method,ILGenerator il){
  var body=pe.GetMethodBody(method.RelativeVirtualAddress);var bytes=body.GetILBytes()!;
  var locals=body.LocalSignature.IsNil?Array.Empty<Type>():reader.GetStandaloneSignature(body.LocalSignature).DecodeLocalSignature(this,null).ToArray();foreach(var l in locals)il.DeclareLocal(l);
  var parsed=new List<Instruction>();int pos=0;
  int I4(){int n=BitConverter.ToInt32(bytes,pos);pos+=4;return n;}
  while(pos<bytes.Length){int offset=pos;short c=bytes[pos++];if(c==0xfe)c=(short)(0xfe00|bytes[pos++]);var op=codes[c];object? operand=null;
   switch(op.OperandType){
    case OperandType.InlineNone:break;
    case OperandType.ShortInlineI:operand=(sbyte)bytes[pos++];break;
    case OperandType.InlineI:operand=I4();break;
    case OperandType.InlineI8:operand=BitConverter.ToInt64(bytes,pos);pos+=8;break;
    case OperandType.ShortInlineR:operand=BitConverter.ToSingle(bytes,pos);pos+=4;break;
    case OperandType.InlineR:operand=BitConverter.ToDouble(bytes,pos);pos+=8;break;
    case OperandType.ShortInlineVar:operand=(short)bytes[pos++];break;
    case OperandType.InlineVar:operand=(short)BitConverter.ToUInt16(bytes,pos);pos+=2;break;
    case OperandType.ShortInlineBrTarget:var delta=(sbyte)bytes[pos++];operand=pos+delta;break;
    case OperandType.InlineBrTarget:var delta4=I4();operand=pos+delta4;break;
    case OperandType.InlineSwitch:int n=I4();var deltas=new int[n];for(int i=0;i<n;i++)deltas[i]=I4();operand=deltas.Select(x=>x+pos).ToArray();break;
    default:operand=I4();break;
   }
   parsed.Add(new(offset,op,operand));
  }
  var labels=parsed.ToDictionary(x=>x.Offset,_=>il.DefineLabel());labels[bytes.Length]=il.DefineLabel();
  var regions=body.ExceptionRegions;
  var starts=regions.GroupBy(r=>r.TryOffset).ToDictionary(g=>g.Key,g=>g.ToArray());
  var ends=regions.GroupBy(r=>r.HandlerOffset+r.HandlerLength).ToDictionary(g=>g.Key,g=>g.ToArray());
  foreach(var ins in parsed){
   int at=ins.Offset;
   if(ends.TryGetValue(at,out var ended))foreach(var r in ended.OrderBy(r=>r.TryOffset))il.EndExceptionBlock();
   if(starts.ContainsKey(at))il.BeginExceptionBlock();
   foreach(var r in regions){if(r.Kind==ExceptionRegionKind.Filter && r.FilterOffset==at)il.BeginExceptFilterBlock();if(r.HandlerOffset==at){if(r.Kind==ExceptionRegionKind.Filter)il.BeginCatchBlock(null);else if(r.Kind==ExceptionRegionKind.Catch)il.BeginCatchBlock(ResolveType(r.CatchType));else if(r.Kind==ExceptionRegionKind.Finally)il.BeginFinallyBlock();else if(r.Kind==ExceptionRegionKind.Fault)il.BeginFaultBlock();}}
   il.MarkLabel(labels[at]);var op=ins.Op;var operand=ins.Operand;
   if(op==OpCodes.Endfilter)continue; // BeginCatchBlock emits this terminator.
   switch(op.OperandType){
    case OperandType.InlineNone:il.Emit(op);break;
    case OperandType.ShortInlineI:il.Emit(op,(sbyte)operand!);break;
    case OperandType.InlineI:il.Emit(op,(int)operand!);break;
    case OperandType.InlineI8:il.Emit(op,(long)operand!);break;
    case OperandType.ShortInlineR:il.Emit(op,(float)operand!);break;
    case OperandType.InlineR:il.Emit(op,(double)operand!);break;
    case OperandType.ShortInlineVar:case OperandType.InlineVar:
     var index=(short)operand!;
     if(op.Name!.Contains("loc"))il.Emit(named[op.Name.Replace(".s","")],index);
     else il.Emit(named[op.Name.Replace(".s","")],index);
     break;
    case OperandType.ShortInlineBrTarget:case OperandType.InlineBrTarget:il.Emit(named[op.Name!.Replace(".s","")],labels[(int)operand!]);break;
    case OperandType.InlineSwitch:il.Emit(op,((int[])operand!).Select(x=>labels[x]).ToArray());break;
    case OperandType.InlineString:il.Emit(op,reader.GetUserString(MetadataTokens.UserStringHandle((int)operand! & 0xffffff)));break;
    case OperandType.InlineType:il.Emit(op,ResolveType(MetadataTokens.EntityHandle((int)operand!)));break;
    case OperandType.InlineField:il.Emit(op,ResolveField((int)operand!));break;
    case OperandType.InlineMethod:
     var m=ResolveMethod((int)operand!);if(m is ConstructorInfo ctor)il.Emit(op,ctor);else if(m is ConstructorBuilder cb)il.Emit(op,cb);else il.Emit(op,(MethodInfo)m);break;
    default:throw new NotSupportedException("Operand "+op);
   }
  }
  if(ends.ContainsKey(bytes.Length))foreach(var _ in ends[bytes.Length])il.EndExceptionBlock();il.MarkLabel(labels[bytes.Length]);
 }
 FieldInfo ResolveField(int token){if(fields.TryGetValue(token,out var own))return own;var d=reader.GetMemberReference((MemberReferenceHandle)MetadataTokens.EntityHandle(token));var t=ResolveType(d.Parent);return t.GetField(reader.GetString(d.Name),BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Instance)!;}
 MethodBase ResolveMethod(int token){
  if(methods.TryGetValue(token,out var own))return own;
  var h=MetadataTokens.EntityHandle(token);if(h.Kind!=HandleKind.MemberReference)throw new NotSupportedException("Method token "+token.ToString("x8"));
  var d=reader.GetMemberReference((MemberReferenceHandle)h);var t=ResolveType(d.Parent);var name=reader.GetString(d.Name);var sig=d.DecodeMethodSignature(this,null);var args=sig.ParameterTypes.ToArray();
  if(t==typeof(Microsoft.VisualBasic.CompilerServices.ProjectData) && name=="SetProjectError")return typeof(EncoderDiagnostics).GetMethod("SetProjectError")!;
  var result=(MethodBase?)(name==".ctor"?t.GetConstructor(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance,null,args,null):t.GetMethod(name,BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Instance,null,args,null));
  return result ?? throw new MissingMethodException(t.FullName,name+"("+string.Join(',',args.Select(a=>a.Name))+")");
 }
 Type ResolveType(EntityHandle h)=>h.Kind switch{HandleKind.TypeDefinition=>GetTypeFromDefinition(reader,(TypeDefinitionHandle)h,0),HandleKind.TypeReference=>GetTypeFromReference(reader,(TypeReferenceHandle)h,0),HandleKind.TypeSpecification=>GetTypeFromSpecification(reader,null,(TypeSpecificationHandle)h,0),_=>throw new NotSupportedException(h.Kind.ToString())};
 public Type GetTypeFromReference(MetadataReader r,TypeReferenceHandle h,byte kind){var d=r.GetTypeReference(h);var name=r.GetString(d.Namespace)+"."+r.GetString(d.Name);
  if(name.StartsWith("System.Windows.Forms."))return typeof(ControlStub);
  if(name=="System.Drawing.Graphics")return typeof(Canvas);if(name=="System.Drawing.Pen")return typeof(PenStub);
  return Type.GetType(name) ?? AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType(name)).FirstOrDefault(t=>t!=null) ?? Type.GetType(name+", System.Drawing.Primitives") ?? Type.GetType(name+", Microsoft.VisualBasic.Core") ?? throw new TypeLoadException(name);
 }
 public Type GetTypeFromDefinition(MetadataReader r,TypeDefinitionHandle h,byte kind)=>MetadataTokens.GetRowNumber(h)==7?type:typeof(int);
 public Type GetTypeFromSpecification(MetadataReader r,object? c,TypeSpecificationHandle h,byte k)=>r.GetTypeSpecification(h).DecodeSignature(this,c);
 public Type GetArrayType(Type t,ArrayShape shape)=>t.MakeArrayType(shape.Rank);
 public Type GetByReferenceType(Type t)=>t.MakeByRefType();public Type GetFunctionPointerType(MethodSignature<Type> s)=>throw new NotSupportedException();
 public Type GetGenericInstantiation(Type t,ImmutableArray<Type> args)=>t.MakeGenericType(args.ToArray());public Type GetGenericMethodParameter(object? c,int i)=>throw new NotSupportedException();public Type GetGenericTypeParameter(object? c,int i)=>throw new NotSupportedException();
 public Type GetModifiedType(Type modifier,Type t,bool required)=>t;public Type GetPinnedType(Type t)=>t;public Type GetPointerType(Type t)=>t.MakePointerType();public Type GetSZArrayType(Type t)=>t.MakeArrayType();
 public Type GetPrimitiveType(PrimitiveTypeCode c)=>c switch{PrimitiveTypeCode.Void=>typeof(void),PrimitiveTypeCode.Boolean=>typeof(bool),PrimitiveTypeCode.Char=>typeof(char),PrimitiveTypeCode.SByte=>typeof(sbyte),PrimitiveTypeCode.Byte=>typeof(byte),PrimitiveTypeCode.Int16=>typeof(short),PrimitiveTypeCode.UInt16=>typeof(ushort),PrimitiveTypeCode.Int32=>typeof(int),PrimitiveTypeCode.UInt32=>typeof(uint),PrimitiveTypeCode.Int64=>typeof(long),PrimitiveTypeCode.UInt64=>typeof(ulong),PrimitiveTypeCode.Single=>typeof(float),PrimitiveTypeCode.Double=>typeof(double),PrimitiveTypeCode.String=>typeof(string),PrimitiveTypeCode.Object=>typeof(object),PrimitiveTypeCode.IntPtr=>typeof(IntPtr),PrimitiveTypeCode.UIntPtr=>typeof(UIntPtr),_=>throw new NotSupportedException(c.ToString())};
}
