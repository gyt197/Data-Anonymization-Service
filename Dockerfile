# ─────────────────────────────────────────────
# Data Anonymization Service – Docker Image
# Repo: https://github.com/gyt197/Data-Anonymization-Service
# ─────────────────────────────────────────────

FROM python:3.11-slim

# ---------- system deps ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ---------- clone repo ----------
WORKDIR /app
RUN git clone https://github.com/gyt197/Data-Anonymization-Service.git .

# ---------- Python deps ----------
RUN pip install --no-cache-dir -r requirements-api.txt

RUN pip install --no-cache-dir -r requirements-api.txt
RUN pip install --no-cache-dir sdv
RUN pip install --no-cache-dir python-multipart
RUN python -m spacy download en_core_web_sm

EXPOSE 8000

VOLUME ["/app/raw_data", "/app/results"]

ENV PYTHONPATH="/app:/app/src"
WORKDIR /app/src
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
