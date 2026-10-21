"""Filter a Geofabrik OSM extract down to what the river planner uses.

    python osm_extract.py <extract.osm.pbf> <out-dir>

Writes three JSON-lines files (coordinates are [lat, lng], 6 dp):
  ways.jsonl    every waterway=river|canal|flowline|fairway way, plus streams, ditches
                and drains that are part of a mapped canoe route: id, tags, node ids,
                coordinates. A way in a route=canoe relation carries the route's
                name as the tag canoe_route (ours, not OSM's).
  points.jsonl  lock gates, weirs, dams, slipways, portages, canoe tags, water,
                toilets and parking (ways and areas at their centre)
  places.jsonl  cities, towns, villages and hamlets, for the places search

Python only because pyosmium reads the 2.6 GB extract in about a minute; all
the logic that matters (splitting, simplifying, assembling) is TypeScript in
@paddlesnitch/waterways and tested there. See docs/features/waterways-uk-ireland.md.
"""
import json
import sys
from pathlib import Path

import osmium

# flowline and fairway carry the water across lakes (Loch Ness on the Caledonian).
# boat_lift: inclined planes and boat lifts (Ronquières, Strépy-Thieu, the Falkirk
# Wheel, Anderton) carry the canal between its two ends; without them it breaks.
NETWORK = {'river', 'canal', 'flowline', 'fairway', 'boat_lift'}
WAY_TAGS = ('name', 'waterway', 'tidal', 'lock', 'lock_name', 'lock_ref', 'boat', 'canoe', 'access', 'tunnel', 'intermittent')
POINT_WATERWAY = {'lock_gate', 'weir', 'dam'}
# Small water joins the network only where a canoe route uses it, or where it's
# tagged open to boats or canoes: a mistag of a navigation (1.6 km of the Canal
# du Midi at the Seuil de Naurouze is waterway=stream, boat=yes).
ROUTE_ONLY = {'stream', 'ditch', 'drain'}
OPEN = {'yes', 'designated', 'permissive'}
POINT_AMENITY = {'drinking_water', 'water_point', 'toilets', 'parking', 'boat_rental'}
PLACES = {'city', 'town', 'village', 'hamlet'}


def r6(x):
    return round(x, 6)


def wanted_point(tags):
    return (
        tags.get('waterway') in POINT_WATERWAY
        or tags.get('leisure') == 'slipway'
        or 'portage' in tags
        or 'canoe' in tags
        or tags.get('amenity') in POINT_AMENITY
    )


def canoe_route_ways(src):
    """Way id -> the name of a route=canoe relation it belongs to."""
    routes = {}
    for r in osmium.FileProcessor(src, osmium.osm.RELATION).with_filter(osmium.filter.TagFilter(('route', 'canoe'))):
        name = r.tags.get('name') or r.tags.get('ref') or 'canoe route'
        for m in r.members:
            if m.type == 'w':
                routes.setdefault(m.ref, name)
    return routes


def main(src, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    routes = canoe_route_ways(src)
    counts = {'ways': 0, 'points': 0, 'places': 0}
    with open(out / 'ways.jsonl', 'w') as ways, open(out / 'points.jsonl', 'w') as points, \
            open(out / 'places.jsonl', 'w') as places:
        fp = (osmium.FileProcessor(src)
              .with_locations()
              # Cheap C++ prefilter on keys; wanted_point() and friends narrow it.
              .with_filter(osmium.filter.KeyFilter('waterway', 'leisure', 'amenity', 'place', 'portage', 'canoe'))
              )
        for o in fp:
            tags = dict(o.tags)
            if o.is_node():
                at = [r6(o.location.lat), r6(o.location.lon)]
                if tags.get('place') in PLACES and tags.get('name'):
                    keep = {k: tags[k] for k in ('name', 'place', 'population') if k in tags}
                    places.write(json.dumps({'id': f'node/{o.id}', 'at': at, 'tags': keep}) + '\n')
                    counts['places'] += 1
                elif wanted_point(tags):
                    points.write(json.dumps({'id': f'node/{o.id}', 'at': at, 'tags': tags}) + '\n')
                    counts['points'] += 1
            elif o.is_way():
                try:
                    coords = [[r6(n.lat), r6(n.lon)] for n in o.nodes]
                except osmium.InvalidLocationError:
                    continue   # a node outside the extract
                on_route = routes.get(o.id)
                navigable = tags.get('boat') in OPEN or tags.get('canoe') in OPEN
                if tags.get('waterway') in NETWORK or ((on_route or navigable) and tags.get('waterway') in ROUTE_ONLY):
                    keep = {k: tags[k] for k in WAY_TAGS if k in tags}
                    if on_route:
                        keep['canoe_route'] = on_route
                    nodes = [n.ref for n in o.nodes]
                    ways.write(json.dumps({'id': o.id, 'tags': keep, 'nodes': nodes, 'coords': coords}) + '\n')
                    counts['ways'] += 1
                elif wanted_point(tags) and coords:
                    lat = sum(c[0] for c in coords) / len(coords)
                    lng = sum(c[1] for c in coords) / len(coords)
                    point = {'id': f'way/{o.id}', 'at': [r6(lat), r6(lng)], 'tags': tags}
                    # A portage path's two ends are where you get out and back in.
                    if 'portage' in tags and len(coords) > 1:
                        point['ends'] = [coords[0], coords[-1]]
                    points.write(json.dumps(point) + '\n')
                    counts['points'] += 1
    counts['canoe_route_ways'] = len(routes)
    print(json.dumps(counts))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
