from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, DateTime, Date, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.user import Base

# Many-to-many: tasks ↔ tagged users
task_tagged_users = Table(
    "task_tagged_users",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("calendar_tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


class CalendarTask(Base):
    __tablename__ = "calendar_tasks"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    task_date = Column(Date, nullable=False, index=True)       
    start_datetime = Column(DateTime(timezone=True), nullable=False)
    end_datetime = Column(DateTime(timezone=True), nullable=False)
    location = Column(String(500), nullable=True)
    color_tag = Column(String(7), nullable=True)               
    priority = Column(String, default="medium")                # low / medium / high
    task_type = Column(String, default="regular")              # meeting / deadline / milestone / regular / action_item
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    team = relationship("Team", backref="calendar_tasks")
    user = relationship("User", backref="calendar_tasks")
    tagged_users = relationship("User", secondary=task_tagged_users, lazy="joined")

    def __repr__(self):
        return f"<CalendarTask {self.title} ({self.start_datetime} → {self.end_datetime})>"
