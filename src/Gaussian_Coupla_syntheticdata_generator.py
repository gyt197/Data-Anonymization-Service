import os
import re
import json

import pandas as pd
from sdv.metadata import SingleTableMetadata
from sdv.single_table import GaussianCopulaSynthesizer
from sdv.evaluation.single_table import evaluate_quality


# ==========================================
# 1. Path Management (Path Helpers)
# ==========================================
def get_project_paths():
    """
    Retrieves the project root and absolute paths for all output directories.
    Structure: .../ProjectRoot/results/GaussianCopula_results/...
    """
    current_script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_script_dir)

    config_dir = os.path.join(project_root, "results", "meta_data")
    base_results_dir = os.path.join(project_root, "results", "GaussianCopula_results")

    output_dirs = {
        "config_source": config_dir,
        "synthetic": os.path.join(base_results_dir, "synthetic_data"),
        "reports": os.path.join(base_results_dir, "quality_reports"),
        "scores": os.path.join(base_results_dir, "overall_scores")
    }

    for key, path in output_dirs.items():
        if key != "config_source":
            os.makedirs(path, exist_ok=True)

    return output_dirs


# ==========================================
# 2. Core Logic: Apply User Config
# ==========================================
def apply_user_config_to_metadata(metadata, table_name, config_dir):
    """
    Attempts to read 'results/meta_data/{table_name}_config.json' and
    applies the user's PII rules to the SDV Metadata object.
    """
    config_path = os.path.join(config_dir, f"{table_name}_config.json")

    if not os.path.exists(config_path):
        print(f"   ℹ️ No user config found at {config_path}. Using default detected metadata.")
        return metadata

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)

        print(f"   ⚙️ Found user config! Applying rules...")

        # Map "trimmed" column names from the UI to the real metadata column keys.
        # This avoids mismatches when the CSV headers contain leading/trailing spaces.
        meta_columns = list(metadata.columns.keys())
        stripped_map = {
            str(col).strip(): col
            for col in meta_columns
            if col is not None and str(col).strip() != ""
        }

        def _resolve_col(col_name):
            """Resolve a UI column name to the exact runtime metadata column key."""
            if col_name in metadata.columns:
                return col_name
            if col_name is None:
                return None
            s = str(col_name).strip()
            return stripped_map.get(s)

        force_cols = user_config.get("force_pii_columns", [])
        for col in force_cols:
            resolved = _resolve_col(col)
            if not resolved:
                continue
            print(f"      -> Forcing column '{resolved}' (runtime sdtype=unknown, pii=True)")
            # NOTE: SDV does not support sdtype='pii'. In SDV, PII is expressed via the `pii`
            # flag on columns with sdtype='unknown' (or other sdtypes where `pii=True`).
            metadata.update_column(column_name=resolved, sdtype='unknown', pii=True)

        exempt_cols = user_config.get("exempt_columns", [])
        for col in exempt_cols:
            resolved = _resolve_col(col)
            if not resolved:
                continue
            current_sdtype = metadata.columns.get(resolved, {}).get('sdtype')
            # If SDV detected the column as datetime, relax strict datetime_format validation
            # for exempt columns. We keep sdtype='datetime', but set datetime_format=None
            # so SDV won't enforce a strict format match.
            if current_sdtype == 'datetime':
                print(f"      -> Exempting datetime column '{resolved}' (runtime datetime_format=None)")
                metadata.update_column(column_name=resolved, sdtype='datetime', datetime_format=None)
            else:
                print(f"      -> Exempt column '{resolved}' (runtime sdtype={current_sdtype})")

    except Exception as e:
        print(f"   ⚠️ Warning: Failed to apply user config: {e}")

    return metadata


# ==========================================
# 3. Time Series Helpers
# ==========================================
def _infer_datetime_format(series: pd.Series) -> str:
    """Infer strftime format from sample values. Returns a common format or default."""
    sample = series.dropna().head(5).astype(str)
    if sample.empty:
        return "%Y-%m-%d"
    for val in sample:
        s = str(val).strip()
        if not s:
            continue
        if re.match(r"^\d{4}-\d{2}-\d{2}", s):
            return "%Y-%m-%d"
        if re.match(r"^\d{1,2}/\d{1,2}/\d{4}", s):
            return "%m/%d/%Y"
        if re.match(r"^\d{4}/\d{2}/\d{2}", s):
            return "%Y/%m/%d"
    return "%Y-%m-%d"


def _preserve_exempt_datetime_columns(real_data: pd.DataFrame, synthetic_data: pd.DataFrame,
                                     exempt_cols: list, config_dir: str, table_name: str) -> pd.DataFrame:
    """
    For exempt datetime columns: preserve original values (or same-interval sequence) in synthetic output.
    """
    config_path = os.path.join(config_dir, f"{table_name}_config.json")
    exempt = exempt_cols
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                exempt = json.load(f).get("exempt_columns", exempt)
        except Exception:
            pass

    for col in exempt:
        if col not in real_data.columns or col not in synthetic_data.columns:
            continue
        try:
            if pd.api.types.is_datetime64_any_dtype(real_data[col]):
                synthetic_data[col] = real_data[col].values
            else:
                converted = pd.to_datetime(real_data[col], errors='coerce')
                if converted.notna().any():
                    synthetic_data[col] = real_data[col].values
        except Exception:
            pass
    return synthetic_data


# ==========================================
# 4. Main Process Function
# ==========================================
def generate_synthetic_data_with_config(inputfile_path: str) -> dict:
    """
    1. Load Data
    2. Auto-detect Metadata
    3. Load & Apply User Config (JSON)
    4. Train Model & Generate Data
    5. Evaluate & Save Results
    """

    paths = get_project_paths()

    # Renamed variable to final_report
    final_report = {
        "status": "pending",
        "output_base": os.path.dirname(paths['synthetic']),
        "processed_files": [],
        "errors": []
    }

    # --- Input Path Handling ---
    if not os.path.exists(inputfile_path):
        final_report["status"] = "error"
        final_report["summary"] = f"Input path not found."
        return final_report

    if os.path.isfile(inputfile_path):
        input_dir = os.path.dirname(inputfile_path)
        csv_files = [os.path.basename(inputfile_path)]
    else:
        input_dir = inputfile_path
        csv_files = [f for f in os.listdir(inputfile_path) if f.lower().endswith(".csv")]

    if not csv_files:
        final_report["status"] = "completed_empty"
        return final_report

    print(f"--- Starting Synthesis for {len(csv_files)} files ---")

    # --- Process Each File ---
    for filename in csv_files:
        try:
            full_path = os.path.join(input_dir, filename)
            table_name = os.path.splitext(filename)[0]

            print(f"\nProcessing Table: {table_name}")

            # 1. Load Real Data
            real_data = pd.read_csv(full_path)

            # 2. Initial Metadata Detection
            metadata = SingleTableMetadata()
            metadata.detect_from_dataframe(real_data)

            # 2b. Ensure datetime columns have datetime_format for proper synthesis
            for col in real_data.columns:
                if col not in metadata.columns:
                    continue
                try:
                    # Be conservative: only patch datetime_format for columns that SDV already
                    # marked as sdtype='datetime'. Do not force other columns to datetime,
                    # otherwise SDV will validate them with strict datetime_format and fail.
                    current_sdtype = metadata.columns.get(col, {}).get('sdtype')
                    if current_sdtype != 'datetime':
                        continue

                    existing_fmt = metadata.columns.get(col, {}).get('datetime_format')
                    if existing_fmt:
                        continue  # don't override detected/auto-generated datetime_format

                    fmt = None
                    if pd.api.types.is_datetime64_any_dtype(real_data[col]):
                        fmt = _infer_datetime_format(real_data[col])
                    else:
                        converted = pd.to_datetime(real_data[col], errors='coerce')
                        if converted.notna().any():
                            fmt = _infer_datetime_format(real_data[col].astype(str))

                    if fmt:
                        metadata.update_column(column_name=col, sdtype='datetime', datetime_format=fmt)
                except Exception:
                    pass

            # 3. Apply User Config (exempt_columns, force_pii_columns)
            metadata = apply_user_config_to_metadata(metadata, table_name, paths['config_source'])

            # 4. Train Synthesizer
            print("   🧠 Fitting Synthesizer...")
            synthesizer = GaussianCopulaSynthesizer(metadata)
            synthesizer.fit(data=real_data)

            # 5. Generate Synthetic Data
            print(f"   🎲 Generating {len(real_data)} synthetic rows...")
            synthetic_data = synthesizer.sample(num_rows=len(real_data))

            # 5b. Preserve exempt datetime columns (original values to keep time interval)
            exempt_from_config = []
            config_path = os.path.join(paths['config_source'], f"{table_name}_config.json")
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r', encoding='utf-8') as f:
                        exempt_from_config = json.load(f).get("exempt_columns", [])
                except Exception:
                    pass
            synthetic_data = _preserve_exempt_datetime_columns(
                real_data, synthetic_data, exempt_from_config,
                paths['config_source'], table_name
            )

            # 6. Quality Evaluation
            print("   📊 Evaluating Quality...")
            quality_report = evaluate_quality(real_data, synthetic_data, metadata)
            overall_score = quality_report.get_score()

            # 7. Save Results
            synth_path = os.path.join(paths['synthetic'], f"synthetic_{table_name}.csv")
            synthetic_data.to_csv(synth_path, index=False)

            report_path = os.path.join(paths['reports'], f"report_{table_name}.pkl")
            quality_report.save(report_path)

            score_path = os.path.join(paths['scores'], f"score_{table_name}.csv")
            pd.DataFrame([overall_score], columns=['overall_score']).to_csv(score_path, index=False)

            final_report["processed_files"].append({
                "table": table_name,
                "score": overall_score,
                "saved_synth": synth_path
            })
            print(f"   ✅ Done! Score: {overall_score:.4f}")

        except Exception as e:
            error_msg = f"Failed to process {filename}: {str(e)}"
            final_report["errors"].append(error_msg)
            print(f"   ❌ {error_msg}")

    # --- MODIFIED BLOCK ---
    if final_report["errors"]:
        final_report["status"] = "completed_with_errors"
    else:
        final_report["status"] = "success"

    return final_report


# ==========================================
# Example Execution
# ==========================================
if __name__ == '__main__':
    input_path = r"D:\Pycharm\AnonymizationUI\raw_data\Btc_tower_heating.csv"

    print("=== Start Synthesis Pipeline ===")

    # Variable name changed here as well to match return
    result_report = generate_synthetic_data_with_config(input_path)

    print("\n=== Execution Report ===")
    print(f"Status: {result_report['status']}")

    if result_report['processed_files']:
        print("\nSuccessfully Processed Files:")
        for item in result_report['processed_files']:
            print(f" - {item['table']} (Quality: {item['score']:.4f})")
            print(f"   -> Saved to: {item['saved_synth']}")

    if result_report['errors']:
        print("\nErrors:")
        for err in result_report['errors']:
            print(f" - {err}")