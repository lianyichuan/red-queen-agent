#!/bin/bash
# Optional image generation helper; credentials are supplied through the environment.
# 用法: gen.sh <输出文件> <姿势描述>
KEY="${IMAGE_API_KEY:?Set IMAGE_API_KEY before generating images}"
BASE_URL="${IMAGE_API_BASE_URL:?Set IMAGE_API_BASE_URL to your image API endpoint}"
OUT="${1:?Usage: gen.sh output.png pose-description}"
POSE="${2:?Provide a pose description}"
CHAR="生化危机电影里保护伞公司的人工智能「红后」，全息投影屏幕中的少女形象：深色短发、黑色发箍、黑色哥特连衣裙、苍白皮肤、表情冷静冷淡。全身立绘，从头到脚完整，"
TAIL="纯绿色纯色背景（绿幕），3D动漫渲染风格。"
PROMPT="${CHAR}${POSE}${TAIL}"

for i in 1 2 3 4 5 6 7 8; do
  echo "[gen] 第 $i 次尝试: ${POSE:0:20}..."
  RID="javis-$(date +%s)-$RANDOM"
  RESP=$(curl -sS -m 180 -X POST "${BASE_URL%/}/images/generations" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "X-Request-Id: $RID" \
    -d "$(jq -n --arg p "$PROMPT" '{model:"gpt-image-2", prompt:$p, size:"1024x1536"}')")
  URL=$(echo "$RESP" | jq -r '.data[0].url // empty' 2>/dev/null)
  if [ -n "$URL" ]; then
    echo "[gen] 成功，下载: $URL"
    curl -sS -m 120 -o "$OUT" "$URL" && \
      [ "$(stat -f%z "$OUT")" -gt 50000 ] && echo "[gen] ✓ $OUT ($(stat -f%z "$OUT")B)" && exit 0
  fi
  echo "[gen] 失败: $(echo "$RESP" | head -c 200)"
  sleep 4
done
echo "[gen] ✗ 8 次尝试均失败"
exit 1
