from pathlib import Path
import sys

from PIL import Image, ImageDraw


source_directory = Path(sys.argv[1])
output_path = Path(sys.argv[2])
tile_width = int(sys.argv[3]) if len(sys.argv) > 3 else 120
tile_height = tile_width * 4 // 3
gap = max(8, tile_width // 8)
label_height = max(18, tile_width // 5)
margin = gap

suits = ("wan", "tiao", "tong")
canvas_width = margin * 2 + tile_width * 9 + gap * 8
row_height = tile_height + label_height
canvas_height = margin * 2 + row_height * 3 + gap * 2
canvas = Image.new("RGB", (canvas_width, canvas_height), "#d8d2c4")
draw = ImageDraw.Draw(canvas)

for row, suit in enumerate(suits):
    for column, rank in enumerate(range(1, 10)):
        thumbnail = Image.open(source_directory / f"{suit}-{rank}.svg.png").convert("RGB")
        inset = thumbnail.width // 8
        tile = thumbnail.crop((inset, 0, thumbnail.width - inset, thumbnail.height))
        tile = tile.resize((tile_width, tile_height), Image.Resampling.LANCZOS)

        x = margin + column * (tile_width + gap)
        y = margin + row * (row_height + gap)
        canvas.paste(tile, (x, y))
        draw.rectangle((x, y, x + tile_width - 1, y + tile_height - 1), outline="#b7ad9c", width=1)
        draw.text((x + 4, y + tile_height + 2), f"{suit}-{rank}", fill="#3f3a34")

canvas.save(output_path)
