from fastapi import BackgroundTasks

from app.core.config import settings


async def send_verification_email(email: str, token: str, background_tasks: BackgroundTasks):
    verification_link = f"{settings.BASE_URL}/verify-email?token={token}&email={email}"

    background_tasks.add_task(
        lambda: print(
            f"\nVERIFICATION EMAIL SENT TO {email}\n"
            f"Click this link to verify:\n{verification_link}\n"
            "(This will become real email in Phase 4 final step)\n"
        )
    )
