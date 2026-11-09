from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import hashlib
original=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',60,index=1)
size=0
for n in range(1,46):
 expected=Image.new('RGBA',(114,114),(0,0,0,0));d=ImageDraw.Draw(expected);t=str(n);l,top,r,bottom=d.textbbox((0,0),t,font=original)
 d.text((57-d.textlength(t,font=original)/2,57-(top+bottom)/2),t,font=original,fill='#24313A')
 file=Path(f'public/numbers-v21/{n}.png');actual=Image.open(file)
 assert actual.tobytes()==expected.tobytes(),n
 box=actual.getbbox();assert box and 0<box[0]<box[2]<114 and 0<box[1]<box[3]<114
 size+=file.stat().st_size
print('45 assets match original approved font rendering exactly; total bytes',size)
