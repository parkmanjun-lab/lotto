"""Option02: exact Noto Sans CJK KR Bold digit outlines, rendered as in the approved 3x mockup."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
font=ImageFont.truetype('design/readable-numbers/LottoReadableDigits-Bold.otf',60)
out=Path('public/numbers-v21');out.mkdir(parents=True,exist_ok=True)
for n in range(1,46):
 im=Image.new('RGBA',(114,114),(0,0,0,0));d=ImageDraw.Draw(im);t=str(n)
 l,top,r,bottom=d.textbbox((0,0),t,font=font)
 d.text((57-d.textlength(t,font=font)/2,57-(top+bottom)/2),t,font=font,fill='#24313A')
 im.save(out/f'{n}.png',optimize=True)
print('45 option02 digit assets rendered at 3x, 20px/38px ratio.')
