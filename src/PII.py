from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from presidio_analyzer import AnalyzerEngine

app = Flask(__name__)
CORS(app) # This allows your HTML file to talk to the Python server

# Initialize Presidio
analyzer = AnalyzerEngine()

@app.route('/api/scan', methods=['POST'])
def scan_pii():
    try:
        # Get JSON data sent from Step 2 (payload from Step 1)
        data = request.json
        headers = data.get('headers', [])
        rows = data.get('rows', [])

        # Convert back to DataFrame for processing
        df = pd.DataFrame(rows, columns=headers)
        
        findings = []
        # Your PII Logic
        for col in df.columns:
            # Analyze string columns
            if df[col].dtype == 'object' or df[col].dtype == 'string':
                for idx, value in df[col].items():
                    if pd.isna(value) or not isinstance(value, str):
                        continue
                    
                    # Run Presidio
                    results = analyzer.analyze(text=str(value), language='en')
                    for result in results:
                        findings.append({
                            "row": int(idx),
                            "column": str(col),
                            "value": str(value),
                            "pii_type": result.entity_type,
                            "confidence": float(result.score)
                        })

        # Calculate Summary Stats for the UI
        summary = {
            "total": len(findings),
            "columns": len(set(f['column'] for f in findings)),
            "highConfidence": len([f for f in findings if f['confidence'] >= 0.6])
        }

        return jsonify({
            "summary": summary,
            "details": findings
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Run on port 5000
    app.run(debug=True, port=5000)