// Netlify Functions: API key stays in server-side environment variables.
const PROMPT = 'これは日本語の絵本の表紙写真です。表紙に印刷された書名・著者名・出版社名を正確に転記してください。タイトルに装飾や改行があっても自然な一続きの書名に整えてください。著者名に生年・没年などの数字を付けないでください。出版社が表紙に見えない場合は空文字にし、推測しないでください。読み取れない項目も空文字。JSONオブジェクトのみ返す: {"title":"","author":"","publisher":""}。';
const response = (statusCode, data) => ({statusCode, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return response(405,{error:{message:'POST only'}});
  const key = process.env.GEMINI_API_KEY;
  if(!key) return response(503,{error:{message:'Netlifyの環境変数 GEMINI_API_KEY が未設定です。'}});
  let image;
  try { image = JSON.parse(event.body||'{}').image; } catch { return response(400,{error:{message:'Invalid JSON'}}); }
  if(typeof image!=='string' || !/^[A-Za-z0-9+/=]+$/.test(image) || image.length>6500000) return response(400,{error:{message:'画像形式またはサイズが不正です。'}});
  const preferred=(process.env.GEMINI_MODEL||'gemini-2.5-flash-lite').replace(/^models\//,'');
  const models=[preferred,...['gemini-2.5-flash','gemini-2.0-flash'].filter(x=>x!==preferred)];
  const body={contents:[{parts:[{text:PROMPT},{inline_data:{mime_type:'image/jpeg',data:image}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}};
  let last;
  for(const model of models){
    try {
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),26000);
      let res;
      try {res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:ctrl.signal});} finally{clearTimeout(timer);}
      const data=await res.json().catch(()=>({}));
      if(res.ok)return response(200,data);
      last={status:res.status,message:data.error?.message||`HTTP ${res.status}`};
      if(![400,404].includes(res.status))break;
    } catch(e){last={status:502,message:e.name==='AbortError'?'AI応答がタイムアウトしました':e.message};break;}
  }
  return response(last?.status===429?429:502,{error:{message:last?.message||'AI呼び出しに失敗しました'}});
};
