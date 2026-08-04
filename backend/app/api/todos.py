from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_user_id
from app.infrastructure.db.repositories import todos as todos_db

router = APIRouter(prefix="/api/todos", tags=["todos"])


def _todo_fields(body: dict) -> tuple[str, bool, date | None]:
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail="Todo text is required")
    text = text.strip()
    if len(text) > 100:
        raise HTTPException(status_code=422, detail="Todo text must be 100 characters or fewer")

    completed = body.get("completed", False)
    if not isinstance(completed, bool):
        raise HTTPException(status_code=422, detail="completed must be a boolean")

    due_date_value = body.get("dueDate")
    if due_date_value in (None, ""):
        due_date = None
    elif isinstance(due_date_value, str):
        try:
            due_date = date.fromisoformat(due_date_value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="dueDate must use YYYY-MM-DD") from exc
    else:
        raise HTTPException(status_code=422, detail="dueDate must use YYYY-MM-DD")

    return text, completed, due_date


@router.get("")
async def list_todos(user_id: str = Depends(get_user_id)):
    return {"todos": await todos_db.list_todos(user_id)}


@router.post("")
async def create_todo(body: dict, user_id: str = Depends(get_user_id)):
    text, _, due_date = _todo_fields(body)
    return await todos_db.create_todo(user_id, text, due_date)


@router.put("/{todo_id}")
async def update_todo(todo_id: str, body: dict, user_id: str = Depends(get_user_id)):
    text, completed, due_date = _todo_fields(body)
    todo = await todos_db.update_todo(user_id, todo_id, text, completed, due_date)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo


@router.delete("/{todo_id}")
async def delete_todo(todo_id: str, user_id: str = Depends(get_user_id)):
    if not await todos_db.delete_todo(user_id, todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"status": "ok"}
