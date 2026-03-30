def save_user_metadata_config(source_file_path: str, user_config: dict) -> dict:
    """
    Saves the configuration defined by the user in the UI (e.g., exempt columns, forced PII).
    Saves to the same 'results/meta_data' folder as the metadata generation.
    """

    # 1. Use the unified output path logic
    output_dir = output_folder()

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