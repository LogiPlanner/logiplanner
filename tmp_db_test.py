from dotenv import load_dotenv
from sqlalchemy import create_engine
from app.core.config import settings
import sys

load_dotenv()
print('DATABASE_URL=', settings.DATABASE_URL)
engine = create_engine(settings.DATABASE_URL, echo=False, future=True)
try:
    with engine.connect() as conn:
        print('Connected to DB successfully')
except Exception as e:
    print('Connection failed:', repr(e))
    sys.exit(1)
