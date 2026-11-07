"""Build the data file for the Massachusetts Claude.ai film from the AEI CSV.

Reads the Anthropic Economic Index Claude.ai CSV (about 220 MB, kept out of the
repository), keeps the May 2026 `overall` rows for the 50 states, D.C. and the
USA as a whole, derives the numbers each scene of the film needs, checks every
claim the film's captions make against them, and writes the small JSON file
that the page loads.

Usage:
    python scripts/build_data.py
    python scripts/build_data.py --csv path/to/aei_claude_ai_2026-06-26.csv
"""

import argparse
import csv
import json
import math
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV_PATH = REPO_ROOT / "aei_claude_ai_2026-06-26.csv"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "data" / "usage-per-capita-2026-05.json"

PERIOD_START = "2026-05-01"
PERIOD_END_EXCLUSIVE = "2026-06-01"
PERIOD_LABEL_FORMAT = "%B %Y"
CATEGORY_NAME = "overall"
SUBREGION_LEVEL = "subregion"
COUNTRY_LEVEL = "country"
US_COUNTRY_ID = "USA"
US_GEO_PREFIX = "US-"
JSON_INDENT = 2

METRIC_PER_CAPITA_INDEX = "usage_per_capita_index"
METRIC_USAGE_SHARE = "usage_pct"
METRIC_WORK = "use_case_work_pct"
METRIC_PERSONAL = "use_case_personal_pct"
METRIC_COURSEWORK = "use_case_coursework_pct"
USE_CASE_METRICS = (METRIC_WORK, METRIC_PERSONAL, METRIC_COURSEWORK)
STATE_METRICS = (METRIC_PER_CAPITA_INDEX, METRIC_USAGE_SHARE, *USE_CASE_METRICS)

# US subregions in the CSV that are not one of the 50 states or D.C. Puerto Rico
# has a usage share but no per capita index, so it cannot be placed in the film.
EXCLUDED_SUBREGIONS = {"PR": "Puerto Rico"}

PERCENT = 100
AVERAGE_INDEX = 1.0
DOTS_PER_BLOCK = 100
ROUNDING_DIGITS = 3
# The published shares are rounded to two decimals, so their sum may drift a
# little from 100. A larger drift means the rows are not what this script expects.
SHARE_SUM_TOLERANCE_PCT = 0.5
WORKING_AGE_SUM_TOLERANCE_PCT = 1.0

FOCUS_CODE = "MA"
HIGHEST_CODE = "DC"
NEW_ENGLAND_CODES = ("ME", "NH", "VT", "MA", "RI", "CT")
# States with an ocean or Gulf of Mexico coastline (the Great Lakes do not count).
COASTAL_CODES = frozenset(
    {
        "AK", "AL", "CA", "CT", "DE", "FL", "GA", "HI", "LA", "MA", "MD", "ME", "MS",
        "NC", "NH", "NJ", "NY", "OR", "RI", "SC", "TX", "VA", "WA",
    }
)  # fmt: skip

# Claims the captions make in words rather than in numbers. The build stops if
# the data no longer supports them, so the copy can be reworded before release.
COPY_FOCUS_RANK_PER_PERSON = 5  # "Massachusetts climbs to fifth"
COPY_TEXAS_RANK_TOTAL = 3  # "Texas, third in total, falls below average"
COPY_NEW_ENGLAND_ABOVE_AVERAGE = frozenset({"MA", "CT"})  # "Only Connecticut is also above"
COPY_SCHOOLWORK_MULTIPLE = 2  # "about twice as much schoolwork"
COPY_LARGEST_TOTAL_CODE = "CA"  # "California alone sends about 1 in 5"
COPY_LOWEST_CODE = "WV"  # "D.C. uses it 13 times as much as West Virginia"
# "nobody comes close": the runner-up must trail Massachusetts by at least this
# many conversations per 100 expected.
COPY_NEW_ENGLAND_MIN_LEAD = 25
COPY_HIGHEST_LEAD_MULTIPLE = 2  # Classic view: "D.C. leads ... more than double any state"

SOURCE = {
    "name": "Anthropic Economic Index",
    "dataset": "Claude.ai usage (Free, Pro and Max plans)",
    "release_date": "2026-06-26",
    "file": "aei_claude_ai_2026-06-26.csv",
    "license": "CC BY",
    "url": "https://www.anthropic.com/research/economic-index-june-2026-report",
}

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


class StoryClaimError(ValueError):
    """Raised when the data no longer supports a sentence in the film's captions."""


@dataclass(frozen=True)
class UseCaseShares:
    """How a place's conversations split by purpose, in percent.

    Attributes:
        work: Share of conversations about work.
        personal: Share of conversations about personal life.
        coursework: Share of conversations about schoolwork.
    """

    work: float
    personal: float
    coursework: float


@dataclass(frozen=True)
class StateRecord:
    """One state's May 2026 numbers, ranked against the other 50 places.

    Attributes:
        code: Two-letter postal code, for example "MA".
        name: Full state name, for example "Massachusetts".
        fips: Two-digit FIPS code used by the map shapes.
        per_capita_index: Share of US conversations divided by share of US
            residents aged 15 to 64; 1.0 is the US average.
        per_100_expected: The index as conversations per 100 expected at the
            US average rate, rounded to a whole number.
        rank_per_person: Competition rank by per capita index (1 is highest).
        usage_share_pct: Share of all US Claude.ai conversations, in percent.
        rank_total: Competition rank by share of conversations (1 is highest).
        working_age_share_pct: Estimated share of US residents aged 15 to 64,
            derived as usage share divided by per capita index.
        use_case_pct: How the state's conversations split by purpose.
    """

    code: str
    name: str
    fips: str
    per_capita_index: float
    per_100_expected: int
    rank_per_person: int
    usage_share_pct: float
    rank_total: int
    working_age_share_pct: float
    use_case_pct: UseCaseShares


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


def geo_key_for_row(row: dict[str, str]) -> str | None:
    """Return the place a CSV row belongs to, or None if the film does not use it.

    Args:
        row: One CSV row keyed by column name.

    Returns:
        A postal code such as "MA", the country id "USA", or None.
    """
    is_wanted_row = (
        row["date_start"] == PERIOD_START
        and row["date_end"] == PERIOD_END_EXCLUSIVE
        and row["category_name"] == CATEGORY_NAME
    )
    if not is_wanted_row:
        return None
    if row["geo_level"] == COUNTRY_LEVEL and row["geo_id"] == US_COUNTRY_ID:
        return US_COUNTRY_ID
    if row["geo_level"] == SUBREGION_LEVEL and row["geo_id"].startswith(US_GEO_PREFIX):
        return row["geo_id"].removeprefix(US_GEO_PREFIX)
    return None


def read_metric_values(csv_path: Path) -> dict[str, dict[str, float]]:
    """Read the film's metrics for every US subregion and the USA.

    Args:
        csv_path: Path to the Claude.ai AEI CSV.

    Returns:
        Metric values keyed by place ("MA", "USA", ...) and then by metric id.

    Raises:
        FileNotFoundError: If the CSV is missing.
        ValueError: If a place has the same metric twice.
    """
    if not csv_path.is_file():
        raise FileNotFoundError(
            f"CSV not found at {csv_path}. Download the Anthropic Economic Index "
            "Claude.ai file and pass its path with --csv."
        )
    values_by_place: dict[str, dict[str, float]] = {}
    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        for row in csv.DictReader(csv_file):
            if row["metric_id"] not in STATE_METRICS:
                continue
            place = geo_key_for_row(row=row)
            if place is None:
                continue
            place_values = values_by_place.setdefault(place, {})
            if row["metric_id"] in place_values:
                raise ValueError(
                    f"Duplicate {row['metric_id']} row for {row['geo_id']} in {PERIOD_START}."
                )
            place_values[row["metric_id"]] = float(row["value"])
    return values_by_place


def validate_coverage(values_by_place: dict[str, dict[str, float]]) -> None:
    """Check that every state, D.C. and the USA have every metric the film needs.

    Args:
        values_by_place: Metric values keyed by place and metric id.

    Raises:
        ValueError: If a place or metric is missing, or an unknown place appears.
    """
    expected_places = US_STATES.keys() | {US_COUNTRY_ID}
    known_places = expected_places | EXCLUDED_SUBREGIONS.keys()
    missing_places = sorted(expected_places - values_by_place.keys())
    unexpected_places = sorted(values_by_place.keys() - known_places)
    if missing_places or unexpected_places:
        raise ValueError(
            f"Place coverage mismatch for {PERIOD_START}: "
            f"missing {missing_places or 'none'}, unexpected {unexpected_places or 'none'}."
        )
    for code in US_STATES:
        missing_metrics = sorted(set(STATE_METRICS) - values_by_place[code].keys())
        if missing_metrics:
            raise ValueError(f"{code} has no {missing_metrics} rows for {PERIOD_START}.")
    missing_us_metrics = sorted(set(USE_CASE_METRICS) - values_by_place[US_COUNTRY_ID].keys())
    if missing_us_metrics:
        raise ValueError(f"USA has no {missing_us_metrics} rows for {PERIOD_START}.")


def read_use_case_shares(metric_values: dict[str, float]) -> UseCaseShares:
    """Pull one place's work, personal and schoolwork shares out of its metrics.

    Args:
        metric_values: One place's metric values keyed by metric id.

    Returns:
        The place's use case shares.
    """
    return UseCaseShares(
        work=metric_values[METRIC_WORK],
        personal=metric_values[METRIC_PERSONAL],
        coursework=metric_values[METRIC_COURSEWORK],
    )


def competition_ranks(value_by_code: dict[str, float]) -> dict[str, int]:
    """Rank places from highest to lowest value; tied values share a rank.

    Args:
        value_by_code: One value per postal code.

    Returns:
        Competition rank per postal code (1 is the highest value).
    """
    sorted_values = sorted(value_by_code.values(), reverse=True)
    return {code: sorted_values.index(value) + 1 for code, value in value_by_code.items()}


def build_state_records(values_by_place: dict[str, dict[str, float]]) -> list[StateRecord]:
    """Combine each state's metrics into a ranked record.

    Args:
        values_by_place: Metric values keyed by place and metric id.

    Returns:
        Records sorted by per capita index (highest first), then by name.
    """
    index_by_code = {code: values_by_place[code][METRIC_PER_CAPITA_INDEX] for code in US_STATES}
    share_by_code = {code: values_by_place[code][METRIC_USAGE_SHARE] for code in US_STATES}
    rank_per_person = competition_ranks(value_by_code=index_by_code)
    rank_total = competition_ranks(value_by_code=share_by_code)
    records = [
        StateRecord(
            code=code,
            name=name,
            fips=fips,
            per_capita_index=index_by_code[code],
            per_100_expected=round(index_by_code[code] * PERCENT),
            rank_per_person=rank_per_person[code],
            usage_share_pct=share_by_code[code],
            rank_total=rank_total[code],
            working_age_share_pct=round(share_by_code[code] / index_by_code[code], ROUNDING_DIGITS),
            use_case_pct=read_use_case_shares(metric_values=values_by_place[code]),
        )
        for code, (name, fips) in US_STATES.items()
    ]
    return sorted(records, key=lambda record: (record.rank_per_person, record.name))


def validate_share_sums(records: list[StateRecord]) -> None:
    """Check that the 51 usage shares and derived population shares each sum to 100.

    Args:
        records: All state records.

    Raises:
        ValueError: If either sum drifts further than rounding can explain.
    """
    usage_sum = sum(record.usage_share_pct for record in records)
    working_age_sum = sum(record.working_age_share_pct for record in records)
    if abs(usage_sum - PERCENT) > SHARE_SUM_TOLERANCE_PCT:
        raise ValueError(f"State usage shares sum to {usage_sum:.2f}%, expected about 100%.")
    if abs(working_age_sum - PERCENT) > WORKING_AGE_SUM_TOLERANCE_PCT:
        raise ValueError(
            f"Derived working-age shares sum to {working_age_sum:.2f}%, expected about 100%."
        )


def split_into_dots(shares: UseCaseShares, dot_count: int) -> dict[str, int]:
    """Split a block of dots across the use cases by the largest remainder method.

    Args:
        shares: Use case shares in percent.
        dot_count: How many dots the block holds.

    Returns:
        Whole dot counts per use case that add up to `dot_count`.
    """
    share_by_use_case = asdict(shares)
    share_total = sum(share_by_use_case.values())
    exact_counts = {
        use_case: share / share_total * dot_count for use_case, share in share_by_use_case.items()
    }
    dot_counts = {use_case: math.floor(exact) for use_case, exact in exact_counts.items()}
    leftover = dot_count - sum(dot_counts.values())
    largest_remainders = sorted(
        exact_counts,
        key=lambda use_case: exact_counts[use_case] - dot_counts[use_case],
        reverse=True,
    )[:leftover]
    for use_case in largest_remainders:
        dot_counts[use_case] += 1
    return dot_counts


def one_in(share_pct: float) -> int:
    """Express a percentage as "1 in N", with N rounded to a whole number.

    Args:
        share_pct: A share in percent, for example 12.48.

    Returns:
        N, for example 8.
    """
    return round(PERCENT / share_pct)


def build_dot_blocks(focus: StateRecord, us_shares: UseCaseShares) -> dict[str, dict[str, int]]:
    """Work out the dot blocks for the Massachusetts and "what for" scenes.

    Args:
        focus: The Massachusetts record.
        us_shares: The USA's use case shares.

    Returns:
        Dot counts per use case for each block.

    Raises:
        StoryClaimError: If growing the focus block would recolor existing dots.
    """
    focus_block = split_into_dots(shares=focus.use_case_pct, dot_count=DOTS_PER_BLOCK)
    focus_per_person_block = split_into_dots(
        shares=focus.use_case_pct, dot_count=focus.per_100_expected
    )
    shrinking_use_cases = [
        use_case
        for use_case, count in focus_block.items()
        if focus_per_person_block[use_case] < count
    ]
    if shrinking_use_cases:
        raise StoryClaimError(
            f"The per person block has fewer {shrinking_use_cases} dots than the 100-dot "
            "block, so the film cannot grow one into the other without recoloring dots."
        )
    return {
        "focus_100": focus_block,
        "focus_per_person": focus_per_person_block,
        "us_100": split_into_dots(shares=us_shares, dot_count=DOTS_PER_BLOCK),
    }


def require(is_true: bool, message: str) -> None:
    """Stop the build when the data contradicts a caption.

    Args:
        is_true: Whether the claim holds.
        message: What the caption says and what to change.

    Raises:
        StoryClaimError: If the claim does not hold.
    """
    if not is_true:
        raise StoryClaimError(message)


def build_film_facts(records: list[StateRecord], us_shares: UseCaseShares) -> dict:
    """Derive every number the film's captions show and check the worded claims.

    Args:
        records: All state records in per capita rank order.
        us_shares: The USA's use case shares.

    Returns:
        The facts the page binds into captions and scenes.

    Raises:
        StoryClaimError: If the data no longer supports a caption.
    """
    by_code = {record.code: record for record in records}
    focus = by_code[FOCUS_CODE]
    states_only = [record for record in records if record.code != HIGHEST_CODE]
    above_average = [record for record in records if record.per_capita_index > AVERAGE_INDEX]
    above_average_states = [record for record in above_average if record.code != HIGHEST_CODE]
    largest_total = max(records, key=lambda record: record.usage_share_pct)
    texas = by_code["TX"]
    highest = max(records, key=lambda record: record.per_capita_index)
    lowest = min(records, key=lambda record: record.per_capita_index)
    new_england = sorted(
        (by_code[code] for code in NEW_ENGLAND_CODES),
        key=lambda record: -record.per_capita_index,
    )
    other_above_average = [record for record in above_average if record.code != FOCUS_CODE]
    other_coastal = [record for record in other_above_average if record.code in COASTAL_CODES]
    below_average_working_age = sum(
        record.working_age_share_pct
        for record in records
        if record.per_capita_index < AVERAGE_INDEX
    )
    schoolwork_multiple = (
        focus.per_capita_index * focus.use_case_pct.coursework / us_shares.coursework
    )

    require(
        focus.rank_per_person == COPY_FOCUS_RANK_PER_PERSON
        and focus.rank_total > focus.rank_per_person,
        f"Massachusetts ranks {focus.rank_per_person} per person and {focus.rank_total} in total; "
        "update 'Massachusetts climbs to fifth'.",
    )
    require(
        texas.rank_total == COPY_TEXAS_RANK_TOTAL and texas.per_capita_index < AVERAGE_INDEX,
        f"Texas ranks {texas.rank_total} in total with index {texas.per_capita_index}; "
        "update 'Texas, third in total, falls below average'.",
    )
    require(
        largest_total.code == COPY_LARGEST_TOTAL_CODE,
        f"{largest_total.name} sends the most conversations; update the California caption.",
    )
    require(
        by_code[HIGHEST_CODE].per_capita_index > AVERAGE_INDEX,
        "D.C. is not above the US average; update 'Only 15 states and D.C.'.",
    )
    require(
        len(other_coastal) * 2 > len(other_above_average),
        "Fewer than half of the other above-average states are coastal; update "
        "'most of the others are on a coast'.",
    )
    new_england_above = {r.code for r in new_england if r.per_capita_index > AVERAGE_INDEX}
    require(
        new_england_above == COPY_NEW_ENGLAND_ABOVE_AVERAGE,
        f"New England states above average are {sorted(new_england_above)}; update "
        "'Only Connecticut is also above the US average'.",
    )
    require(
        new_england[0].code == FOCUS_CODE
        and focus.per_100_expected - new_england[1].per_100_expected >= COPY_NEW_ENGLAND_MIN_LEAD,
        "Another New England state is close to Massachusetts; update 'nobody comes close'.",
    )
    require(
        below_average_working_age > PERCENT / 2,
        f"Only {below_average_working_age:.1f}% of residents live in below-average states; "
        "update 'Most of the country sits below the average'.",
    )
    require(
        highest.code == HIGHEST_CODE and lowest.code == COPY_LOWEST_CODE,
        f"The extremes are {highest.code} and {lowest.code}; "
        "update the D.C. and West Virginia scene.",
    )
    runner_up = sorted(records, key=lambda record: -record.per_capita_index)[1]
    require(
        highest.per_capita_index > COPY_HIGHEST_LEAD_MULTIPLE * runner_up.per_capita_index,
        f"D.C. is not more than double {runner_up.name}; update the classic view's top 10 title.",
    )
    require(
        round(schoolwork_multiple) == COPY_SCHOOLWORK_MULTIPLE,
        f"Massachusetts does {schoolwork_multiple:.2f} times the US schoolwork per person; "
        "update 'about twice as much schoolwork'.",
    )

    return {
        "focus_code": FOCUS_CODE,
        "average_per_100": DOTS_PER_BLOCK,
        "focus_states_below": sum(
            1 for record in states_only if record.per_capita_index < focus.per_capita_index
        ),
        "focus_per_100_expected": focus.per_100_expected,
        "focus_extra_pct": focus.per_100_expected - DOTS_PER_BLOCK,
        "largest_total_code": largest_total.code,
        "largest_total_one_in": one_in(share_pct=largest_total.usage_share_pct),
        "above_average_state_count": len(above_average_states),
        "new_england_codes": [record.code for record in new_england],
        "highest_code": highest.code,
        "lowest_code": lowest.code,
        "highest_to_lowest_multiple": round(highest.per_capita_index / lowest.per_capita_index),
        "focus_schoolwork_one_in": one_in(share_pct=focus.use_case_pct.coursework),
        "us_schoolwork_one_in": one_in(share_pct=us_shares.coursework),
        "focus_schoolwork_per_person_multiple": round(schoolwork_multiple, 2),
        "dots": build_dot_blocks(focus=focus, us_shares=us_shares),
    }


def build_payload(records: list[StateRecord], us_shares: UseCaseShares) -> dict:
    """Assemble the JSON document the page loads.

    Args:
        records: All state records in per capita rank order.
        us_shares: The USA's use case shares.

    Returns:
        A JSON-serializable dictionary with metadata, US figures, film facts and states.
    """
    period_label = date.fromisoformat(PERIOD_START).strftime(PERIOD_LABEL_FORMAT)
    return {
        "period": {
            "start": PERIOD_START,
            "end_exclusive": PERIOD_END_EXCLUSIVE,
            "label": period_label,
        },
        "source": SOURCE,
        "us": {"use_case_pct": asdict(us_shares)},
        "film": build_film_facts(records=records, us_shares=us_shares),
        "states": [asdict(record) for record in records],
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
    values_by_place = read_metric_values(csv_path=arguments.csv)
    validate_coverage(values_by_place=values_by_place)
    records = build_state_records(values_by_place=values_by_place)
    validate_share_sums(records=records)
    us_shares = read_use_case_shares(metric_values=values_by_place[US_COUNTRY_ID])
    payload = build_payload(records=records, us_shares=us_shares)
    write_json(payload=payload, output_path=arguments.output)
    print(f"Wrote {len(records)} states and the film's facts to {arguments.output}")


if __name__ == "__main__":
    main()
