#!/usr/bin/env python3
"""
الغرض: تحويلُ ناتجِ Overpass (OpenStreetMap) لمدينةٍ إلى هجرةِ بذرٍ لـ
  `destination_landmarks` — البند `UI-DEST-01`.
الحالة: منفّذ فعلياً.
لماذا: دليلُ المعالمِ كانَ عشرةَ صفوفٍ لجدةَ وحدَها، فكلُّ اسمٍ خارجَها (حيٌّ،
  فندقٌ، مستشفى) يُجابُ «لا نتيجةَ»، والراكبُ لا يستطيعُ طلبَ مشوارٍ أصلاً.
الاستعمال:
  python3 scripts/gazetteer/osm-landmarks-to-sql.py <overpass.json> <CITY_CODE> > migration.sql
  والاستعلامُ المستعمَلُ في `scripts/gazetteer/overpass-query.txt` (المستطيلُ يُطابِقُ
  `city_service_areas` للمدينةِ).
الترخيص: بياناتُ OpenStreetMap © المساهمون، ODbL 1.0 — يُحفَظ المرجعُ في `source`.
"""
import json
import re
import sys

ARABIC = re.compile(r"[\u0600-\u06FF]")
LATIN = re.compile(r"[A-Za-z]")


def kind_of(tags):
    if tags.get("place") in ("suburb", "neighbourhood", "quarter"):
        return "district"
    amenity = tags.get("amenity")
    if amenity == "hospital":
        return "hospital"
    if amenity in ("university", "college"):
        return "university"
    if amenity == "place_of_worship":
        return "mosque"
    if tags.get("shop") == "mall":
        return "mall"
    if tags.get("leisure") == "stadium":
        return "stadium"
    if tags.get("aeroway") == "terminal":
        return "terminal"
    return "landmark"


def clean(value):
    return re.sub(r"\s+", " ", (value or "").strip())[:160]


def q(value):
    return "'" + value.replace("'", "''") + "'"


def norm(value):
    value = value.translate(str.maketrans("آأإٱىئةؤ", "ااااييهو"))
    return re.sub(r"[^0-9a-z\u0621-\u063A\u0641-\u064A]+", " ", value.lower()).strip()


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    city = sys.argv[2]
    rows = []
    seen = set()
    for element in data["elements"]:
        tags = element.get("tags", {})
        name = clean(tags.get("name"))
        name_ar = clean(tags.get("name:ar")) or (name if ARABIC.search(name) else "")
        if not name_ar:
            continue
        name_en = clean(tags.get("name:en")) or (name if LATIN.search(name) else "") or name_ar
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lng = element.get("lon") or element.get("center", {}).get("lon")
        if lat is None or lng is None:
            continue
        kind = kind_of(tags)
        # المساجدُ كثيرةٌ وأسماؤها تتكرّر («مسجد الرحمة»)؛ نُبقي ما فيه اسمٌ مميَّزٌ فقط.
        key = (norm(name_ar), kind)
        if key in seen:
            continue
        seen.add(key)
        source = f"OpenStreetMap © contributors (ODbL) osm:{element['type']}/{element['id']}"
        rows.append((kind, name_ar, name_en, round(lat, 6), round(lng, 6), source))
    rows.sort(key=lambda r: (r[0], r[1]))
    print("-- migration-phase: backfill")
    print(f"-- UI-DEST-01: معالمُ {city} من OpenStreetMap ({len(rows)} صفّاً) — مُولَّدٌ بـ")
    print("--   scripts/gazetteer/osm-landmarks-to-sql.py ولا يُحرَّر يدوياً.")
    print("-- البياناتُ © مساهمو OpenStreetMap، ترخيص ODbL 1.0؛ المرجعُ لكلِّ صفٍّ في `source`.")
    print("-- مُسترجَعٌ: صفٌّ بنفسِ المدينةِ والنوعِ والاسمِ العربيِّ لا يُكرَّر.")
    print("insert into destination_landmarks (city_id, kind, name_ar, name_en, point, source)")
    print("select c.id, s.kind, s.name_ar, s.name_en,")
    print("       st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography, s.source")
    print("  from cities c")
    print("  cross join (values")
    body = ",\n".join(
        f"    ({q(k)}, {q(a)}, {q(e)}, {lat}::double precision, {lng}::double precision, {q(s)})"
        for k, a, e, lat, lng, s in rows
    )
    print(body)
    print("  ) as s(kind, name_ar, name_en, lat, lng, source)")
    print(" where not exists (")
    print("     select 1 from destination_landmarks l")
    print("      where l.city_id = c.id and l.kind = s.kind")
    print("        and normalize_search_text(l.name_ar) = normalize_search_text(s.name_ar)")
    print("   )")
    print(f"   and c.code = {q(city)};")


if __name__ == "__main__":
    main()
