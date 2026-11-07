"""Extract the May 2026 Claude.ai state values that the story page uses.

Reads the Anthropic Economic Index Claude.ai CSV (about 220 MB, kept out of the
repository) and keeps four values for each of the 50 states and D.C.: the usage
per capita index and the shares of conversations for work, personal use and
coursework. It checks those values, ranks the states, puts each one in a band by
where its index sits relative to 1.0, and writes the small JSON file that the
page loads.

Usage:
    python scripts/build_data.py
    python scripts/build_data.py --csv path/to/aei_claude_ai_2026-06-26.csv
"""

import argparse
import csv
import json
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV_PATH = REPO_ROOT / "aei_claude_ai_2026-06-26.csv"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "data" / "claude-ai-by-state-2026-05.json"

PERIOD_START = "2026-05-01"
PERIOD_END_EXCLUSIVE = "2026-06-01"
PERIOD_LABEL_FORMAT = "%B %Y"
GEO_LEVEL = "subregion"
CATEGORY_NAME = "overall"
US_GEO_PREFIX = "US-"
JSON_INDENT = 2

INDEX_METRIC = "usage_per_capita_index"
WORK_METRIC = "use_case_work_pct"
PERSONAL_METRIC = "use_case_personal_pct"
COURSEWORK_METRIC = "use_case_coursework_pct"
METRIC_IDS = (INDEX_METRIC, WORK_METRIC, PERSONAL_METRIC, COURSEWORK_METRIC)
USE_CASE_METRICS = (WORK_METRIC, PERSONAL_METRIC, COURSEWORK_METRIC)

# The three use-case shares split every conversation, so they add up to 100.
# Each is rounded to two decimals, so their sum can be off by up to 0.015.
USE_CASE_TOTAL_PCT = 100.0
USE_CASE_TOTAL_TOLERANCE = 0.02

# US subregions in the CSV that are not one of the 50 states or D.C. Puerto Rico
# has use-case shares but no per capita index, so the page leaves it out.
IGNORED_CODES = frozenset({"PR"})

SOURCE = {
    "name": "Anthropic Economic Index",
    "dataset": "Claude.ai usage (Free, Pro and Max plans)",
    "release_date": "2026-06-26",
    "file": "aei_claude_ai_2026-06-26.csv",
    "license": "CC BY",
    "url": "https://www.anthropic.com/research/economic-index-june-2026-report",
}

# Index values that split the bands. 1.0 means a state's share of US use equals
# its share of US working-age people.
EVEN_INDEX = 1.0
HALF_INDEX = 0.5
DOUBLE_INDEX = 2.0

BAND_LESS_THAN_HALF = "less_than_half"
BAND_BELOW = "below"
BAND_EVEN = "even"
BAND_ABOVE = "above"
BAND_MORE_THAN_DOUBLE = "more_than_double"

# Bands from lowest to highest index, the order the map key shows them in.
BANDS = (
    {"id": BAND_LESS_THAN_HALF, "label": "Less than half", "range": "Under 0.5"},
    {"id": BAND_BELOW, "label": "Below 1.0", "range": "0.5 to 1"},
    {"id": BAND_EVEN, "label": "At 1.0", "range": "1.0"},
    {"id": BAND_ABOVE, "label": "Above 1.0", "range": "1 to 2"},
    {"id": BAND_MORE_THAN_DOUBLE, "label": "More than double", "range": "Over 2"},
)

# Postal code -> (name, FIPS code). FIPS codes join the data to the map shapes.
US_STATES = {
    "AL": ("Alabama", "01"),
    "AK": ("Alaska", "02"),
    "AZ": ("Arizona", "04"),
    "AR": ("Arkansas", "05"),
    "CA": ("California", "06"),
    "CO": ("Colorado", "08"),
    "CT": ("Connecticut", "09"),
    "DE": ("Delaware", "10"),
    "DC": ("District of Columbia", "11"),
    "FL": ("Florida", "12"),
    "GA": ("Georgia", "13"),
    "HI": ("Hawaii", "15"),
    "ID": ("Idaho", "16"),
    "IL": ("Illinois", "17"),
    "IN": ("Indiana", "18"),
    "IA": ("Iowa", "19"),
    "KS": ("Kansas", "20"),
    "KY": ("Kentucky", "21"),
    "LA": ("Louisiana", "22"),
    "ME": ("Maine", "23"),
    "MD": ("Maryland", "24"),
    "MA": ("Massachusetts", "25"),
    "MI": ("Michigan", "26"),
    "MN": ("Minnesota", "27"),
    "MS": ("Mississippi", "28"),
    "MO": ("Missouri", "29"),
    "MT": ("Montana", "30"),
    "NE": ("Nebraska", "31"),
    "NV": ("Nevada", "32"),
    "NH": ("New Hampshire", "33"),
    "NJ": ("New Jersey", "34"),
    "NM": ("New Mexico", "35"),
    "NY": ("New York", "36"),
    "NC": ("North Carolina", "37"),
    "ND": ("North Dakota", "38"),
    "OH": ("Ohio", "39"),
    "OK": ("Oklahoma", "40"),
    "OR": ("Oregon", "41"),
    "PA": ("Pennsylvania", "42"),
    "RI": ("Rhode Island", "44"),
    "SC": ("South Carolina", "45"),
    "SD": ("South Dakota", "46"),
    "TN": ("Tennessee", "47"),
    "TX": ("Texas", "48"),
    "UT": ("Utah", "49"),
    "VT": ("Vermont", "50"),
    "VA": ("Virginia", "51"),
    "WA": ("Washington", "53"),
    "WV": ("West Virginia", "54"),
    "WI": ("Wisconsin", "55"),
    "WY": ("Wyoming", "56"),
}


@dataclass(frozen=True)
class RankedState:
    """One state's values with its rank and band.

    Attributes:
        code: Two-letter postal code, for example "CA".
        name: Full state name, for example "California".
        fips: Two-digit FIPS code used by the map shapes.
        index: Usage per capita index; 1.0 means use matches population.
        rank: Competition rank (1 is highest); tied values share a rank.
        band: Id of the band from BANDS.
        work_pct: Percent of the state's conversations that are for work.
        personal_pct: Percent of the state's conversations that are personal.
        coursework_pct: Percent of the state's conversations for coursework.
    """

    code: str
    name: str
    fips: str
    index: float
    rank: int
    band: str
    work_pct: float
    personal_pct: float
    coursework_pct: float


def parse_arguments() -> argparse.Namespace:
    """Parse command-line options.

    Returns:
        The parsed options with `csv` and `output` paths.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help=f"Path to the Claude.ai AEI CSV (default: {DEFAULT_CSV_PATH.name})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Where to write the JSON file the page loads",
    )
    return parser.parse_args()


def is_state_metric_row(row: dict[str, str]) -> bool:
    """Tell whether a CSV row is a May 2026 US subregion value the page uses.

    Args:
        row: One CSV row keyed by column name.

    Returns:
        True when the row belongs in the output.
    """
    return (
        row["date_start"] == PERIOD_START
        and row["date_end"] == PERIOD_END_EXCLUSIVE
        and row["geo_level"] == GEO_LEVEL
        and row["category_name"] == CATEGORY_NAME
        and row["metric_id"] in METRIC_IDS
        and row["geo_id"].startswith(US_GEO_PREFIX)
    )


def read_state_metrics(csv_path: Path) -> dict[str, dict[str, float]]:
    """Read the page's metrics for every US subregion in the period.

    Args:
        csv_path: Path to the Claude.ai AEI CSV.

    Returns:
        Metric values keyed by postal code, then by metric id. Codes in
        IGNORED_CODES are left out.

    Raises:
        FileNotFoundError: If the CSV is missing.
        ValueError: If a subregion has the same metric more than once.
    """
    if not csv_path.is_file():
        raise FileNotFoundError(
            f"CSV not found at {csv_path}. Download the Anthropic Economic Index "
            "Claude.ai file and pass its path with --csv."
        )
    metrics_by_code: dict[str, dict[str, float]] = {}
    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        for row in csv.DictReader(csv_file):
            if not is_state_metric_row(row=row):
                continue
            code = row["geo_id"].removeprefix(US_GEO_PREFIX)
            if code in IGNORED_CODES:
                continue
            state_metrics = metrics_by_code.setdefault(code, {})
            if row["metric_id"] in state_metrics:
                raise ValueError(
                    f"Duplicate {row['metric_id']} row for {row['geo_id']} in {PERIOD_START}."
                )
            state_metrics[row["metric_id"]] = float(row["value"])
    return metrics_by_code


def validate_coverage(metrics_by_code: dict[str, dict[str, float]]) -> None:
    """Check that every metric is present for exactly the 50 states and D.C.

    Args:
        metrics_by_code: Metric values keyed by postal code, then metric id.

    Raises:
        ValueError: If a state or a metric is missing, or an unknown code appears.
    """
    missing_codes = sorted(US_STATES.keys() - metrics_by_code.keys())
    unexpected_codes = sorted(metrics_by_code.keys() - US_STATES.keys())
    if missing_codes or unexpected_codes:
        raise ValueError(
            f"State coverage mismatch for {PERIOD_START}: "
            f"missing {missing_codes or 'none'}, unexpected {unexpected_codes or 'none'}."
        )
    for code, state_metrics in sorted(metrics_by_code.items()):
        missing_metrics = ", ".join(metric for metric in METRIC_IDS if metric not in state_metrics)
        if missing_metrics:
            raise ValueError(f"{code} has no {missing_metrics} value for {PERIOD_START}.")


def validate_use_case_totals(metrics_by_code: dict[str, dict[str, float]]) -> None:
    """Check that each state's work, personal and coursework shares add up to 100.

    Args:
        metrics_by_code: Metric values keyed by postal code, then metric id.

    Raises:
        ValueError: If any state's shares are further from 100 than rounding allows.
    """
    for code, state_metrics in sorted(metrics_by_code.items()):
        total = sum(state_metrics[metric] for metric in USE_CASE_METRICS)
        if abs(total - USE_CASE_TOTAL_PCT) > USE_CASE_TOTAL_TOLERANCE:
            raise ValueError(
                f"{code} use-case shares add up to {total:.2f}, not {USE_CASE_TOTAL_PCT:.0f}. "
                "Check that the CSV still splits conversations into work, personal and coursework."
            )


def assign_band(index_value: float) -> str:
    """Put an index value in a band by where it sits relative to 1.0.

    Args:
        index_value: Usage per capita index, as published (two decimals).

    Returns:
        The id of the band from BANDS.
    """
    if index_value < HALF_INDEX:
        return BAND_LESS_THAN_HALF
    if index_value < EVEN_INDEX:
        return BAND_BELOW
    if index_value == EVEN_INDEX:
        return BAND_EVEN
    if index_value <= DOUBLE_INDEX:
        return BAND_ABOVE
    return BAND_MORE_THAN_DOUBLE


def rank_states(metrics_by_code: dict[str, dict[str, float]]) -> list[RankedState]:
    """Rank states from highest to lowest index and assign their bands.

    Args:
        metrics_by_code: Metric values keyed by postal code, then metric id.

    Returns:
        States sorted by descending index, then by name for ties.
    """
    sorted_codes = sorted(
        metrics_by_code,
        key=lambda code: (-metrics_by_code[code][INDEX_METRIC], US_STATES[code][0]),
    )
    ranked_states: list[RankedState] = []
    for position, code in enumerate(sorted_codes, start=1):
        state_metrics = metrics_by_code[code]
        index_value = state_metrics[INDEX_METRIC]
        previous = ranked_states[-1] if ranked_states else None
        is_tied_with_previous = previous is not None and previous.index == index_value
        name, fips = US_STATES[code]
        ranked_states.append(
            RankedState(
                code=code,
                name=name,
                fips=fips,
                index=index_value,
                rank=previous.rank if is_tied_with_previous else position,
                band=assign_band(index_value=index_value),
                work_pct=state_metrics[WORK_METRIC],
                personal_pct=state_metrics[PERSONAL_METRIC],
                coursework_pct=state_metrics[COURSEWORK_METRIC],
            )
        )
    return ranked_states


def build_payload(ranked_states: list[RankedState]) -> dict:
    """Assemble the JSON document the page loads.

    Args:
        ranked_states: States in rank order.

    Returns:
        A JSON-serializable dictionary with metadata, bands and states.
    """
    period_label = date.fromisoformat(PERIOD_START).strftime(PERIOD_LABEL_FORMAT)
    return {
        "metric_ids": list(METRIC_IDS),
        "period": {
            "start": PERIOD_START,
            "end_exclusive": PERIOD_END_EXCLUSIVE,
            "label": period_label,
        },
        "source": SOURCE,
        "bands": list(BANDS),
        "states": [asdict(state) for state in ranked_states],
    }


def write_json(payload: dict, output_path: Path) -> None:
    """Write the payload as pretty-printed UTF-8 JSON.

    Args:
        payload: The document to write.
        output_path: Destination file; parent folders are created.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, indent=JSON_INDENT, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    """Build the page's data file from the full AEI CSV."""
    arguments = parse_arguments()
    metrics_by_code = read_state_metrics(csv_path=arguments.csv)
    validate_coverage(metrics_by_code=metrics_by_code)
    validate_use_case_totals(metrics_by_code=metrics_by_code)
    ranked_states = rank_states(metrics_by_code=metrics_by_code)
    write_json(payload=build_payload(ranked_states=ranked_states), output_path=arguments.output)
    print(f"Wrote {len(ranked_states)} states to {arguments.output}")


if __name__ == "__main__":
    main()
