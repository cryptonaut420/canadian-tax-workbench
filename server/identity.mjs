export function isValidSin(value){
  if(typeof value!=='string' || !/^(?:[0-9]{9}|[0-9]{3} [0-9]{3} [0-9]{3}|[0-9]{3}-[0-9]{3}-[0-9]{3})$/.test(value))return false;
  const digits=value.replace(/[ -]/g,'');if(digits.length!==9 || /^0{9}$/.test(digits))return false;
  const sum=[...digits].reduce((total,digit,index)=>{let n=Number(digit)*(index%2?2:1);return total+(n>9?n-9:n);},0);
  return sum%10===0;
}
