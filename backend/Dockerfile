FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn -r requirements.txt

# FastEmbed normally downloads BM25 on first use. Bake it into the image so a
# memo request never depends on runtime access to Hugging Face.
ENV FASTEMBED_CACHE_DIR=/opt/fastembed-cache \
    FASTEMBED_LOCAL_FILES_ONLY=true
RUN mkdir -p "$FASTEMBED_CACHE_DIR" && \
    python -c "import os; from fastembed import SparseTextEmbedding; list(SparseTextEmbedding(model_name='Qdrant/bm25', cache_dir=os.environ['FASTEMBED_CACHE_DIR']).embed(['warmup']))"

COPY . .

# Run as a non-root user - the process has no need for root privileges once
# dependencies are installed. Reduces blast radius of any RCE vulnerability.
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app "$FASTEMBED_CACHE_DIR"
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
