// Netlify Function: keep GEMINI_API_KEY only in Netlify environment variables.
const PROMPT = `これは絵本の表紙写真です。日本語・英語を含む、表紙に印刷された書名、著者名、出版社名を読み取ってください。タイトルは自然な一続きの書名にしてください。
著者名の先頭にある役割表記（例：作、文、絵、作・絵、え・、さく、Written by、Illustrated by、Story by、By）は著者名に含めず、人名だけを返してください。作家とイラストレーターが異なる場合は両方の人名を「 / 」で区切ってください。
ただし Dr. Seuss の Dr. など人名そのものの一部は絶対に削除しないでください。生年・没年や説明は加えないでください。出版社が表紙に見えない場合は推測せず空文字にしてください。
次のJSONオブジェクトのみ返してください：{"title":"","author":"","publisher":""}`;
// Normalize role prefixes only, never remove honorifics or parts of a person's name.
const cleanAuthor = value => {
  if (typeof value !== 'string') return '';
  const parts = value.split(/\s+(?:\/|＆|&)\s+|\s*;\s*/u);
  return parts.map(part => {
    let s = part.trim();
    for (let i = 0; i < 3; i++) {
      const before = s;
      s = s.replace(/^(?:(?:作(?:者)?|文|絵|え|さく|えとぶん|作[・\/＆&]絵|文[・\/＆&]絵|作画|イラスト|著|訳|翻訳)\s*[：:・･.．\-–—]?\s*)/u, '');
      s = s.replace(/^(?:(?:written|illustrated|story|pictures|art|text|illustrations|translated)\s+by|by)\s*[:：\-–—]?\s+/iu, '');
      if (before === s) break;
    }
    return s.trim();
  }).filter(Boolean).join(' / ');
};

const reply = (statusCode, data) => ({statusCode, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
exports.handler = async event => {
  if(event.httpMethod !== 'POST') return reply(405,{error:{message:'POST only'}});
  const key=process.env.GEMINI_API_KEY;
  if(!key)return reply(503,{error:{message:'Netlifyの環境変数 GEMINI_API_KEY が未設定です。'}});
  let data;
  try{data=JSON.parse(event.body||'{}').image;}catch{return reply(400,{error:{message:'Invalid JSON'}});}
  if(typeof data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(data)||data.length>6500000)return reply(400,{error:{message:'画像形式またはサイズが不正です。'}});
  const preferred=(process.env.GEMINI_MODEL||'gemini-3.5-flash-lite').replace(/^models\//,'');
  // Use supported image-understanding models; skip obsolete 2.0 models even if configured.
  const models=[...new Set([preferred,'gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3.1-flash-lite'].filter(m=>!/^gemini-(1\.|2\.0)/.test(m)))];
  const payload={contents:[{parts:[{text:PROMPT},{inline_data:{mime_type:'image/jpeg',data}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}};
  let last='AIサービスが一時的に利用できません。';
  // Total deadline avoids indefinite waiting and keeps Netlify execution bounded.
  const deadline=Date.now()+48000;
  for(const model of models){
    for(let attempt=0;attempt<2;attempt++){
      const remaining=deadline-Date.now();if(remaining<4000)break;
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),Math.min(14000,remaining-1000));
      try{
        const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(payload),signal:ctrl.signal});
        const json=await res.json().catch(()=>({}));
        if(res.ok){
          // Preserve Gemini response format expected by the existing front end.
          // Rewrite only the author field in the returned JSON text.
          const parts=json.candidates?.[0]?.content?.parts;
          if(Array.isArray(parts)) for(const part of parts){
            if(typeof part.text!=='string')continue;
            try{
              const parsed=JSON.parse(part.text);
              if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&typeof parsed.author==='string'){
                parsed.author=cleanAuthor(parsed.author);
                part.text=JSON.stringify(parsed);
              }
            }catch{};
          }
          return reply(200,json);
        }
        last=json.error?.message||`HTTP ${res.status}`;
        if(res.status===401||res.status===403)return reply(res.status,{error:{message:last}});
        if(res.status===429||res.status===500||res.status===502||res.status===503||res.status===504){if(attempt===0&&deadline-Date.now()>7000)await sleep(1100);continue;}
        // Invalid or unavailable model: try the next model, not the same one.
        break;
      }catch(e){last=e.name==='AbortError'?'AI応答がタイムアウトしました':e.message;if(attempt===0&&deadline-Date.now()>7000)await sleep(900);}
      finally{clearTimeout(timer);}
    }
  }
  return reply(503,{error:{message:'AIが混雑しているか、現在のキーで利用できるモデルがありません。しばらく後にもう一度お試しください。詳細: '+last}});
};
