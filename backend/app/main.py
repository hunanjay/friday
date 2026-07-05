from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.api import auth, calendar, mail  # noqa: E402  (needs load_dotenv() first)
from app.tools import graph_client  # noqa: E402  (needs load_dotenv() first)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await graph_client.aclose_client()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3005"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(mail.router)
app.include_router(calendar.router)


@app.get("/health")
def health():
    return {"status": "ok"}
