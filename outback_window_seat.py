"""
============================================================================
 OUTBACK WINDOW SEAT — a kangaroo-spotting flight "simulator"
============================================================================
 You are a passenger on a regional flight over inland Australia, looking
 out a right-hand window seat. Red dirt, scrub, dry riverbeds and dirt
 roads drift past below. Spot kangaroo mobs on the ground and log a
 sighting with the Xbox controller A button (or SPACE on the keyboard).

 FRAMEWORK CHOICE: Pygame (2.x), using a hand-rolled perspective
 projection rather than a 3D engine. For a fixed side-window camera this
 is faster, lighter, and far more portable than Ursina/Panda3D — the
 whole world is points projected with x = f * (along-track offset /
 lateral distance), y = horizon + f * (altitude / lateral distance).

 DEPENDENCIES (Python 3.9+):
     pip install pygame
 RUN:
     python outback_window_seat.py
 CONTROLS:
     Xbox controller A button  -> log a kangaroo sighting
     SPACE                     -> same (keyboard fallback)
     ESC / window close        -> quit
 OPTIONAL:
     python outback_window_seat.py --smoke-test   (runs 180 frames
     headlessly and exits; used for automated testing)
 WEB: the main loop is async so the same file runs in the browser as
     WebAssembly via pygbag (see README.md).
============================================================================
"""

import asyncio
import math
import os
import random
import sys

import pygame

# ============================================================================
# SECTION 1 — CONFIGURATION CONSTANTS
# ============================================================================

SCREEN_W, SCREEN_H = 800, 600        # low-res, performance-first
FPS = 60

# The world is rendered to an oversized "scene" surface so that the subtle
# banking rotation never reveals empty corners behind the window frame.
SCENE_W, SCENE_H = 1000, 760
SCENE_CX, SCENE_CY = SCENE_W // 2, SCENE_H // 2

FOCAL = 620.0                        # focal length in pixels
HORIZON_Y = int(SCENE_H * 0.36)      # horizon height on the scene surface
ALTITUDE = 1100.0                    # camera height above ground (world units)
PLANE_SPEED = 175.0                  # forward speed (world units / second)

# Lateral distance band of visible ground (world units, out the window)
D_NEAR, D_FAR = 1450.0, 9500.0

# Object world sizes (deliberately stylised so things read at altitude)
TREE_HEIGHT = (30, 70)
SCRUB_SIZE = (8, 26)
ROO_SIZE = 16.0

# Population / spawn tuning
N_TREES_TARGET = 130
N_SCRUB_TARGET = 220
MOB_SPAWN_MEAN_S = 4.5               # average seconds between mob spawns
MOB_COUNT_RANGE = (1, 7)

# Window aperture (the visible "glass" region) on the final 800x600 screen
APERTURE = pygame.Rect(120, 65, 560, 470)
APERTURE_RADIUS = 150

# --- Outback colour palette ---------------------------------------------
SKY_TOP = (140, 178, 205)            # washed-out blue
SKY_HORIZON = (228, 216, 188)        # dusty haze
GROUND_HORIZON = (213, 168, 124)     # pale baked earth in the distance
GROUND_NEAR = (158, 78, 44)          # deep red ochre up close
ROAD_COLOUR = (208, 178, 134)        # graded dirt road
RIVER_COLOUR = (186, 150, 108)       # dry sandy riverbed
RIVER_EDGE = (120, 96, 70)
TREE_CANOPY = [(106, 118, 76), (92, 108, 70), (118, 124, 82)]   # muted eucalypt greens
TREE_TRUNK = (98, 86, 74)
SCRUB_COLOURS = [(140, 130, 86), (122, 118, 78), (150, 132, 92), (170, 120, 80)]
ROO_BODY = (122, 74, 52)
ROO_SHADOW = (90, 50, 32)
FUSELAGE = (197, 199, 204)
FUSELAGE_DARK = (148, 151, 158)
HUD_TEXT = (40, 42, 48)
MSG_TEXT = (255, 250, 240)


# ============================================================================
# SECTION 2 — PERSPECTIVE PROJECTION
# ============================================================================
# World coordinates: the aircraft flies along +z at PLANE_SPEED. Every ground
# object has a lateral distance d (out the window, perpendicular to track)
# and an along-track position z. The camera looks out the right side, so an
# object ahead of the plane (dz > 0) appears toward the LEFT of the view and
# sweeps right as the plane overtakes it.

def project(d, dz, height=0.0):
    """Project a world point to scene-surface coordinates.

    d      : lateral distance from the flight track (depth; must be > 0)
    dz     : along-track offset (object_z - plane_z)
    height : object height above ground
    Returns (x, y, scale) where scale converts world units -> pixels.
    """
    scale = FOCAL / d
    x = SCENE_CX - dz * scale
    y = HORIZON_Y + (ALTITUDE - height) * scale
    return x, y, scale


def on_scene(x, y, margin=80):
    return -margin <= x <= SCENE_W + margin and -margin <= y <= SCENE_H + margin


# ============================================================================
# SECTION 3 — WORLD OBJECTS
# ============================================================================

class Tree:
    """A scattered eucalypt: thin trunk + blobby canopy."""
    def __init__(self, d, z):
        self.d, self.z = d, z
        self.h = random.uniform(*TREE_HEIGHT)
        self.canopy = random.choice(TREE_CANOPY)
        self.width = self.h * random.uniform(0.7, 1.1)

    def draw(self, surf, pz):
        x, y_base, s = project(self.d, self.z - pz)
        if not on_scene(x, y_base):
            return
        _, y_top, _ = project(self.d, self.z - pz, self.h)
        trunk_w = max(1, int(self.h * 0.06 * s))
        pygame.draw.line(surf, TREE_TRUNK, (x, y_base), (x, y_top), trunk_w)
        r = max(1, int(self.width * 0.5 * s))
        pygame.draw.circle(surf, self.canopy, (int(x), int(y_top)), r)
        if r > 2:  # lighter crown highlight on bigger trees
            hl = tuple(min(255, c + 18) for c in self.canopy)
            pygame.draw.circle(surf, hl, (int(x - r * 0.3), int(y_top - r * 0.3)),
                               max(1, r // 2))


class Scrub:
    """Low saltbush / spinifex patch — a flattened ellipse on the ground."""
    def __init__(self, d, z):
        self.d, self.z = d, z
        self.size = random.uniform(*SCRUB_SIZE)
        self.colour = random.choice(SCRUB_COLOURS)

    def draw(self, surf, pz):
        x, y, s = project(self.d, self.z - pz)
        if not on_scene(x, y):
            return
        w = max(1, int(self.size * s))
        h = max(1, int(self.size * 0.35 * s))
        pygame.draw.ellipse(surf, self.colour, (int(x - w / 2), int(y - h / 2), w, h))


class Mob:
    """A kangaroo, or a small mob of them, hopping loosely together."""
    def __init__(self, d, z):
        self.d, self.z = d, z
        self.count = random.randint(*MOB_COUNT_RANGE)
        # Loose cluster: per-roo offsets in world units (dz_off, d_off)
        self.members = [(random.uniform(-45, 45), random.uniform(-30, 30),
                         random.uniform(0, math.tau))            # hop phase
                        for _ in range(self.count)]
        self.spotted = False
        self.flash_t = 0.0           # seconds remaining on the "spotted" ring
        self.screen_pos = None       # final-screen position, set each frame

    def draw(self, surf, pz, t):
        cx, cy, s = project(self.d, self.z - pz)
        if not on_scene(cx, cy):
            self.screen_pos = None
            return
        self.screen_pos = (cx, cy, s)  # scene coords; converted later
        for dz_off, d_off, phase in self.members:
            d = max(50.0, self.d + d_off)
            x, y, ms = project(d, self.z + dz_off - pz)
            hop = abs(math.sin(t * 4.0 + phase)) * ROO_SIZE * 0.5 * ms
            body_w = ROO_SIZE * ms
            if body_w < 1.6:
                # Too far to draw anatomy — a 2 px speck with a faint shadow
                pygame.draw.circle(surf, ROO_SHADOW, (int(x), int(y)), 2)
                pygame.draw.circle(surf, ROO_BODY, (int(x), int(y - hop)), 1)
                continue
            # ground shadow
            sh_w = max(2, int(body_w * 0.9))
            pygame.draw.ellipse(surf, ROO_SHADOW,
                                (int(x - sh_w / 2), int(y - 1), sh_w, max(1, sh_w // 3)))
            # body (leaning ellipse), head, tail
            bw, bh = max(2, int(body_w)), max(2, int(body_w * 0.62))
            by = y - hop - bh
            pygame.draw.ellipse(surf, ROO_BODY, (int(x - bw / 2), int(by), bw, bh))
            pygame.draw.circle(surf, ROO_BODY,
                               (int(x + bw * 0.45), int(by)), max(1, int(bw * 0.22)))
            pygame.draw.line(surf, ROO_BODY, (x - bw * 0.45, by + bh * 0.5),
                             (x - bw * 0.95, by + bh * 0.85), max(1, int(bw * 0.12)))
        if self.flash_t > 0:
            r = max(10, int(s * ROO_SIZE * 4))
            pygame.draw.circle(surf, (255, 255, 235), (int(cx), int(cy)), r, 2)


class CrossFeature:
    """A linear ground feature (dirt road or dry riverbed) crossing the
    flight path. Stored as a polyline of (d, z) samples spanning the
    visible depth band; rivers meander, roads run straight-ish."""
    def __init__(self, z0, kind):
        self.kind = kind
        slope = random.uniform(-0.5, 0.5)            # diagonal crossing angle
        amp = random.uniform(120, 420) if kind == "river" else random.uniform(0, 40)
        freq = random.uniform(0.0008, 0.002)
        phase = random.uniform(0, math.tau)
        self.width = random.uniform(26, 60) if kind == "river" else random.uniform(10, 18)
        self.z0 = z0
        self.pts = []
        d = D_NEAR * 0.8
        while d < D_FAR * 1.1:
            z = z0 + slope * d + amp * math.sin(d * freq + phase)
            self.pts.append((d, z))
            d *= 1.12                                # denser sampling up close

    def draw(self, surf, pz):
        colour = RIVER_COLOUR if self.kind == "river" else ROAD_COLOUR
        prev = None
        for d, z in self.pts:
            x, y, s = project(d, z - pz)
            w = max(1, int(self.width * s))
            if prev is not None:
                (px, py, pw) = prev
                if on_scene(x, y, margin=200) or on_scene(px, py, margin=200):
                    if self.kind == "river" and pw > 2:
                        pygame.draw.line(surf, RIVER_EDGE, (px, py), (x, y), pw + 2)
                    pygame.draw.line(surf, colour, (px, py), (x, y), max(1, (pw + w) // 2))
            prev = (x, y, w)


# ============================================================================
# SECTION 4 — WORLD MANAGER (spawning, culling)
# ============================================================================

class World:
    def __init__(self):
        self.plane_z = 0.0
        self.trees, self.scrub, self.mobs, self.features = [], [], [], []
        self.next_mob_in = random.expovariate(1.0 / MOB_SPAWN_MEAN_S)
        self.next_feature_z = -2000.0
        # Initial population scattered through the currently visible band
        for _ in range(N_TREES_TARGET):
            self.trees.append(Tree(*self._random_visible_pos()))
        for _ in range(N_SCRUB_TARGET):
            self.scrub.append(Scrub(*self._random_visible_pos()))
        for _ in range(4):
            self.mobs.append(Mob(*self._random_visible_pos()))
        self._extend_features()

    def _random_visible_pos(self):
        d = random.uniform(D_NEAR, D_FAR)
        z = self.plane_z + random.uniform(-0.85, 0.85) * d
        return d, z

    def _entering_pos(self):
        """A spawn position just off the leading (left) edge of the view."""
        d = random.uniform(D_NEAR, D_FAR)
        z = self.plane_z + 0.88 * d + random.uniform(0, 200)
        return d, z

    def _extend_features(self):
        while self.next_feature_z < self.plane_z + 14000:
            kind = "river" if random.random() < 0.45 else "road"
            self.features.append(CrossFeature(self.next_feature_z, kind))
            self.next_feature_z += random.uniform(2200, 5200)

    def update(self, dt):
        self.plane_z += PLANE_SPEED * dt

        # Cull objects that have exited the trailing (right) edge
        def alive(obj):
            return (obj.z - self.plane_z) > -0.95 * obj.d
        self.trees = [o for o in self.trees if alive(o)]
        self.scrub = [o for o in self.scrub if alive(o)]
        self.mobs = [o for o in self.mobs if alive(o)]
        self.features = [f for f in self.features
                         if (f.z0 - self.plane_z) > -0.95 * D_FAR - 2000]

        # Top up steady-state populations from the leading edge
        while len(self.trees) < N_TREES_TARGET:
            self.trees.append(Tree(*self._entering_pos()))
        while len(self.scrub) < N_SCRUB_TARGET:
            self.scrub.append(Scrub(*self._entering_pos()))

        # Kangaroo mobs arrive on a Poisson-ish schedule
        self.next_mob_in -= dt
        if self.next_mob_in <= 0:
            self.mobs.append(Mob(*self._entering_pos()))
            self.next_mob_in = random.expovariate(1.0 / MOB_SPAWN_MEAN_S)

        self._extend_features()

        for m in self.mobs:
            m.flash_t = max(0.0, m.flash_t - dt)


# ============================================================================
# SECTION 5 — RENDERING HELPERS
# ============================================================================

def lerp_colour(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build_background():
    """Pre-render the sky + ground gradient once (it never changes)."""
    bg = pygame.Surface((SCENE_W, SCENE_H))
    # Sky: washed blue down to dusty haze
    for y in range(HORIZON_Y):
        t = y / max(1, HORIZON_Y - 1)
        pygame.draw.line(bg, lerp_colour(SKY_TOP, SKY_HORIZON, t ** 1.4),
                         (0, y), (SCENE_W, y))
    # Ground: pale baked earth at the horizon deepening to red ochre
    span = SCENE_H - HORIZON_Y
    for y in range(HORIZON_Y, SCENE_H):
        t = (y - HORIZON_Y) / max(1, span - 1)
        pygame.draw.line(bg, lerp_colour(GROUND_HORIZON, GROUND_NEAR, t ** 0.7),
                         (0, y), (SCENE_W, y))
    # A faint heat-haze band sitting on the horizon
    haze = pygame.Surface((SCENE_W, 14), pygame.SRCALPHA)
    haze.fill((*SKY_HORIZON, 70))
    bg.blit(haze, (0, HORIZON_Y - 4))
    return bg


def build_window_frame():
    """Pre-render the fuselage interior with a rounded-rect aperture cut out."""
    frame = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
    # Cabin wall with a subtle vertical gradient
    for y in range(SCREEN_H):
        t = y / (SCREEN_H - 1)
        pygame.draw.line(frame, (*lerp_colour(FUSELAGE, FUSELAGE_DARK, t), 255),
                         (0, y), (SCREEN_W, y))
    # Outer moulding ring around the window
    moulding = APERTURE.inflate(36, 36)
    pygame.draw.rect(frame, (*FUSELAGE_DARK, 255), moulding,
                     border_radius=APERTURE_RADIUS + 18)
    pygame.draw.rect(frame, (170, 172, 178, 255), APERTURE.inflate(16, 16),
                     border_radius=APERTURE_RADIUS + 8)
    # Punch out the transparent aperture (pygame.draw writes RGBA directly)
    pygame.draw.rect(frame, (0, 0, 0, 0), APERTURE, border_radius=APERTURE_RADIUS)
    # Inner-pane hint: a faint second outline just inside the glass
    pygame.draw.rect(frame, (255, 255, 255, 36), APERTURE.inflate(-14, -14),
                     width=2, border_radius=APERTURE_RADIUS - 8)
    # Soft corner reflection streak on the glass
    streak = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
    pygame.draw.polygon(streak, (255, 255, 255, 16),
                        [(APERTURE.left + 40, APERTURE.top),
                         (APERTURE.left + 130, APERTURE.top),
                         (APERTURE.left + 10, APERTURE.bottom),
                         (APERTURE.left - 60, APERTURE.bottom)])
    frame.blit(streak, (0, 0))
    # Lowered window shade peeking in at the top
    shade = pygame.Rect(APERTURE.left + 30, APERTURE.top - 6, APERTURE.width - 60, 26)
    pygame.draw.rect(frame, (228, 226, 218, 255), shade, border_radius=10)
    pygame.draw.rect(frame, (190, 188, 180, 255), shade, width=2, border_radius=10)
    return frame


def scene_to_screen(pt, bank_rad, jitter):
    """Map a scene-surface point to final screen coords, accounting for the
    banking rotation (about the scene centre) and turbulence jitter."""
    dx, dy = pt[0] - SCENE_CX, pt[1] - SCENE_CY
    c, s = math.cos(bank_rad), math.sin(bank_rad)
    rx = dx * c + dy * s
    ry = -dx * s + dy * c
    return (SCREEN_W / 2 + rx + jitter[0], SCREEN_H / 2 + ry + jitter[1])


# ============================================================================
# SECTION 6 — MAIN GAME
# ============================================================================

async def main():
    smoke_test = "--smoke-test" in sys.argv
    if smoke_test:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

    pygame.init()
    pygame.display.set_caption("Outback Window Seat — kangaroo spotting")
    screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
    clock = pygame.time.Clock()
    font = pygame.font.SysFont(None, 26)
    font_big = pygame.font.SysFont(None, 34)

    # ---- Xbox controller setup (hot-pluggable) ----------------------------
    pygame.joystick.init()
    joystick = None

    def connect_joystick():
        nonlocal joystick
        if pygame.joystick.get_count() > 0:
            joystick = pygame.joystick.Joystick(0)
            joystick.init()
        else:
            joystick = None
    connect_joystick()

    world = World()
    scene = pygame.Surface((SCENE_W, SCENE_H))
    background = build_background()
    frame_overlay = build_window_frame()

    tally = 0
    messages = []          # list of [text, time_remaining]
    t = 0.0
    frames = 0
    running = True

    def attempt_sighting():
        """Log the closest unspotted mob currently visible in the window."""
        nonlocal tally
        visible = []
        for m in world.mobs:
            if m.spotted or m.screen_pos is None:
                continue
            sx, sy = scene_to_screen(m.screen_pos[:2], bank_rad, jitter)
            if APERTURE.inflate(-30, -30).collidepoint(sx, sy):
                visible.append((m.screen_pos[2], m))     # sort key: scale (closeness)
        if not visible:
            messages.append(["No kangaroos in sight — keep watching!", 1.6])
            return
        visible.sort(key=lambda v: -v[0])
        mob = visible[0][1]
        mob.spotted = True
        mob.flash_t = 1.3
        tally += mob.count
        noun = "kangaroo" if mob.count == 1 else "kangaroos"
        messages.append([f"Spotted {mob.count} {noun}!  Total: {tally}", 2.4])

    # ---- Main loop ---------------------------------------------------------
    bank_rad, jitter = 0.0, (0.0, 0.0)
    while running:
        dt = min(clock.tick(FPS) / 1000.0, 0.05)
        t += dt
        frames += 1

        # --- Ambient motion: gentle banking + turbulence (sums of sines) ---
        bank_deg = 2.1 * math.sin(t * 0.17) + 0.7 * math.sin(t * 0.51 + 1.3)
        bank_rad = math.radians(bank_deg)
        jitter = (2.5 * math.sin(t * 1.9 + 0.4) + 1.2 * math.sin(t * 4.7),
                  3.5 * math.sin(t * 1.3) + 1.5 * math.sin(t * 5.3 + 2.1))

        # --- Events ---------------------------------------------------------
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False
            elif ev.type == pygame.KEYDOWN:
                if ev.key == pygame.K_ESCAPE:
                    running = False
                elif ev.key == pygame.K_SPACE:
                    attempt_sighting()
            elif ev.type == pygame.JOYBUTTONDOWN and ev.button == 0:   # A button
                attempt_sighting()
            elif ev.type in (pygame.JOYDEVICEADDED, pygame.JOYDEVICEREMOVED):
                connect_joystick()

        # --- Update ----------------------------------------------------------
        world.update(dt)
        for m in messages:
            m[1] -= dt
        messages[:] = [m for m in messages if m[1] > 0][-3:]

        # --- Render the world to the oversized scene surface -----------------
        scene.blit(background, (0, 0))
        for f in world.features:                       # flat ground features first
            f.draw(scene, world.plane_z)
        drawables = world.trees + world.scrub          # far-to-near painter's order
        drawables.sort(key=lambda o: -o.d)
        for o in drawables:
            o.draw(scene, world.plane_z)
        for m in sorted(world.mobs, key=lambda o: -o.d):
            m.draw(scene, world.plane_z, t)

        # --- Banking: rotate the whole scene, blit with turbulence jitter ----
        rotated = pygame.transform.rotate(scene, bank_deg)
        rect = rotated.get_rect(center=(SCREEN_W / 2 + jitter[0],
                                        SCREEN_H / 2 + jitter[1]))
        screen.fill(FUSELAGE_DARK)
        screen.blit(rotated, rect)

        # --- Window frame overlay --------------------------------------------
        screen.blit(frame_overlay, (0, 0))

        # --- HUD ---------------------------------------------------------------
        tally_surf = font_big.render(f"Kangaroos spotted: {tally}", True, HUD_TEXT)
        screen.blit(tally_surf, (18, SCREEN_H - 40))
        status = "controller OK" if joystick else "keyboard mode"
        hint_surf = font.render(f"A / SPACE — sight  ·  {status}", True, HUD_TEXT)
        screen.blit(hint_surf, (SCREEN_W - hint_surf.get_width() - 18, SCREEN_H - 36))

        # --- Transient messages (top centre, on a translucent pill) -------------
        my = 16
        for text, remaining in messages:
            alpha = min(1.0, remaining / 0.4)
            msg = font_big.render(text, True, MSG_TEXT)
            pill = pygame.Surface((msg.get_width() + 28, msg.get_height() + 12),
                                  pygame.SRCALPHA)
            pygame.draw.rect(pill, (35, 30, 25, int(180 * alpha)),
                             pill.get_rect(), border_radius=16)
            msg.set_alpha(int(255 * alpha))
            pill.blit(msg, (14, 6))
            screen.blit(pill, (SCREEN_W / 2 - pill.get_width() / 2, my))
            my += pill.get_height() + 6

        pygame.display.flip()
        await asyncio.sleep(0)   # yield to the browser event loop (pygbag/WebAssembly)

        if smoke_test and frames >= 180:
            print(f"smoke test ok: {frames} frames, tally={tally}, "
                  f"mobs={len(world.mobs)}, trees={len(world.trees)}")
            running = False

    pygame.quit()


if __name__ == "__main__":
    asyncio.run(main())
