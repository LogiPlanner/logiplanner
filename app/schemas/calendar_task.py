from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from enum import Enum


class PriorityEnum(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TaskTypeEnum(str, Enum):
    meeting = "meeting"
    deadline = "deadline"
    milestone = "milestone"
    regular = "regular"
    action_item = "action_item"


class TaggedUserOut(BaseModel):
    id: int
    full_name: Optional[str] = None
    email: str

    class Config:
        from_attributes = True


class CalendarTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime
    location: Optional[str] = Field(None, max_length=500)
    color_tag: Optional[str] = Field(None, max_length=7)
    priority: PriorityEnum = PriorityEnum.medium
    task_type: TaskTypeEnum = TaskTypeEnum.regular
    tagged_user_ids: Optional[List[int]] = None


class CalendarTaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=500)
    color_tag: Optional[str] = Field(None, max_length=7)
    priority: Optional[PriorityEnum] = None
    task_type: Optional[TaskTypeEnum] = None
    is_completed: Optional[bool] = None
    tagged_user_ids: Optional[List[int]] = None


class CalendarTaskResponse(BaseModel):
    id: int
    team_id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    description: Optional[str]
    task_date: date
    start_datetime: datetime
    end_datetime: datetime
    location: Optional[str]
    color_tag: Optional[str]
    priority: str
    task_type: str = "regular"
    is_completed: bool
    tagged_users: List[TaggedUserOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


class CalendarTaskList(BaseModel):
    tasks: List[CalendarTaskResponse]


class TeamMemberOut(BaseModel):
    id: int
    full_name: Optional[str] = None
    email: str

    class Config:
        from_attributes = True
