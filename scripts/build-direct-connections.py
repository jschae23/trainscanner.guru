#!/usr/bin/env python3
"""
Build direct train connection data from GTFS.de feeds.

The generated JSON is intentionally static and frontend-friendly:
- stations: compact station metadata with coordinates
- edges: per station list of reachable destinations without transfer
- products: "longDistance" and/or "regional" per connection
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import cos, radians
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "gtfs"
OUTPUT_DB_FILE = ROOT / "public" / "direct-connections.db"

FEEDS = {
    "fv": {
        "name": "Fernverkehr",
        "product": "longDistance",
        "url": "https://download.gtfs.de/germany/fv_free/latest.zip",
        "expected_size": 350_000,
    },
    "rv": {
        "name": "Nahverkehr",
        "product": "regional",
        "url": "https://download.gtfs.de/germany/rv_free/latest.zip",
        "expected_size": 9_500_000,
    },
}


def parse_time(value: str) -> int:
    if not value:
        return 0
    hours, minutes, seconds = value.split(":")
    return int(hours) * 60 + int(minutes) + int(seconds) // 60


def parse_gtfs_date(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def active_days_from_calendar(row: dict) -> set[date]:
    start = parse_gtfs_date(row["start_date"])
    end = parse_gtfs_date(row["end_date"])
    active_weekdays = {
        0: row.get("monday") == "1",
        1: row.get("tuesday") == "1",
        2: row.get("wednesday") == "1",
        3: row.get("thursday") == "1",
        4: row.get("friday") == "1",
        5: row.get("saturday") == "1",
        6: row.get("sunday") == "1",
    }

    days = set()
    current = start
    while current <= end:
        if active_weekdays[current.weekday()]:
            days.add(current)
        current += timedelta(days=1)

    return days


def format_line_label(route: dict | None) -> str | None:
    if not route:
        return None

    short_name = (route.get("route_short_name") or "").strip()
    long_name = (route.get("route_long_name") or "").strip()
    label = short_name or long_name
    if not label:
        return None

    return re.sub(r"\s+", " ", label)[:40]


def format_minutes(value: int | None) -> str | None:
    if value is None:
        return None

    minutes = value % (24 * 60)
    day_offset = value // (24 * 60)
    suffix = f"+{day_offset}" if day_offset > 0 else ""
    return f"{minutes // 60:02d}:{minutes % 60:02d}{suffix}"


def should_filter_station(name: str) -> bool:
    return bool(re.search(r" \d{3} P\d+$", name))


def is_sub_station(name: str) -> bool:
    return any(part in name.lower() for part in ["gleis", "flixtrain", "tief"])


def normalize_words(name: str) -> set[str]:
    import unicodedata

    synonyms = {"bahnhof", "bf", "hbf", "hb", "hauptbahnhof"}
    words = re.findall(r"\w+\.?", name.lower())
    normalized = [
        unicodedata.normalize("NFD", word).encode("ascii", "ignore").decode()
        for word in words
    ]
    return {word for word in normalized if word and word not in synonyms}


def compare_stations(name1: str, name2: str) -> int:
    has_non_main1 = is_sub_station(name1)
    has_non_main2 = is_sub_station(name2)

    if has_non_main1 != has_non_main2:
        return 1 if has_non_main1 else -1

    remaining1 = normalize_words(name1)
    remaining2 = normalize_words(name2)

    for word in list(remaining1):
        if word in remaining2:
            remaining1.discard(word)
            remaining2.discard(word)

    for left, right in [(remaining1, remaining2), (remaining2, remaining1)]:
        for word in list(left):
            if not word.endswith("."):
                continue
            prefix = word.rstrip(".")
            for candidate in list(right):
                if candidate.startswith(prefix):
                    left.discard(word)
                    right.discard(candidate)
                    break

    if remaining1 or remaining2:
        return 0

    return len(name2) - len(name1)


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_dist = abs(lat1 - lat2) * 111
    lon_dist = abs(lon1 - lon2) * 111 * abs(cos(radians((lat1 + lat2) / 2)))
    return (lat_dist**2 + lon_dist**2) ** 0.5


def merge_into(stations: dict, stop_to_station: dict, source_sid: str, target_sid: str) -> None:
    stations[target_sid]["stops"].update(stations[source_sid]["stops"])
    stations[target_sid]["names"].update(stations[source_sid]["names"])
    del stations[source_sid]
    for stop_id in stations[target_sid]["stops"]:
        stop_to_station[stop_id] = target_sid


def download_feed(feed_id: str, force: bool) -> Path:
    feed = FEEDS[feed_id]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target = DATA_DIR / f"{feed_id}.zip"

    if target.exists() and not force:
        print(f"{feed['name']}: using cached {target} ({target.stat().st_size:,} bytes)")
        return target

    print(f"{feed['name']}: downloading {feed['url']}")
    request = Request(feed["url"], headers={"User-Agent": "trainscanner.guru direct-connections builder"})

    try:
        with urlopen(request, timeout=120) as response, tempfile.NamedTemporaryFile(delete=False) as temp:
            shutil.copyfileobj(response, temp)
            temp_path = Path(temp.name)
    except URLError as exc:
        print(f"Failed to download {feed_id}: {exc}", file=sys.stderr)
        sys.exit(1)

    actual_size = temp_path.stat().st_size
    if actual_size < feed["expected_size"] * 0.3:
        print(f"Downloaded file for {feed_id} looks unexpectedly small ({actual_size:,} bytes)", file=sys.stderr)
        sys.exit(1)

    shutil.move(str(temp_path), target)
    print(f"{feed['name']}: saved {target} ({actual_size:,} bytes)")
    return target


def validate_feed(path: Path) -> None:
    required = {"stops.txt", "stop_times.txt", "trips.txt"}
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
    missing = required - names
    if missing:
        print(f"{path} is missing {', '.join(sorted(missing))}", file=sys.stderr)
        sys.exit(1)


def build(feeds: list[str], force_download: bool, output: Path) -> None:
    zip_paths = {}
    for feed_id in feeds:
        zip_path = download_feed(feed_id, force_download)
        validate_feed(zip_path)
        zip_paths[feed_id] = zip_path

    stations: dict[str, dict] = {}
    stop_to_station: dict[str, str] = {}

    print("Building station index")
    for feed_id, zip_path in zip_paths.items():
        with zipfile.ZipFile(zip_path) as archive:
            with archive.open("stops.txt") as file:
                rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                for row in rows:
                    stop_id = row["stop_id"]
                    name = row["stop_name"]
                    if should_filter_station(name):
                        continue
                    if stop_id in stations:
                        continue

                    parent = row.get("parent_station") or ""
                    stations[stop_id] = {
                        "sid": stop_id,
                        "name": name,
                        "lat": round(float(row["stop_lat"]), 5),
                        "lon": round(float(row["stop_lon"]), 5),
                        "stops": {stop_id},
                        "names": {name},
                        "parent": parent,
                    }
                    stop_to_station[stop_id] = stop_id

    print("Merging station variants")
    for stop_id, station in list(stations.items()):
        parent = stop_to_station.get(station.get("parent"))
        if parent and stop_id in stations and parent in stations and parent != stop_id:
            merge_into(stations, stop_to_station, stop_id, parent)

    station_list = sorted(stations.values(), key=lambda item: item["lat"])
    for i, station in enumerate(station_list):
        for other in station_list[i + 1:]:
            if other["lat"] - station["lat"] > 0.01:
                break
            sid1 = station["sid"]
            sid2 = other["sid"]
            if sid1 not in stations or sid2 not in stations:
                continue
            if distance_km(station["lat"], station["lon"], other["lat"], other["lon"]) > 0.15:
                continue
            comparison = compare_stations(station["name"], other["name"])
            if comparison < 0:
                merge_into(stations, stop_to_station, sid2, sid1)
            elif comparison > 0:
                merge_into(stations, stop_to_station, sid1, sid2)

    print(f"Stations: {len(stations):,}")

    connections: dict[str, dict[str, dict[str, object]]] = defaultdict(dict)
    connection_details: dict[str, dict[str, dict[tuple[str, str, int, str, str], int]]] = defaultdict(lambda: defaultdict(dict))
    detail_dates: list[date] = []
    detail_date_to_index: dict[date, int] = {}

    def get_detail_date_index(day: date) -> int:
        if day not in detail_date_to_index:
            detail_date_to_index[day] = len(detail_dates)
            detail_dates.append(day)
        return detail_date_to_index[day]

    def build_service_mask(days: set[date]) -> int:
        mask = 0
        for day in sorted(days):
            mask |= 1 << get_detail_date_index(day)
        return mask

    for sid in stations:
        connections[sid] = {}

    print("Extracting direct connections")
    for feed_id, zip_path in zip_paths.items():
        product = FEEDS[feed_id]["product"]
        feed_connection_count = 0
        with zipfile.ZipFile(zip_path) as archive:
            route_by_id = {}
            with archive.open("routes.txt") as file:
                rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                for row in rows:
                    route_by_id[row["route_id"]] = row

            service_days: dict[str, set[date]] = {}
            feed_dates: set[date] = set()

            if "calendar.txt" in archive.namelist():
                with archive.open("calendar.txt") as file:
                    rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                    for row in rows:
                        days = active_days_from_calendar(row)
                        service_days[row["service_id"]] = days
                        feed_dates.update(days)

            if "calendar_dates.txt" in archive.namelist():
                with archive.open("calendar_dates.txt") as file:
                    rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                    for row in rows:
                        service_id = row["service_id"]
                        day = parse_gtfs_date(row["date"])
                        days = service_days.setdefault(service_id, set())
                        if row["exception_type"] == "1":
                            days.add(day)
                            feed_dates.add(day)
                        elif row["exception_type"] == "2":
                            days.discard(day)

            if not feed_dates:
                feed_dates.add(date.today())

            trip_meta = {}
            with archive.open("trips.txt") as file:
                rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                for row in rows:
                    route = route_by_id.get(row["route_id"])
                    active_days = service_days.get(row["service_id"], set())
                    days = len(active_days)
                    trip_meta[row["trip_id"]] = {
                        "serviceDays": days,
                        "serviceMask": build_service_mask(active_days),
                        "line": format_line_label(route),
                    }

            feed_day_count = max(1, len(feed_dates))

            with archive.open("stop_times.txt") as file:
                rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))
                current_trip_id = None
                current_trip: list[tuple[str, int]] = []

                def flush_trip() -> None:
                    nonlocal feed_connection_count
                    if len(current_trip) < 2:
                        return

                    meta = trip_meta.get(current_trip_id or "", {})
                    service_day_weight = float(meta.get("serviceDays", 0)) / feed_day_count
                    service_mask = int(meta.get("serviceMask", 0))
                    line_label = meta.get("line")

                    deduped: list[tuple[str, int]] = []
                    previous_sid = None
                    for sid, minutes in current_trip:
                        if sid == previous_sid:
                            continue
                        deduped.append((sid, minutes))
                        previous_sid = sid

                    for i, (sid_a, minutes_a) in enumerate(deduped[:-1]):
                        for sid_b, minutes_b in deduped[i + 1:]:
                            if sid_a == sid_b:
                                continue
                            travel_time = max(1, minutes_b - minutes_a)
                            edge = connections[sid_a].setdefault(
                                sid_b,
                                {
                                    "time": travel_time,
                                    "products": set(),
                                    "tripCount": 0,
                                    "weightedTrips": 0.0,
                                    "durationTotal": 0,
                                    "durationCount": 0,
                                    "firstDeparture": None,
                                    "lastDeparture": None,
                                    "lines": {},
                                },
                            )
                            edge["time"] = min(int(edge["time"]), travel_time)
                            edge["products"].add(product)
                            edge["tripCount"] = int(edge["tripCount"]) + 1
                            edge["weightedTrips"] = float(edge["weightedTrips"]) + service_day_weight
                            edge["durationTotal"] = int(edge["durationTotal"]) + travel_time
                            edge["durationCount"] = int(edge["durationCount"]) + 1
                            first_departure = edge.get("firstDeparture")
                            last_departure = edge.get("lastDeparture")
                            edge["firstDeparture"] = minutes_a if first_departure is None else min(int(first_departure), minutes_a)
                            edge["lastDeparture"] = minutes_a if last_departure is None else max(int(last_departure), minutes_a)
                            if line_label:
                                lines = edge["lines"]
                                lines[line_label] = int(lines.get(line_label, 0)) + 1
                            if service_mask:
                                detail_key = (
                                    format_minutes(minutes_a) or "",
                                    format_minutes(minutes_b) or "",
                                    travel_time,
                                    str(line_label or ""),
                                    product,
                                )
                                target_details = connection_details[sid_a][sid_b]
                                target_details[detail_key] = int(target_details.get(detail_key, 0)) | service_mask
                            feed_connection_count += 1

                for row in rows:
                    trip_id = row["trip_id"]
                    if current_trip_id is not None and trip_id != current_trip_id:
                        flush_trip()
                        current_trip = []

                    station_id = stop_to_station.get(row["stop_id"])
                    if station_id:
                        current_trip.append((station_id, parse_time(row["arrival_time"])))

                    current_trip_id = trip_id

                flush_trip()

        print(f"{FEEDS[feed_id]['name']}: {feed_connection_count:,} trip-pair observations")

    station_ids = sorted(stations.keys(), key=lambda sid: stations[sid]["name"].casefold())
    station_to_index = {sid: index for index, sid in enumerate(station_ids)}

    output_data = {
        "schemaVersion": 2,
        "source": "GTFS.de",
        "sourceUrls": [FEEDS[feed_id]["url"] for feed_id in feeds],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "version": date.today().strftime("%Y%m%d"),
        "stations": [],
        "edges": [],
    }

    for sid in station_ids:
        station = stations[sid]
        output_data["stations"].append(
            {
                "id": sid,
                "name": station["name"],
                "lat": station["lat"],
                "lon": station["lon"],
                "altNames": sorted(name for name in station["names"] if name != station["name"]),
            }
        )

        station_edges = []
        for target_sid, edge in sorted(
            connections[sid].items(),
            key=lambda item: (int(item[1]["time"]), stations[item[0]]["name"].casefold()),
        ):
            if target_sid not in station_to_index:
                continue
            duration_count = max(1, int(edge["durationCount"]))
            top_lines = [
                line
                for line, _count in sorted(
                    edge["lines"].items(),
                    key=lambda item: (-int(item[1]), item[0].casefold()),
                )[:8]
            ]
            station_edges.append(
                {
                    "to": station_to_index[target_sid],
                    "time": int(edge["time"]),
                    "typicalTime": round(int(edge["durationTotal"]) / duration_count),
                    "tripsPerDay": round(float(edge["weightedTrips"]), 1),
                    "tripCount": int(edge["tripCount"]),
                    "firstDeparture": format_minutes(edge.get("firstDeparture")),
                    "lastDeparture": format_minutes(edge.get("lastDeparture")),
                    "lines": top_lines,
                    "products": sorted(edge["products"]),
                }
            )
        output_data["edges"].append(station_edges)

    output.parent.mkdir(parents=True, exist_ok=True)
    details_db = output
    legacy_details_dir = output.parent / "direct-connection-details"
    if legacy_details_dir.exists():
        shutil.rmtree(legacy_details_dir)
    legacy_json = output.parent / "direct-connections.json"
    legacy_details_db = output.parent / "direct-connection-details.db"
    if legacy_json.exists():
        legacy_json.unlink()
    if legacy_details_db.exists() and legacy_details_db != details_db:
        try:
            legacy_details_db.unlink()
        except PermissionError:
            print(f"Could not remove locked legacy file {legacy_details_db}; continuing", file=sys.stderr)
    if details_db.exists():
        details_db.unlink()

    ordered_detail_dates = sorted(detail_dates)
    remapped_date_index = {day: index for index, day in enumerate(ordered_detail_dates)}

    def remap_mask(mask: int) -> int:
        next_mask = 0
        for original_day, original_index in detail_date_to_index.items():
            if mask & (1 << original_index):
                next_mask |= 1 << remapped_date_index[original_day]
        return next_mask

    detail_station_count = 0
    detail_connection_count = 0
    detail_departure_pattern_count = 0
    output_json = json.dumps(output_data, ensure_ascii=False, separators=(",", ":"))

    db = sqlite3.connect(details_db)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("CREATE TABLE main_data (id INTEGER PRIMARY KEY CHECK (id = 1), data_compressed BLOB NOT NULL)")
    db.execute("CREATE TABLE origin_details (origin_id TEXT PRIMARY KEY, data_compressed BLOB NOT NULL)")
    db.executemany(
        "INSERT INTO metadata (key, value) VALUES (?, ?)",
        [
            ("schemaVersion", "1"),
            ("generatedAt", output_data["generatedAt"]),
            ("version", output_data["version"]),
            ("serviceDates", json.dumps([day.isoformat() for day in ordered_detail_dates], separators=(",", ":"))),
        ],
    )
    db.execute(
        "INSERT INTO main_data (id, data_compressed) VALUES (1, ?)",
        (gzip.compress(output_json.encode("utf-8"), compresslevel=6),),
    )
    insert_detail = db.cursor()

    for origin_sid in station_ids:
        target_map = connection_details.get(origin_sid)
        if not target_map:
            continue

        serialized_connections = {}
        for target_sid, pattern_map in target_map.items():
            if target_sid not in station_to_index:
                continue
            patterns = []
            for (departure, arrival, duration, line, product), mask in sorted(
                pattern_map.items(),
                key=lambda item: (item[0][0], item[0][1], item[0][3], item[0][4]),
            ):
                remapped = remap_mask(mask)
                if remapped == 0:
                    continue
                patterns.append({
                    "d": format(remapped, "x"),
                    "dep": departure,
                    "arr": arrival,
                    "dur": duration,
                    "line": line or None,
                    "product": product,
                })
            if patterns:
                serialized_connections[target_sid] = patterns
                detail_connection_count += 1
                detail_departure_pattern_count += len(patterns)

        if not serialized_connections:
            continue

        detail_station_count += 1
        detail_payload = json.dumps(
            {
                "originId": origin_sid,
                "connections": serialized_connections,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

        insert_detail.execute(
            "INSERT INTO origin_details (origin_id, data_compressed) VALUES (?, ?)",
            (origin_sid, gzip.compress(detail_payload.encode("utf-8"), compresslevel=1)),
        )

    db.commit()
    db.execute("CREATE INDEX idx_origin_details_origin_id ON origin_details(origin_id)")
    db.execute("VACUUM")
    db.close()

    print(
        f"Wrote {details_db} ({len(output_json) / 1024 / 1024:.2f} MB overview JSON, {detail_station_count:,} station blobs, "
        f"{detail_connection_count:,} detailed edges, {detail_departure_pattern_count:,} departure patterns)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build direct train connection SQLite data from GTFS.de")
    parser.add_argument("--force-download", action="store_true", help="Download feeds even when cached ZIPs exist")
    parser.add_argument("--feeds", default="fv,rv", help="Comma-separated feed ids: fv,rv")
    parser.add_argument("--output", type=Path, default=OUTPUT_DB_FILE)
    args = parser.parse_args()

    feeds = [feed.strip() for feed in args.feeds.split(",") if feed.strip()]
    unknown = [feed for feed in feeds if feed not in FEEDS]
    if unknown:
        parser.error(f"Unknown feed id(s): {', '.join(unknown)}")

    build(feeds, args.force_download, args.output)


if __name__ == "__main__":
    main()
