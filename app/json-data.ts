// A host may serve a .gz file as bytes or transparently decode Content-Encoding.
// Inspect the payload so both paths preserve exactly the same source records.
export async function decodedJSON(response:Response){
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===0x1f&&bytes[1]===0x8b)return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  return JSON.parse(new TextDecoder().decode(bytes));
}
