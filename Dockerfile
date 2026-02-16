# ═══════════════════════════════════════════════════════════════
#  Sonabe — Jazz GPT Navigator · Hugging Face Spaces Dockerfile
# ═══════════════════════════════════════════════════════════════
#  Build & run:
#    docker build -t sonabe .
#    docker run -p 7860:7860 sonabe
# ═══════════════════════════════════════════════════════════════

FROM python:3.10-slim

# HF Spaces requires port 7860, run as non-root user
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app

# System deps (none heavy needed, but keep layer cache friendly)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

# Python deps — install before copying code for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY server/        server/
COPY client/        client/
COPY models/        models/
COPY data/          data/
COPY run.py         .

# HF Spaces runs as uid 1000
RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 7860

# Start Sonabe on port 7860 (HF Spaces convention)
CMD ["python", "-u", "-c", \
     "from server.app import app, socketio; socketio.run(app, host='0.0.0.0', port=7860, debug=False, use_reloader=False)"]
