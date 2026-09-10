import glob
import json
import os
import sqlite3


TIME_FIELDS = ["agent_time_ms", "interaction_time_ms", "generation_time_ms"]
SPEECH_FIELDS = [
    "recordingDurationMs",
    "audioPreparationTimeMs",
    "requestRoundTripTimeMs",
    "backendTotalTimeMs",
    "whisperInferenceTimeMs",
    "textRenderTimeMs",
    "userWaitLatencyMs",
]


def avg(values):
    nums = [float(value) for value in values if value is not None]
    return None if not nums else sum(nums) / len(nums)


def fmt(value):
    return "n/a" if value is None else f"{value:.1f}"


def main():
    for db_path in sorted(glob.glob(os.path.join("backend", "*.db"))):
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        tables = {
            row[0]
            for row in cur.execute("select name from sqlite_master where type='table'")
        }

        print(f"\nDB {os.path.basename(db_path)} size={os.path.getsize(db_path)}")

        if "Nodes" in tables or "nodes" in tables:
            row = cur.execute(
                "select count(*) c, min(created_at) min_t, max(created_at) max_t from Nodes"
            ).fetchone()
            print(f" Nodes count={row['c']} range={row['min_t']} -> {row['max_t']}")
            for item in cur.execute(
                """
                select module_id, count(*) c, min(created_at) min_t, max(created_at) max_t
                from Nodes
                group by module_id
                order by c desc
                """
            ):
                print(
                    "  module %-24s count=%3s range=%s -> %s"
                    % (
                        str(item["module_id"])[:24],
                        item["c"],
                        item["min_t"],
                        item["max_t"],
                    )
                )

        if "InteractionMetrics" in tables:
            row = cur.execute(
                """
                select count(*) c, min(created_at) min_t, max(created_at) max_t
                from InteractionMetrics
                """
            ).fetchone()
            print(f" Metrics count={row['c']} range={row['min_t']} -> {row['max_t']}")
            rows = cur.execute("select * from InteractionMetrics").fetchall()
            print(
                "  avg_ms agent=%s interaction=%s generation=%s"
                % (
                    fmt(avg([item["agent_time_ms"] for item in rows])),
                    fmt(avg([item["interaction_time_ms"] for item in rows])),
                    fmt(avg([item["generation_time_ms"] for item in rows])),
                )
            )
            for item in cur.execute(
                """
                select event_type, module_id, count(*) c,
                       avg(agent_time_ms) a,
                       avg(interaction_time_ms) i,
                       avg(generation_time_ms) g
                from InteractionMetrics
                group by event_type, module_id
                order by c desc
                limit 20
                """
            ):
                print(
                    "  event %-22s module %-20s n=%3s avg_ms a=%s i=%s g=%s"
                    % (
                        str(item["event_type"])[:22],
                        str(item["module_id"])[:20],
                        item["c"],
                        fmt(item["a"]),
                        fmt(item["i"]),
                        fmt(item["g"]),
                    )
                )

            speech_values = {key: [] for key in SPEECH_FIELDS}
            speech_count = 0
            for item in rows:
                raw = item["speech_timing"]
                if not raw:
                    continue
                try:
                    speech = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                speech_count += 1
                for key in SPEECH_FIELDS:
                    if speech.get(key) is not None:
                        speech_values[key].append(speech.get(key))

            if speech_count:
                print(f"  speech records={speech_count}")
                for key in SPEECH_FIELDS:
                    print(
                        "   speech %-26s avg_ms=%s n=%s"
                        % (key, fmt(avg(speech_values[key])), len(speech_values[key]))
                    )

        if "CompositionRecords" in tables:
            row = cur.execute(
                """
                select count(*) c, min(created_at) min_t, max(created_at) max_t
                from CompositionRecords
                """
            ).fetchone()
            print(
                f" Composition count={row['c']} range={row['min_t']} -> {row['max_t']}"
            )
            for item in cur.execute(
                """
                select export_type, count(*) c
                from CompositionRecords
                group by export_type
                order by c desc
                """
            ):
                print(f"  export {str(item['export_type']):12s} count={item['c']}")

        conn.close()


if __name__ == "__main__":
    main()
