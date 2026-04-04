from fastapi import BackgroundTasks
from app.core.config import settings


async def send_verification_email(email: str, code: str, background_tasks: BackgroundTasks):
    """
    Send a verification email with a 6-digit code. This function must be called
    with `await` directly in the endpoint — NOT wrapped in background_tasks.add_task().

    It logs the code synchronously and queues SMTP sending as a background task.
    """
    # Always log to console synchronously for debugging
    print("=" * 60)
    print(f"[EMAIL] VERIFICATION CODE FOR {email}")
    print(f"[CODE] {code}")
    print("=" * 60)

    # Only attempt SMTP if credentials are configured
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        print("[WARN] SMTP not configured -- verification code printed to console only.")
        return

    try:
        from fastapi_mail import FastMail, MessageSchema, MessageType, ConnectionConfig

        conf = ConnectionConfig(
            MAIL_USERNAME=settings.SMTP_USER,
            MAIL_PASSWORD=settings.SMTP_PASSWORD,
            MAIL_FROM=settings.EMAIL_FROM or settings.SMTP_USER,
            MAIL_PORT=settings.SMTP_PORT or 587,
            MAIL_SERVER=settings.SMTP_HOST or "smtp.gmail.com",
            MAIL_STARTTLS=True,
            MAIL_SSL_TLS=False,
            USE_CREDENTIALS=True,
            VALIDATE_CERTS=True,
        )

        # Render each digit of the code as an individual styled box
        digit_boxes = "".join(
            f'<span style="display:inline-block;width:48px;height:56px;line-height:56px;text-align:center;font-size:28px;font-weight:700;color:#1e1b4b;background:#f5f3ff;border:2px solid #c4b5fd;border-radius:10px;margin:0 4px;">{d}</span>'
            for d in code
        )

        html_content = f"""
        <div style="font-family: 'Inter', 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #f7f8fc;">
            <div style="background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: #ffffff; font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">LogiPlanner</h1>
                <p style="color: #a5b4fc; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 8px 0 0;">Plans With Logic</p>
            </div>
            <div style="background: #ffffff; padding: 40px 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: 0;">
                <h2 style="color: #1e1b4b; font-size: 20px; margin: 0 0 16px; font-weight: 700;">Verify your email address</h2>
                <p style="color: #4b5563; font-size: 15px; line-height: 1.7; margin: 0 0 24px;">
                    Welcome to LogiPlanner! Enter the 6-digit code below on the verification page to activate your account.
                </p>
                <div style="text-align: center; margin: 8px 0 32px;">
                    {digit_boxes}
                </div>
                <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">This code expires after use. If you didn't request this, you can ignore this email.</p>
            </div>
            <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px;">
                &copy; 2026 LogiPlanner &mdash; Plans With Logic
            </div>
        </div>
        """
  
        message = MessageSchema(
            subject="Verify your LogiPlanner account",
            recipients=[email],
            body=html_content,
            subtype=MessageType.html,
        )

        fm = FastMail(conf)
        # Queue the actual SMTP send as a background task (runs after response)
        background_tasks.add_task(fm.send_message, message)
        print(f"[OK] SMTP email queued for {email}")

    except Exception as e:
        print(f"[ERROR] Failed to queue SMTP email: {e}")
        print("   Verification link was still printed to console above.")
