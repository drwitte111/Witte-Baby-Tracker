import math
from urllib.parse import quote

# ---------------- balls ----------------
def soccer(cx, cy, r, uid):
    pts = lambda n, rad, rot: [(cx + rad*math.cos(math.radians(rot + 360*i/n)), cy + rad*math.sin(math.radians(rot + 360*i/n))) for i in range(n)]
    poly = lambda ps: 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in ps) + 'Z'
    s = f'<defs><radialGradient id="sg{uid}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#e9e9ea"/><stop offset="1" stop-color="#b9babe"/></radialGradient>'
    s += f'<clipPath id="sc{uid}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath></defs>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#sg{uid})"/>'
    s += f'<g clip-path="url(#sc{uid})">'
    inner = pts(5, r*0.33, -90)
    s += f'<path d="{poly(inner)}" fill="#26282c"/>'
    for i, (x, y) in enumerate(inner):
        # seam from each vertex outward, ending at an outer pentagon
        ang = math.radians(-90 + 72*i)
        ox, oy = cx + r*0.92*math.cos(ang), cy + r*0.92*math.sin(ang)
        s += f'<path d="M{x:.1f} {y:.1f} L{ox:.1f} {oy:.1f}" stroke="#26282c" stroke-width="{r*0.06:.1f}" stroke-linecap="round"/>'
        opts = [(ox + r*0.36*math.cos(math.radians(-90 + 72*i + 36 + 72*k)), oy + r*0.36*math.sin(math.radians(-90 + 72*i + 36 + 72*k))) for k in range(5)]
        s += f'<path d="{poly(opts)}" fill="#26282c"/>'
    s += '</g>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#9a9ba0" stroke-width="{r*0.05:.1f}"/>'
    s += f'<ellipse cx="{cx - r*0.3:.1f}" cy="{cy - r*0.4:.1f}" rx="{r*0.28:.1f}" ry="{r*0.16:.1f}" fill="#fff" fill-opacity=".5" transform="rotate(-30 {cx - r*0.3:.1f} {cy - r*0.4:.1f})"/>'
    return s

def basketball(cx, cy, r, uid):
    s = f'<defs><radialGradient id="bg{uid}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ff9c55"/><stop offset="0.6" stop-color="#e8672a"/><stop offset="1" stop-color="#a63f12"/></radialGradient><clipPath id="bc{uid}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath></defs>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#bg{uid})"/>'
    sw = r*0.075
    s += f'<g clip-path="url(#bc{uid})" fill="none" stroke="#3a1a0a" stroke-width="{sw:.1f}" stroke-linecap="round">'
    s += f'<path d="M{cx-r} {cy} H{cx+r} M{cx} {cy-r} V{cy+r}"/>'
    s += f'<path d="M{cx-r*0.78:.1f} {cy-r*0.9:.1f} C{cx-r*0.05:.1f} {cy-r*0.3:.1f} {cx-r*0.05:.1f} {cy+r*0.3:.1f} {cx-r*0.78:.1f} {cy+r*0.9:.1f}"/>'
    s += f'<path d="M{cx+r*0.78:.1f} {cy-r*0.9:.1f} C{cx+r*0.05:.1f} {cy-r*0.3:.1f} {cx+r*0.05:.1f} {cy+r*0.3:.1f} {cx+r*0.78:.1f} {cy+r*0.9:.1f}"/></g>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#7a2e0c" stroke-width="{r*0.05:.1f}"/>'
    s += f'<ellipse cx="{cx - r*0.32:.1f}" cy="{cy - r*0.42:.1f}" rx="{r*0.26:.1f}" ry="{r*0.14:.1f}" fill="#fff" fill-opacity=".35" transform="rotate(-30 {cx - r*0.32:.1f} {cy - r*0.42:.1f})"/>'
    return s

def baseball(cx, cy, r, uid):
    s = f'<defs><radialGradient id="ba{uid}" cx="35%" cy="30%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.75" stop-color="#eeeeee"/><stop offset="1" stop-color="#c2c2c4"/></radialGradient></defs>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#ba{uid})" stroke="#b9b9bc" stroke-width="{r*0.05:.1f}"/>'
    def seam(sign):
        # curved seam; stitches as short ticks across it
        p0 = (cx + sign*r*0.62, cy - r*0.8); c1 = (cx - sign*r*0.35, cy - r*0.45); c2 = (cx - sign*r*0.35, cy + r*0.45); p3 = (cx + sign*r*0.62, cy + r*0.8)
        d = f'M{p0[0]:.1f} {p0[1]:.1f} C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p3[0]:.1f} {p3[1]:.1f}'
        out = f'<path d="{d}" fill="none" stroke="#c8312f" stroke-width="{r*0.06:.1f}"/>'
        def bez(t):
            mt = 1-t
            return (mt**3*p0[0] + 3*mt*mt*t*c1[0] + 3*mt*t*t*c2[0] + t**3*p3[0], mt**3*p0[1] + 3*mt*mt*t*c1[1] + 3*mt*t*t*c2[1] + t**3*p3[1])
        for k in range(1, 10):
            t = k/10; x, y = bez(t); x2, y2 = bez(min(1, t+0.01)); ang = math.atan2(y2-y, x2-x) + math.pi/2
            L = r*0.14
            out += f'<path d="M{x - L*math.cos(ang+0.5):.1f} {y - L*math.sin(ang+0.5):.1f} L{x + L*math.cos(ang-0.5):.1f} {y + L*math.sin(ang-0.5):.1f}" stroke="#c8312f" stroke-width="{r*0.05:.1f}" stroke-linecap="round"/>'
        return out
    s += seam(1) + seam(-1)
    return s

def football(cx, cy, r, uid, rot=-25):
    rx, ry = r*1.55, r*0.9
    s = f'<defs><radialGradient id="fb{uid}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#b8683a"/><stop offset="0.65" stop-color="#8a4420"/><stop offset="1" stop-color="#4f2410"/></radialGradient><clipPath id="fc{uid}"><ellipse cx="{cx}" cy="{cy}" rx="{rx:.1f}" ry="{ry:.1f}"/></clipPath></defs>'
    s += f'<g transform="rotate({rot} {cx} {cy})">'
    s += f'<ellipse cx="{cx}" cy="{cy}" rx="{rx:.1f}" ry="{ry:.1f}" fill="url(#fb{uid})"/>'
    s += f'<g clip-path="url(#fc{uid})"><path d="M{cx-rx*0.62:.1f} {cy-ry*1.3:.1f} V{cy+ry*1.3:.1f} M{cx-rx*0.72:.1f} {cy-ry*1.3:.1f} V{cy+ry*1.3:.1f} M{cx+rx*0.62:.1f} {cy-ry*1.3:.1f} V{cy+ry*1.3:.1f} M{cx+rx*0.72:.1f} {cy-ry*1.3:.1f} V{cy+ry*1.3:.1f}" stroke="#f3f0ea" stroke-width="{r*0.07:.1f}"/></g>'
    s += f'<path d="M{cx-rx:.1f} {cy} Q{cx} {cy-ry*0.55:.1f} {cx+rx:.1f} {cy}" fill="none" stroke="#f3f0ea" stroke-width="{r*0.05:.1f}" stroke-opacity=".7"/>'
    s += f'<path d="M{cx-r*0.55:.1f} {cy} H{cx+r*0.55:.1f}" stroke="#f3f0ea" stroke-width="{r*0.09:.1f}" stroke-linecap="round"/>'
    for k in range(-2, 3):
        x = cx + k*r*0.24
        s += f'<path d="M{x:.1f} {cy-r*0.2:.1f} V{cy+r*0.2:.1f}" stroke="#f3f0ea" stroke-width="{r*0.08:.1f}" stroke-linecap="round"/>'
    s += f'<ellipse cx="{cx - rx*0.3:.1f}" cy="{cy - ry*0.45:.1f}" rx="{rx*0.3:.1f}" ry="{ry*0.14:.1f}" fill="#fff" fill-opacity=".22"/></g>'
    return s

def tennis(cx, cy, r, uid):
    s = f'<defs><radialGradient id="tn{uid}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#eaff6a"/><stop offset="0.6" stop-color="#c9e63a"/><stop offset="1" stop-color="#7f9a12"/></radialGradient><clipPath id="tc{uid}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath></defs>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#tn{uid})" stroke="#8ea51b" stroke-width="{r*0.05:.1f}"/>'
    s += f'<g clip-path="url(#tc{uid})" fill="none" stroke="#fbfbf0" stroke-width="{r*0.12:.1f}" stroke-linecap="round">'
    s += f'<path d="M{cx-r*1.05:.1f} {cy-r*0.25:.1f} C{cx-r*0.2:.1f} {cy-r*0.15:.1f} {cx+r*0.05:.1f} {cy+r*0.55:.1f} {cx+r*0.35:.1f} {cy+r*1.1:.1f}"/>'
    s += f'<path d="M{cx+r*1.05:.1f} {cy+r*0.25:.1f} C{cx+r*0.2:.1f} {cy+r*0.15:.1f} {cx-r*0.05:.1f} {cy-r*0.55:.1f} {cx-r*0.35:.1f} {cy-r*1.1:.1f}"/></g>'
    s += f'<ellipse cx="{cx - r*0.3:.1f}" cy="{cy - r*0.42:.1f}" rx="{r*0.25:.1f}" ry="{r*0.13:.1f}" fill="#fff" fill-opacity=".4" transform="rotate(-30 {cx - r*0.3:.1f} {cy - r*0.42:.1f})"/>'
    return s

# ---------------- flowers ----------------
def petal(cx, cy, ang, L, W, fill):
    # teardrop petal from centre outward
    a = math.radians(ang)
    tx, ty = cx + L*math.cos(a), cy + L*math.sin(a)
    px, py = -math.sin(a)*W, math.cos(a)*W
    mx, my = cx + L*0.55*math.cos(a), cy + L*0.55*math.sin(a)
    return f'<path d="M{cx:.1f} {cy:.1f} C{mx+px:.1f} {my+py:.1f} {tx+px*0.35:.1f} {ty+py*0.35:.1f} {tx:.1f} {ty:.1f} C{tx-px*0.35:.1f} {ty-py*0.35:.1f} {mx-px:.1f} {my-py:.1f} {cx:.1f} {cy:.1f}Z" fill="{fill}"/>'

def daisy(cx, cy, r, uid, c1='#ff9ec4', c2='#ff5f9e', n=12, rot=0):
    s = f'<defs><radialGradient id="dp{uid}" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></radialGradient><radialGradient id="dc{uid}"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#e7a500"/></radialGradient></defs>'
    for i in range(n):
        s += petal(cx, cy, rot + 360*i/n, r, r*0.22, f'url(#dp{uid})')
    for i in range(n):
        s += petal(cx, cy, rot + 360*i/n + 180/n, r*0.8, r*0.18, c1)
    s += f'<circle cx="{cx}" cy="{cy}" r="{r*0.3:.1f}" fill="url(#dc{uid})"/>'
    for i in range(10):
        a = math.radians(36*i + 10); rr = r*0.18
        s += f'<circle cx="{cx + rr*math.cos(a):.1f}" cy="{cy + rr*math.sin(a):.1f}" r="{r*0.035:.1f}" fill="#b47600"/>'
    return s

def blossom(cx, cy, r, uid, rot=0):
    # five notched petals, cherry-blossom style
    s = f'<defs><radialGradient id="bp{uid}" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#ffd9e6"/><stop offset="0.6" stop-color="#ffb3cf"/><stop offset="1" stop-color="#f27aa6"/></radialGradient></defs>'
    for i in range(5):
        a = math.radians(rot + 72*i)
        tx, ty = cx + r*math.cos(a), cy + r*math.sin(a)
        px, py = -math.sin(a)*r*0.45, math.cos(a)*r*0.45
        nx, ny = cx + r*0.82*math.cos(a), cy + r*0.82*math.sin(a)    # notch
        s += (f'<path d="M{cx:.1f} {cy:.1f} C{cx+px+ (tx-cx)*0.4:.1f} {cy+py+(ty-cy)*0.4:.1f} {tx+px*0.7:.1f} {ty+py*0.7:.1f} {nx:.1f} {ny:.1f} '
              f'C{tx-px*0.7:.1f} {ty-py*0.7:.1f} {cx-px+(tx-cx)*0.4:.1f} {cy-py+(ty-cy)*0.4:.1f} {cx:.1f} {cy:.1f}Z" fill="url(#bp{uid})"/>')
    for i in range(8):
        a = math.radians(45*i + rot)
        s += f'<path d="M{cx:.1f} {cy:.1f} L{cx + r*0.35*math.cos(a):.1f} {cy + r*0.35*math.sin(a):.1f}" stroke="#d9457e" stroke-width="{r*0.04:.1f}"/><circle cx="{cx + r*0.38*math.cos(a):.1f}" cy="{cy + r*0.38*math.sin(a):.1f}" r="{r*0.05:.1f}" fill="#ffd54a"/>'
    return s

def rose(cx, cy, r, uid):
    s = f'<defs><radialGradient id="rp{uid}" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="#ff7fb0"/><stop offset="1" stop-color="#d81b60"/></radialGradient></defs>'
    for ring, (scale, rot, n, col) in enumerate([(1.0, 0, 6, '#e63a7e'), (0.72, 30, 6, '#ee5590'), (0.48, 0, 5, '#f571a3'), (0.28, 36, 4, '#fb8fb9')]):
        for i in range(n):
            s += petal(cx, cy, rot + 360*i/n, r*scale, r*scale*0.5, col)
    s += f'<circle cx="{cx}" cy="{cy}" r="{r*0.14:.1f}" fill="#c2185b"/>'
    return s

def heart(cx, cy, s_, uid, rot=0):
    d = (f'M{cx} {cy + s_*0.95} C{cx - s_*1.7} {cy - s_*0.1} {cx - s_*0.95} {cy - s_*1.35} {cx} {cy - s_*0.55} '
         f'C{cx + s_*0.95} {cy - s_*1.35} {cx + s_*1.7} {cy - s_*0.1} {cx} {cy + s_*0.95}Z')
    return (f'<defs><radialGradient id="hg{uid}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ff8fb8"/><stop offset="0.7" stop-color="#f0417a"/><stop offset="1" stop-color="#b8114c"/></radialGradient></defs>'
            f'<g transform="rotate({rot} {cx} {cy})"><path d="{d}" fill="url(#hg{uid})"/>'
            f'<ellipse cx="{cx - s_*0.55:.1f}" cy="{cy - s_*0.6:.1f}" rx="{s_*0.28:.1f}" ry="{s_*0.16:.1f}" fill="#fff" fill-opacity=".55" transform="rotate(-35 {cx - s_*0.55:.1f} {cy - s_*0.6:.1f})"/></g>')

def leaf(cx, cy, L, rot, uid):
    return (f'<g transform="rotate({rot} {cx} {cy})"><path d="M{cx} {cy} q{L*0.45:.1f} -{L*0.5:.1f} {L:.1f} 0 q-{L*0.55:.1f} {L*0.5:.1f} -{L:.1f} 0z" fill="#6cbf6a"/>'
            f'<path d="M{cx} {cy} L{cx+L:.1f} {cy}" stroke="#3f8f3d" stroke-width="{L*0.05:.1f}"/></g>')

def girl_tile(size=200):
    s = f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
    s += leaf(20, 42, 22, -40, 'l1') + leaf(118, 36, 20, 30, 'l2') + leaf(72, 120, 22, -20, 'l3') + leaf(160, 128, 18, 50, 'l4') + leaf(28, 170, 20, 10, 'l5')
    s += daisy(34, 34, 22, 'a', rot=8) + blossom(112, 46, 20, 'b', rot=-12) + rose(60, 100, 18, 'c') + heart(150, 92, 12, 'd', rot=-12)
    s += blossom(30, 150, 17, 'e', rot=20) + daisy(120, 150, 20, 'f', c1='#ffd1e3', c2='#ff8ab8', rot=-8) + heart(176, 176, 10, 'g', rot=10) + heart(84, 176, 8, 'h', rot=-6) + rose(178, 30, 13, 'i')
    return s + '</svg>'

def boy_tile(size=210):
    s = f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
    s += soccer(36, 38, 24, 'a') + basketball(126, 40, 24, 'b') + baseball(64, 120, 19, 'c') + football(150, 118, 17, 'd') + tennis(40, 176, 15, 'e') + basketball(112, 186, 16, 'f') + soccer(192, 184, 16, 'g') + baseball(190, 60, 12, 'h')
    return s + '</svg>'

def css_url(svg): return 'url("data:image/svg+xml,' + quote(svg, safe="/:=,.() -_") + '")'

if __name__ == '__main__':
    open('/tmp/art/girl.svg', 'w').write(girl_tile()); open('/tmp/art/boy.svg', 'w').write(boy_tile())
    print('tiles written', len(girl_tile()), len(boy_tile()))
