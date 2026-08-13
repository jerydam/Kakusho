import random
import string
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType
from app.core.config import settings
from app.db.redis_client import set_otp, get_otp, delete_otp, get_attempts, increment_attempts
from loguru import logger

conf = ConnectionConfig(
    MAIL_USERNAME=settings.MAIL_USERNAME,
    MAIL_PASSWORD=settings.MAIL_PASSWORD,
    MAIL_FROM=settings.MAIL_FROM,
    MAIL_PORT=settings.MAIL_PORT,
    MAIL_SERVER=settings.MAIL_SERVER,
    MAIL_STARTTLS=settings.MAIL_TLS,
    MAIL_SSL_TLS=settings.MAIL_SSL,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=True,
)

mail = FastMail(conf)

MAX_OTP_ATTEMPTS = 5


def generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


async def send_otp_email(email: str) -> bool:
    """Generate and email an OTP. Returns True on success."""
    # Rate limit: max 5 OTP requests per hour per email
    attempts = await get_attempts(f"otp_send:{email}")
    if attempts >= MAX_OTP_ATTEMPTS:
        logger.warning(f"OTP rate limit hit for {email}")
        return False

    otp = generate_otp()
    await set_otp(email, otp)
    await increment_attempts(f"otp_send:{email}", window=3600)

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color: #1a1a2e;">KYC Passport — Verify Your Email</h2>
      <p>Use the code below to verify your email address. It expires in 5 minutes.</p>
      <div style="background: #f4f4f4; padding: 24px; border-radius: 8px; text-align: center;">
        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4f46e5;">
          {otp}
        </span>
      </div>
      <p style="color: #888; font-size: 12px; margin-top: 16px;">
        If you didn't request this, ignore this email.
      </p>
    </div>
    """

    message = MessageSchema(
        subject="Your KYC Passport verification code",
        recipients=[email],
        body=html_body,
        subtype=MessageType.html,
    )

    try:
        await mail.send_message(message)
        logger.info(f"OTP sent to {email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send OTP to {email}: {e}")
        return False


async def verify_otp(email: str, otp: str) -> bool:
    """Check OTP. Deletes on success."""
    stored = await get_otp(email)
    if not stored:
        return False
    if stored != otp.strip():
        return False
    await delete_otp(email)
    return True


async def send_kyc_approved_email(email: str, full_name: str) -> None:
    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color: #16a34a;">🎉 KYC Verified!</h2>
      <p>Hi {full_name},</p>
      <p>Your identity has been verified. Your KYC Passport is now active on-chain.</p>
      <p>You can now access all features that require verification.</p>
    </div>
    """
    message = MessageSchema(
        subject="Your KYC Passport is verified ✅",
        recipients=[email],
        body=html_body,
        subtype=MessageType.html,
    )
    try:
        await mail.send_message(message)
    except Exception as e:
        logger.error(f"Failed to send approval email: {e}")


async def send_kyc_rejected_email(email: str, full_name: str, reason: str) -> None:
    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color: #dc2626;">KYC Verification Failed</h2>
      <p>Hi {full_name},</p>
      <p>Unfortunately your KYC verification was rejected.</p>
      <p><strong>Reason:</strong> {reason}</p>
      <p>Please resubmit with clearer documents.</p>
    </div>
    """
    message = MessageSchema(
        subject="Action required — KYC verification rejected",
        recipients=[email],
        body=html_body,
        subtype=MessageType.html,
    )
    try:
        await mail.send_message(message)
    except Exception as e:
        logger.error(f"Failed to send rejection email: {e}")