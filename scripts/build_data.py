"""Extract the May 2026 Claude.ai usage per capita index for US states.

Reads the Anthropic Economic Index Claude.ai CSV (about 220 MB, kept out of the
repository), keeps the `usage_per_capita_index` rows for the 50 states and D.C.,
ranks them, splits the ranking into four equal-sized groups, and writes the
small JSON file that the web page loads.

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
DEFAULT_OUTPUT_PATH = REPO_ROOT / "data" / "usage-per-capita-2026-05.json"

PERIOD_START = "2026-05-01"
PERIOD_END_EXCLUSIVE = "2026-06-01"
PERIOD_LABEL_FORMAT = "%B %Y"
METRIC_ID = "usage_per_capita_index"
GEO_LEVEL = "subregion"
CATEGORY_NAME = "overall"
US_GEO_PREFIX = "US-"
JSON_INDENT = 2

SOURCE = {
    "name": "Anthropic Economic Index",
    "dataset": "Claude.ai usage (Free, Pro and Max plans)",
    "release_date": "2026-06-26",
    "file": "aei_claude_ai_2026-06-26.csv",
    "license": "CC BY",
    "url": "https://www.anthropic.com/research/economic-index-june-2026-report",
}

# Groups in rank order, best first. The ranking is split into this many
# equal-sized groups; when the count does not divide evenly the top groups
# take the extra place.
TIERS = (
    {"id": "leading", "label": "Leading", "note": "Top 25%"},
    {"id": "upper_middle", "label": "Upper middle", "note": "Second 25%"},
    {"id": "lower_middle", "label": "Lower middle", "note": "Third 25%"},
    {"id": "emerging", "label": "Emerging", "note": "Bottom 25%"},
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
    """One state's index value with its rank and group.

    Attributes:
        code: Two-letter postal code, for example "CA".
        name: Full state name, for example "California".
        fips: Two-digit FIPS code used by the map shapes.
        index: Usage per capita index; 1.0 means use matches population.
        rank: Competition rank (1 is highest); tied values share a rank.
        tier: Id of the rank group from TIERS.
    """

    code: str
    name: str
    fips: str
    index: float
    rank: int
    tier: str


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


def is_state_index_row(row: dict[str, str]) -> bool:
    """Tell whether a CSV row is a May 2026 state-level per capita index value.

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
        and row["metric_id"] == METRIC_ID
        and row["geo_id"].startswith(US_GEO_PREFIX)
    )


def read_state_index_values(csv_path: Path) -> dict[str, float]:
    """Read the per capita index for every US subregion in the period.

    Args:
        csv_path: Path to the Claude.ai AEI CSV.

    Returns:
        Index values keyed by postal code.

    Raises:
        FileNotFoundError: If the CSV is missing.
        ValueError: If a subregion appears more than once.
    """
    if not csv_path.is_file():
        raise FileNotFoundError(
            f"CSV not found at {csv_path}. Download the Anthropic Economic Index "
            "Claude.ai file and pass its path with --csv."
        )
    index_by_code: dict[str, float] = {}
    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        for row in csv.DictReader(csv_file):
            if not is_state_index_row(row=row):
                continue
            code = row["geo_id"].removeprefix(US_GEO_PREFIX)
            if code in index_by_code:
                raise ValueError(
                    f"Duplicate {METRIC_ID} row for {row['geo_id']} in {PERIOD_START}."
                )
            index_by_code[code] = float(row["value"])
    return index_by_code


def validate_coverage(index_by_code: dict[str, float]) -> None:
    """Check that the values cover exactly the 50 states and D.C.

    Args:
        index_by_code: Index values keyed by postal code.

    Raises:
        ValueError: If any state is missing or an unknown code is present.
    """
    missing_codes = sorted(US_STATES.keys() - index_by_code.keys())
    unexpected_codes = sorted(index_by_code.keys() - US_STATES.keys())
    if missing_codes or unexpected_codes:
        raise ValueError(
            f"State coverage mismatch for {PERIOD_START}: "
            f"missing {missing_codes or 'none'}, unexpected {unexpected_codes or 'none'}."
        )


def assign_tier(rank: int, state_count: int) -> str:
    """Map a competition rank to one of the equal-sized rank groups.

    Tied states share a rank, so a tie can never straddle two groups.

    Args:
        rank: Competition rank, 1 for the highest value.
        state_count: Number of ranked states.

    Returns:
        The id of the group from TIERS.
    """
    tier_position = (rank - 1) * len(TIERS) // state_count
    return TIERS[tier_position]["id"]


def rank_states(index_by_code: dict[str, float]) -> list[RankedState]:
    """Rank states from highest to lowest index and assign their groups.

    Args:
        index_by_code: Index values keyed by postal code.

    Returns:
        States sorted by descending index, then by name for ties.
    """
    sorted_codes = sorted(
        index_by_code,
        key=lambda code: (-index_by_code[code], US_STATES[code][0]),
    )
    state_count = len(sorted_codes)
    ranked_states: list[RankedState] = []
    for position, code in enumerate(sorted_codes, start=1):
        previous = ranked_states[-1] if ranked_states else None
        is_tied_with_previous = previous is not None and previous.index == index_by_code[code]
        rank = previous.rank if is_tied_with_previous else position
        name, fips = US_STATES[code]
        ranked_states.append(
            RankedState(
                code=code,
                name=name,
                fips=fips,
                index=index_by_code[code],
                rank=rank,
                tier=assign_tier(rank=rank, state_count=state_count),
            )
        )
    return ranked_states


def build_payload(ranked_states: list[RankedState]) -> dict:
    """Assemble the JSON document the page loads.

    Args:
        ranked_states: States in rank order.

    Returns:
        A JSON-serializable dictionary with metadata, groups and states.
    """
    period_label = date.fromisoformat(PERIOD_START).strftime(PERIOD_LABEL_FORMAT)
    return {
        "metric_id": METRIC_ID,
        "period": {
            "start": PERIOD_START,
            "end_exclusive": PERIOD_END_EXCLUSIVE,
            "label": period_label,
        },
        "source": SOURCE,
        "tiers": list(TIERS),
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
    index_by_code = read_state_index_values(csv_path=arguments.csv)
    validate_coverage(index_by_code=index_by_code)
    ranked_states = rank_states(index_by_code=index_by_code)
    write_json(payload=build_payload(ranked_states=ranked_states), output_path=arguments.output)
    print(f"Wrote {len(ranked_states)} states to {arguments.output}")


if __name__ == "__main__":
    main()
