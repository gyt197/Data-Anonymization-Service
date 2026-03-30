import os
import json
import pandas as pd
from sdv.metadata import Metadata


# ==========================================
# Helper: Get Output Folder
# ==========================================
# Output path relative to project root: results/meta_data
META_DATA_RELATIVE_PATH = os.path.join("results", "meta_data")


def get_output_folder():
    """
    Returns the absolute path to results/meta_data under the project root.
    Metadata JSON files are saved here.
    Structure: .../ProjectRoot/results/meta_data
    """
    current_script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_script_dir)
    output_folder = os.path.join(project_root, META_DATA_RELATIVE_PATH)

    # Create the directory if it does not exist
    os.makedirs(output_folder, exist_ok=True)
    return output_folder


# ==========================================
# Function 1: Generate Metadata
# ==========================================
# Supported file extensions for metadata generation
SUPPORTED_EXTENSIONS = (".csv", ".xls", ".xlsx")


def generate_metadata(inputfile_path: str, table_name: str = None) -> dict:
    """
    Scans a folder for CSV/Excel files, generates SDV Metadata, and saves it as JSON.
    Supports .csv, .xls, .xlsx.
    :param inputfile_path: Path to folder containing data files
    :param table_name: Optional. If provided, only process files matching this table name (without extension).
    Returns a status report dictionary.
    """
    # 1. Get the unified output folder
    output_folder = get_output_folder()

    report = {
        "status": "pending",
        "output_folder": output_folder,
        "successful_files": [],
        "failed_files": [],
        "summary": ""
    }

    # 2. Validate Input Folder
    if not os.path.exists(inputfile_path):
        report["status"] = "error"
        report["summary"] = f"Input folder not found: {inputfile_path}"
        return report

    # 3. Find supported files (.csv, .xls, .xlsx)
    try:
        data_files = [f for f in os.listdir(inputfile_path)
                      if f.lower().endswith(SUPPORTED_EXTENSIONS)]
        if table_name:
            data_files = [f for f in data_files if os.path.splitext(f)[0] == table_name]
    except NotADirectoryError:
        report["status"] = "error"
        report["summary"] = f"Path is not a directory: {inputfile_path}"
        return report

    if not data_files:
        report["status"] = "completed_empty"
        report["summary"] = "No CSV or Excel files found."
        return report

    # 4. Process Each File
    for file in data_files:
        try:
            file_path = os.path.join(inputfile_path, file)
            table_name = os.path.splitext(file)[0]
            ext = os.path.splitext(file)[1].lower()

            # Load Data & Detect Metadata
            if ext == ".csv":
                df = pd.read_csv(file_path)
            else:
                df = pd.read_excel(file_path)
            metadata = Metadata.detect_from_dataframes(data={table_name: df})
            metadata.validate()

            # Save Metadata JSON
            # Naming convention: [tablename]_metadata.json
            save_path = os.path.join(output_folder, f"{table_name}_metadata.json")
            metadata.save_to_json(save_path)

            report["successful_files"].append({
                "file_name": file,
                "saved_path": save_path
            })

        except Exception as e:
            report["failed_files"].append({
                "file_name": file,
                "error_message": str(e)
            })

    # 5. Final Status Update
    if report["failed_files"]:
        report["status"] = "completed_with_errors"
    else:
        report["status"] = "success"

    return report


# ==========================================
# Function 2: Save User Configuration
# ==========================================
def save_user_metadata_config(source_file_path: str, user_config: dict) -> dict:
    """
    Saves the configuration defined by the user in the UI (e.g., exempt columns, forced PII).
    Saves to the same 'results/meta_data' folder as the metadata generation.
    """

    # 1. Use the unified output path logic
    output_dir = get_output_folder()

    try:
        # 2. Generate filename
        # Naming convention: [tablename]_config.json
        base_name = os.path.basename(source_file_path)
        file_name_no_ext = os.path.splitext(base_name)[0]

        json_filename = f"{file_name_no_ext}_config.json"
        save_path = os.path.join(output_dir, json_filename)

        # 3. Write to JSON
        with open(save_path, 'w', encoding='utf-8') as f:
            # ensure_ascii=False ensures special characters are saved correctly
            json.dump(user_config, f, indent=4, ensure_ascii=False)

        return {
            "status": "success",
            "message": "Configuration saved successfully",
            "saved_path": save_path
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to save configuration: {str(e)}",
            "saved_path": None
        }


# ==========================================
# Main Execution / UI Simulation
# ==========================================
if __name__ == "__main__":
    # 1. Simulate the file path uploaded by the user
    file_path_input = r"D:\Pycharm\AnonymizationUI\raw_data\Btc_tower_heating.csv"

    print(f"--- 1. Generating Base Metadata ---")

    # PATH FIX: Extract the folder path from the file path
    # This prevents the "NotADirectoryError" inside generate_metadata
    if os.path.isfile(file_path_input):
        input_folder_for_func = os.path.dirname(file_path_input)
    else:
        input_folder_for_func = file_path_input

    # Execute Metadata Generation
    meta_result = generate_metadata(input_folder_for_func)
    print(f"Status: {meta_result['status']}")
    print(f"Output: {meta_result['output_folder']}")

    print(f"\n--- 2. Saving User Configuration ---")

    # 2. Simulate User Settings from UI
    user_provided_settings = {
        "exempt_columns": ["Date"],  # User wants to keep these original
        "force_pii_columns": ["TIMESTAMP"]  # User forces these to be PII
    }

    # Execute Config Saving
    config_result = save_user_metadata_config(file_path_input, user_provided_settings)

    if config_result['status'] == 'success':
        print(f"✅ Config Saved: {config_result['saved_path']}")
    else:
        print(f"❌ Config Error: {config_result['message']}")

    print("\n--- Final Check ---")
    print(f"Please check the folder: {meta_result['output_folder']}")
    print("It should contain two files:")
    print(f"1. Btc_tower_heating_metadata.json (Auto-generated)")
    print(f"2. Btc_tower_heating_config.json   (User Configuration)")