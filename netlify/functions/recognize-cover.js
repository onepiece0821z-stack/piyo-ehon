
const PROMPT = `
これは日本語の絵本の表紙写真です。
表紙に印刷されている文字を読み取り、
次の情報を抽出してください。

・title：絵本のタイトル
・author：著者名（作・絵などを含む）
・publisher：出版社名

著者名に生年や余計な説明を付けないでください。
不明な項目は空文字にしてください。

以下のJSONオブジェクトのみ返してください。
{"title":"","author":"","publisher":""}
`;

const reply = (statusCode, data) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  },
  body: JSON.stringify(data)
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return reply(405, {
      error: { message: "POSTのみ対応しています。" }
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return reply(503, {
      error: { message: "GEMINI_API_KEYが設定されていません。" }
    });
  }

  let image;

  try {
    const input = JSON.parse(event.body || "{}");
    image = input.image;
  } catch {
    return reply(400, {
      error: { message: "リクエストの形式が不正です。" }
    });
  }

  if (typeof image !== "string") {
    return reply(400, {
      error: { message: "画像データがありません。" }
    });
  }

  const match = image.match(
    /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/
  );

  const mimeType = match
    ? `image/${match[1] === "jpg" ? "jpeg" : match[1]}`
    : "image/jpeg";

  const imageData = match ? match[2] : image;

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
    return reply(400, {
      error: { message: "画像形式が不正です。" }
    });
  }

  const preferred = (
    process.env.GEMINI_MODEL || "gemini-2.5-flash"
  ).replace(/^models\//, "");

  const models = [...new Set([
    preferred,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
  ])];

  let lastError = "AI認識に失敗しました。";

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        }),
        signal: controller.signal
      });

      const data = await response.json();

      if (response.ok) {
        return reply(200, data);
      }

      lastError =
        data.error?.message ||
        `Gemini API HTTP ${response.status}`;

      if (![400, 404].includes(response.status)) {
        break;
      }

    } catch (error) {
      lastError =
        error.name === "AbortError"
          ? "AI認識がタイムアウトしました。"
          : error.message;

      break;
    } finally {
      clearTimeout(timer);
    }
  }

  return reply(502, {
    error: { message: lastError }
  });
};

