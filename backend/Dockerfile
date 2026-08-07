FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY . .

# Run as a non-root user - the process has no need for root privileges once
# dependencies are installed. Reduces blast radius of any RCE vulnerability.
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser /app
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
