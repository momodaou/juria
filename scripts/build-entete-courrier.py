#!/usr/bin/env python3
"""Génère les calques d'en-tête numérique (sortie B) des courriers JURIA — page A4, transparents, 200 ppp.

Mesures relevées le 04/11/2026 sur la feuille vierge du papier à en-tête du cabinet (scan) :
  logo x 1,3-5,6 cm / y 1,15-3,0 ; filet vertical x 5,86 cm / y 6,6-23,0 ; coordonnées x 0,6-5,1 / y 24,5-27,4 ;
  barre y 28,94-29,68 (orange 0-6,1 cm, bleu 6,1-21 cm) ; décor pâle de deux anneaux en bas à droite.
Entrées : logos haute résolution (DOC/CLAUDE CODE - JURIA/Logos/, hors dépôt) → chemin passé en argument.
Sorties : APP/backend/assets/courrier/entete-b-base-mali.png, entete-b-base-std.png, entete-b-decor.png
Usage : python3 scripts/build-entete-courrier.py "<dossier des logos>"
Dépendances : Pillow ; polices macOS (Arial Narrow Bold).
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

DPI = 200
CM = DPI / 2.54
W, H = int(21.0 * CM), int(29.7 * CM)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "APP", "backend", "assets", "courrier")
LOGOS = sys.argv[1] if len(sys.argv) > 1 else "."
ORANGE = (160, 58, 30)
MARINE = (19, 44, 101)
FILET = (120, 135, 175, 235)
FONT = "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"


def cm(v):
    return int(round(v * CM))


def base(logo_file, hauteur_logo=None, largeur_logo=None, nom=""):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    logo = Image.open(os.path.join(LOGOS, logo_file)).convert("RGBA")
    if largeur_logo:
        lw = cm(largeur_logo)
        lh = int(logo.height * lw / logo.width)
    else:
        lh = cm(hauteur_logo)
        lw = int(logo.width * lh / logo.height)
    logo = logo.resize((lw, lh), Image.LANCZOS)
    im.alpha_composite(logo, (cm(1.3), cm(1.15)))
    # filet vertical
    d.rectangle((cm(5.86) - 1, cm(6.6), cm(5.86) + 1, cm(23.0)), fill=FILET)
    # barre du bas
    d.rectangle((0, cm(28.94), cm(6.1), cm(29.68)), fill=ORANGE + (255,))
    d.rectangle((cm(6.1), cm(28.94), W, cm(29.68)), fill=MARINE + (255,))
    # coordonnées
    f = ImageFont.truetype(FONT, int(7.2 / 72 * DPI * 1.18))
    groupes = [
        (24.45, ["+223 44 90 64 35", "+223 20 29 53 04", "+223 44 90 53 80"]),
        (25.85, ["03 BP 171, Hamdallaye ACI 2000,", "Immeuble D&D, Rue 293, Porte 327"]),
        (26.80, ["contact@jfcavocats-mali.com", "www.jfcavocats-mali.com"]),
    ]
    for y0, lignes in groupes:
        ry = cm(y0 + 0.21)
        d.ellipse((cm(0.64), ry - cm(0.21), cm(0.64) + cm(0.42), ry + cm(0.21)), fill=MARINE + (255,))
        d.ellipse((cm(0.64) + cm(0.15), ry - cm(0.06), cm(0.64) + cm(0.27), ry + cm(0.06)), fill=(255, 255, 255, 255))
        for i, t in enumerate(lignes):
            d.text((cm(1.25), cm(y0) + i * cm(0.40)), t, font=f, fill=(45, 50, 65, 255))
    chemin = os.path.join(OUT, nom)
    im.save(chemin, optimize=True)
    print(nom, im.size, os.path.getsize(chemin) // 1024, "Ko")


def decor():
    S = 2
    big = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))

    def anneau(cx, cy, R, r, rgb, alpha):
        layer = Image.new("RGBA", big.size, (0, 0, 0, 0))
        dd = ImageDraw.Draw(layer)
        dd.ellipse(((cx - R) * CM * S, (cy - R) * CM * S, (cx + R) * CM * S, (cy + R) * CM * S), fill=rgb + (int(255 * alpha),))
        dd.ellipse(((cx - r) * CM * S, (cy - r) * CM * S, (cx + r) * CM * S, (cy + r) * CM * S), fill=(0, 0, 0, 0))
        return layer

    big.alpha_composite(anneau(17.67, 23.9, 4.05, 2.0, (222, 115, 12), 0.22))
    big.alpha_composite(anneau(20.2, 26.3, 3.7, 1.9, (60, 70, 150), 0.25))
    im = big.resize((W, H), Image.LANCZOS)
    ImageDraw.Draw(im).rectangle((0, cm(28.94), W, H), fill=(0, 0, 0, 0))  # le décor s'arrête au-dessus de la barre
    chemin = os.path.join(OUT, "entete-b-decor.png")
    im.save(chemin, optimize=True)
    print("entete-b-decor.png", im.size, os.path.getsize(chemin) // 1024, "Ko")


os.makedirs(OUT, exist_ok=True)
base("logo-jfc-avocats-mali-2000px.png", largeur_logo=4.3, nom="entete-b-base-mali.png")
base("logo-jfc-avocats-2000px.png", hauteur_logo=1.9, nom="entete-b-base-std.png")
decor()
