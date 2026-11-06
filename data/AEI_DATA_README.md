# Anthropic Economic Index Data Documentation

This documentation outlines the data files, schema, and variables for this release of the Anthropic Economic Index. The core dataset contains Claude usage metrics aggregated by geography and analysis dimensions (categories) on a calendar-month basis. This release includes data for April and May 2026, with future release schedules to be announced.

## Source Files

| File | `source_id` | Description | Breakdowns by Geography |
| :---- | :---- | :---- | :---- |
| `aei_claude_ai_<date>.csv` | `claude_ai` | Claude chat and Cowork (Free, Pro, and Max plans) | global, country, subregion |
| `aei_1p_api_<date>.csv` | `1p_api` | Anthropic 1P API calls, excluding Claude Code. | global only |

## Data Schema

Each row represents one metric value for a specific geography and category combination.

| Column | Type | Description |
| :---- | :---- | :---- |
| `date_start` | date | Start of data collection period (inclusive) |
| `date_end` | date | End of data collection period (exclusive). |
| `geo_id` | string | `GLOBAL`, an ISO 3166-1 alpha-3 country code, or an ISO 3166-2 subregion code. |
| `geo_level` | string | `global`, `country`, or `subregion`. |
| `category_name` | string | Analysis dimension (see Categories below) |
| `hierarchy_level` | int | Hierarchy depth within the category. 0 is the most granular level. |
| `metric_id` | string | Metric name (see supported metrics below) |
| `value` | float | The published value, rounded to two decimal places. |
| `node_name` | string | Specific entity within the category |
| `node_external_id` | string | Source identifier for the node: O\*NET element ID, SOC code, or request-topic UUID. |

## Categories

| `category_name` | Description | Level 0 (leaf) | Level 1 | Level 2 | Level 3 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| `overall` | All conversations combined, with no topic or task breakdown. | Overall | — | — | — |
| `onet` | Work activities defined by the U.S. Department of Labor's O\*NET database. | Task | Detailed Work Activity (DWA) | Intermediate Work Activity (IWA) | Generalized Work Activity (GWA) |
| `request` | What requests users make to Claude, grouped into a topic hierarchy. | Detailed | Minor | Major | — |
| `soc_occupation` | Occupations from the U.S. Bureau of Labor Statistics' Standard Occupational Classification. | Detailed Occupation | Major Group | — | — |

## Metric Availability

| Source | Geography | Overall | O\*NET | Request | SOC | Metrics Included |
| :---- | :---- | :---: | :---: | :---: | :---: | :---- |
| `claude_ai` | Global | ✓ | ✓ | ✓ | ✓ | All Metrics |
| `claude_ai` | Country | ✓ | — | — | — | All Metrics |
| `claude_ai` | Country | — | ✓ | ✓ | ✓ | `pct` |
| `claude_ai` | Country | — | GWA | Major | Major Group | All Metrics |
| `claude_ai` | Subregion | ✓ | — | — | — | All Metrics |
| `claude_ai` | Subregion | — | ✓ | ✓ | ✓ | `pct` |
| `1p_api` | Global | ✓ | ✓ | ✓ | ✓ | All Metrics |

A cell is only published if it meets both the aggregation thresholds and the geography sample floor for the given row. The geography sample floor is the minimum number of sampled conversations a geography must have in a period to publish metrics for the breakdowns defined in that row. `usage_per_capita_index` at the subregion grain is published only for US states. A missing row means the cell was not published, not necessarily that the value is zero.

## Metrics

| `metric_id` | Unit | Description |
| :---- | :---- | :---- |
| `usage_pct` | percent | Percentage of total usage (relative to parent geography: global for countries, parent country for subregions). |
| `usage_per_capita_index` | index | Anthropic Usage Index - Usage share divided by working-age (15-64) population share. 1.0 means proportional to population. Countries and US states only. |
| `pct` | percent | Percentage of the geography's total in this category node. |
| `multitasking_pct` | percent | Multitasking status assigned to `yes` (the conversation involves more than one distinct task). |
| `human_only_ability_pct` | percent | Human-only ability status assigned to `yes` (a human could complete the task without AI assistance). |
| `ai_autonomy_mean` | 1-5 scale | Mean degree of AI autonomy in task completion. |
| `ai_education_years_mean` | years | Mean estimated equivalent years of AI "education" demonstrated. |
| `human_education_years_mean` | years | Mean estimated years of human education required for the task. |
| `human_only_time_mean` | hours | Mean estimated time for a human to complete the task without AI. |
| `human_with_ai_time_mean` | minutes | Mean estimated time for a human to complete the task with AI assistance. |
| `use_case_work_pct` | percent | Use case category assigned to `work`. |
| `use_case_personal_pct` | percent | Use case category assigned to `personal`. |
| `use_case_coursework_pct` | percent | Use case category assigned to `coursework`. |
| `collaboration_bucket_automation_pct` | percent | Human-AI collaboration bucket assigned to `automation`. |
| `collaboration_bucket_augmentation_pct` | percent | Human-AI collaboration bucket assigned to `augmentation`. |
| `collaboration_directive_pct` | percent | Human-AI collaboration pattern assigned to `directive`. |
| `collaboration_feedback_loop_pct` | percent | Human-AI collaboration pattern assigned to `feedback_loop`. |
| `collaboration_task_iteration_pct` | percent | Human-AI collaboration pattern assigned to `task_iteration`. |
| `collaboration_learning_pct` | percent | Human-AI collaboration pattern assigned to `learning`. |
| `collaboration_validation_pct` | percent | Human-AI collaboration pattern assigned to `validation`. |
| `collaboration_none_pct` | percent | Human-AI collaboration pattern assigned to `none`. |
| `artifact_{label}_pct` | percent | Artifact type assigned to `{label}`, defined as the most prominent concrete output Claude produced. One metric per label (see Artifact labels below). |

## License

Data released under CC-BY.

## Contact

For press inquiries, contact press@anthropic.com. For all other questions, reach out to econ-research@anthropic.com.

## Citation

```
@online{anthropic2026aeiv6,
        author = {Maxim Massenkoff and Eva Lyubich and Szymon Sacher and Zoe Hitzig and Shaoyi Zhang and Ryan Heller and Peter McCrory},
        title = {Anthropic Economic Index report: Cadences},
        date = {2026-06-26},
        year = {2026},
        url = {https://www.anthropic.com/research/economic-index-june-2026-report},
}
```

## Artifact Labels

| | | | |
| :---- | :---- | :---- | :---- |
| `academic_paper_or_thesis` | `advice_or_recommendation` | `analysis_or_summary` | `app_or_website` |
| `audio_or_music` | `blog_or_article` | `chart_or_visualization` | `code_fix_or_debug` |
| `config_or_infra` | `creative_writing` | `data_or_spreadsheet` | `document_or_report` |
| `educational_material` | `email_or_message` | `explanation_or_answer` | `game_or_interactive` |
| `idea_or_brainstorm` | `image_or_graphic` | `marketing_or_social_content` | `math_or_calculation` |
| `ml_or_ai_system` | `none` | `other` | `plan_or_strategy` |
| `presentation_or_slides` | `recipe_or_meal_plan` | `resume_or_job_application` | `script_or_snippet` |
| `sql_or_database_query` | `translation` | `ui_or_design_mockup` | `video_or_animation` |
