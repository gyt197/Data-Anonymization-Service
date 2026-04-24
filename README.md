# Data Anonymization Service

[SDV](https://docs.sdv.dev/sdv) based tabular data anonymization tool with a 4-step workflow:

1. Upload data (CSV / XLS / XLSX)
2. Detect PII
3. Configure rules (`exempt_columns` / `force_pii_columns`)
4. Generate, preview, compare, and download synthetic data in csv format

## Project Structure

- `src/` 
  - `api.py` - FastAPI endpoints
  - `generate_metada.py` - metadata generation and config save
  - `Gaussian_Coupla_syntheticdata_generator.py` - SDV synthetic data pipeline
- `ui/` - frontend page and step scripts 
- `results/` - runtime outputs
  - `uploaded_data/` - uploaded files converted to CSV
  - `meta_data/` - generated metadata and user config
  - `GaussianCopula_results/` - synthetic data, quality reports, scores
- `raw_data/` - optional mounted input folder (Docker use)

## Requirements

- Python 3.9+ 
- Dependencies in `requirements-api.txt`
- spaCy model:
  - `python -m spacy download en_core_web_sm`

## Install through Docker
### 1) Prerequisites
- Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Make sure Docker is running
### 2) Run
```bash
git clone https://github.com/gyt197/Data-Anonymization-Service.git
cd Data-Anonymization-Service
docker compose up --build
```
### 3) Access
```bash
App: http://localhost:8000
```
### 4) Stop
```bash
docker compose down
```

## Install from Github
### 1) Clone the repository
```bash
git clone https://github.com/gyt197/Data-Anonymization-Service.git
```

### 2) Navigate into the project
```bash
cd Data-Anonymization-Service
```

### 3) Create a virtual environment
```bash
python -m venv venv
```

### 4) Activate the virtual environment


#### On Windows
```bash
my-env\Scripts\activate
```

### 5) Install dependencies
```bash

pip install -r requirements-api.txt
pip install sdv python-multipart
python -m spacy download en_core_web_sm

```

### 6) Run the server
```bash
uvicorn src.api:app --host 0.0.0.0 --port 8000 --reload
```
