"""Inspect rendered screenshot pixels, independent of canvas origin/readback policy."""
import io, sys
from PIL import Image
image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
print(sum(1 for r,g,b in image.getdata() if 20 <= r <= 85 and 95 <= g <= 105 and 195 <= b <= 205))
