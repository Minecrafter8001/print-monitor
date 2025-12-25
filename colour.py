from PIL import Image
import sys

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def clamp(value):
    return max(0, min(255, value))

def apply_rgb_offset(image, offset):
    pixels = image.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y][:3]

            new_r = clamp(r + offset[0])
            new_g = clamp(g + offset[1])
            new_b = clamp(b + offset[2])

            if len(pixels[x, y]) == 4:
                a = pixels[x, y][3]
                pixels[x, y] = (new_r, new_g, new_b, a)
            else:
                pixels[x, y] = (new_r, new_g, new_b)

    return image

def main(input_path, output_path):
    origin_hex = "#333333"
    set_hex = "#283c75"

    origin_rgb = hex_to_rgb(origin_hex)
    set_rgb = hex_to_rgb(set_hex)

    offset = (
        set_rgb[0] - origin_rgb[0],
        set_rgb[1] - origin_rgb[1],
        set_rgb[2] - origin_rgb[2],
    )

    image = Image.open(input_path).convert("RGBA")
    image = apply_rgb_offset(image, offset)
    image.save(output_path)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python colour_offset.py input.png output.png")
        sys.exit(1)

    main(sys.argv[1], sys.argv[2])
