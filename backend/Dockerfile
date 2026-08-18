FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn -r requirements.txt

# FastEmbed normally downloads BM25 on first use — but it's a 92KB stopword/
# config bundle (no model weights), and huggingface.co / hf-mirror.com are
# both unreachable from our China build host (GFW, not a flaky timeout: 5
# retries with IPv4 forced all failed identically). So it's vendored in
# vendor/fastembed-cache instead of fetched at build time — zero network
# dependency, build or runtime. Re-vendor with:
#   .venv/bin/python -c "from fastembed import SparseTextEmbedding; \
#     list(SparseTextEmbedding(model_name='Qdrant/bm25', cache_dir='vendor/fastembed-cache').embed(['x']))"
ENV FASTEMBED_CACHE_DIR=/opt/fastembed-cache \
    FASTEMBED_LOCAL_FILES_ONLY=true
COPY vendor/fastembed-cache "$FASTEMBED_CACHE_DIR"
RUN python -c "import os; from fastembed import SparseTextEmbedding; list(SparseTextEmbedding(model_name='Qdrant/bm25', cache_dir=os.environ['FASTEMBED_CACHE_DIR']).embed(['warmup']))"

COPY . .

# Run as a non-root user - the process has no need for root privileges once
# dependencies are installed. Reduces blast radius of any RCE vulnerability.
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app "$FASTEMBED_CACHE_DIR"
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
