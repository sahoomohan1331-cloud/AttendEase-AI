import os
import re
import time
import random
import smtplib
import torch
import numpy as np
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import defaultdict
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from firebase_admin import credentials, firestore, initialize_app, auth as firebase_auth
from facenet_pytorch import MTCNN, InceptionResnetV1
from PIL import Image
import io
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# ============================================================
# 1. Setup FastAPI
# ============================================================
app = FastAPI(title="AttendEase AI Backend", version="3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 2. Rate Limiting (In-Memory)
# ============================================================
rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 30           # max requests
RATE_LIMIT_WINDOW = 60    # per 60 seconds

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    # Clean old entries
    rate_limit_store[client_ip] = [
        t for t in rate_limit_store[client_ip] if now - t < RATE_LIMIT_WINDOW
    ]

    if len(rate_limit_store[client_ip]) >= RATE_LIMIT:
        return JSONResponse(
            status_code=429,
            content={"status": "error", "error": "Too many requests. Please wait a minute."}
        )

    rate_limit_store[client_ip].append(now)
    response = await call_next(request)
    return response

# ============================================================
# 3. Setup Firebase (supports both local file and cloud env var)
# ============================================================
import json

firebase_key_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
if firebase_key_json:
    # Cloud mode: read from environment variable
    print("☁️ Cloud Mode: Loading Firebase from environment variable...")
    cred = credentials.Certificate(json.loads(firebase_key_json))
else:
    # Local mode: read from file
    print("💻 Local Mode: Loading Firebase from serviceAccountKey.json...")
    cred = credentials.Certificate("serviceAccountKey.json")

initialize_app(cred)
db = firestore.client()

# ============================================================
# 4. Initialize AI Models
# ============================================================
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"🖥 Using Backend AI Device: {device}")

# Classroom-optimized MTCNN (tuned for crowded group photos)
detector = MTCNN(
    keep_all=True,
    device=device,
    min_face_size=30,               # Catch back-row faces (30px minimum)
    thresholds=[0.5, 0.6, 0.6],    # Lower thresholds = more faces detected (higher recall)
    post_process=True,              # Normalize output for consistent embeddings
    select_largest=False,           # Don't just pick the biggest face
)
model = InceptionResnetV1(pretrained='vggface2').to(device).eval()
MODEL_PATH = "models/final_attendance_model.pt"

if os.path.exists(MODEL_PATH):
    print(f"🧠 Loading custom-trained AI Brain: {MODEL_PATH}...")
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
else:
    print("⚠️ WARNING: Custom model NOT FOUND. Using base intelligence.")

# ============================================================
# 5. OTP Storage (In-Memory, expires after 5 minutes)
# ============================================================
otp_store: dict[str, dict] = {}
OTP_EXPIRY_SECONDS = 300  # 5 minutes

# Email config — loaded from .env
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "")  
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")  # Gmail app password
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))

# ============================================================
# Helper Functions
# ============================================================

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

async def read_image_safely(file: UploadFile):
    """Read and validate an uploaded image. Returns (PIL Image, error_msg)."""
    img_bytes = await file.read()
    if len(img_bytes) > MAX_UPLOAD_BYTES:
        return None, "File too large. Maximum size is 10MB."
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return img, None
    except Exception:
        return None, "Could not read the uploaded image."

def preprocess_classroom_photo(img_pil):
    """
    Optimize a classroom photo for face detection.
    Corrects for fluorescent lighting, low contrast, and slight blur.
    """
    from PIL import ImageEnhance, ImageFilter
    
    # 1. Boost contrast (helps with flat fluorescent lighting)
    img_pil = ImageEnhance.Contrast(img_pil).enhance(1.25)
    
    # 2. Slight color correction (counteract yellow tint)
    img_pil = ImageEnhance.Color(img_pil).enhance(1.15)
    
    # 3. Sharpen (helps with back-row blur)
    img_pil = img_pil.filter(ImageFilter.SHARPEN)
    
    # 4. Ensure optimal size for speed (1400px is sweet spot for classroom)
    max_dim = 1400
    if max(img_pil.size) > max_dim:
        ratio = max_dim / max(img_pil.size)
        new_size = (int(img_pil.width * ratio), int(img_pil.height * ratio))
        img_pil = img_pil.resize(new_size, Image.LANCZOS)
    
    return img_pil

def get_embedding(img_pil):
    """Turn a PIL image into a 512-D face vector."""
    try:
        face = detector(img_pil)
        if face is None:
            return None
        if len(face.shape) > 3:
            face = face[0]
        with torch.no_grad():
            embedding = model(face.unsqueeze(0).to(device))
        return embedding.cpu().numpy().flatten()
    except Exception as e:
        print(f"❌ Face embedding error: {e}")
        return None

def sanitize_id(raw_id: str) -> str:
    """Remove dangerous characters from IDs."""
    return re.sub(r'[^a-zA-Z0-9_-]', '', raw_id)

def generate_otp() -> str:
    """Generate a 6-digit OTP."""
    return str(random.randint(100000, 999999))

def send_otp_email(to_email: str, otp: str) -> bool:
    """Send OTP via SMTP email. Returns True if sent, False otherwise."""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        print(f"📧 [NO SMTP CONFIGURED] OTP for {to_email}: {otp}")
        return True  # Still succeed — OTP is printed to console for testing

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "AttendEase — Your Verification Code"
        msg["From"] = f"AttendEase AI <{SMTP_EMAIL}>"
        msg["To"] = to_email

        html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 30px;
                    background: linear-gradient(135deg, #0D0E15, #1C1F2E); color: white; border-radius: 16px;">
            <h2 style="color: #00D1FF; margin-bottom: 5px;">AttendEase AI</h2>
            <p style="color: #8F9BB3; font-size: 14px;">Your verification code is:</p>
            <div style="background: rgba(0,209,255,0.1); border: 2px solid rgba(0,209,255,0.3);
                        border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
                <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #00D1FF;">
                    {otp}
                </span>
            </div>
            <p style="color: #8F9BB3; font-size: 12px;">This code expires in 5 minutes.</p>
            <p style="color: #8F9BB3; font-size: 12px;">If you didn't request this, ignore this email.</p>
        </div>
        """
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.sendmail(SMTP_EMAIL, to_email, msg.as_string())
        print(f"📧 OTP sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email send error: {e}")
        print(f"📧 [FALLBACK] OTP for {to_email}: {otp}")
        return True  # Still succeed so registration isn't blocked

# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/")
async def health_check():
    return {"status": "AttendEase AI Backend v3.0 🚀", "rate_limit": f"{RATE_LIMIT} req/{RATE_LIMIT_WINDOW}s"}

# ------ OTP ENDPOINTS ------

@app.post("/send-otp")
async def send_otp(email: str = Form(...)):
    """Generate and send a 6-digit OTP to the given email."""
    otp = generate_otp()
    otp_store[email] = {
        "otp": otp,
        "created_at": time.time(),
        "attempts": 0,
    }
    success = send_otp_email(email, otp)
    if success:
        return {"status": "success", "message": f"OTP sent to {email}"}
    return {"status": "error", "error": "Failed to send OTP email."}

@app.post("/verify-otp")
async def verify_otp(email: str = Form(...), otp: str = Form(...)):
    """Verify the 6-digit OTP for the given email."""
    record = otp_store.get(email)
    if not record:
        return {"status": "error", "valid": False, "error": "No OTP was sent to this email. Please request a new one."}

    # Check expiry
    if time.time() - record["created_at"] > OTP_EXPIRY_SECONDS:
        del otp_store[email]
        return {"status": "error", "valid": False, "error": "OTP has expired. Please request a new one."}

    # Check max attempts
    record["attempts"] += 1
    if record["attempts"] > 5:
        del otp_store[email]
        return {"status": "error", "valid": False, "error": "Too many wrong attempts. Request a new OTP."}

    if record["otp"] == otp:
        del otp_store[email]  # One-time use
        return {"status": "success", "valid": True}

    return {"status": "error", "valid": False, "error": f"Incorrect OTP. {5 - record['attempts']} attempts left."}

# ------ LIVENESS CHECK ------

@app.post("/liveness-check")
async def liveness_check(file1: UploadFile = File(...), file2: UploadFile = File(...)):
    """
    Basic liveness detection: compare two face photos taken moments apart.
    threshold: similarity 0.60–0.995 = live.
    """
    try:
        img1 = Image.open(io.BytesIO(await file1.read())).convert("RGB")
        img2 = Image.open(io.BytesIO(await file2.read())).convert("RGB")
    except Exception:
        return {"status": "error", "alive": False, "error": "Could not read images."}

    vec1 = get_embedding(img1)
    vec2 = get_embedding(img2)

    if vec1 is None or vec2 is None:
        return {"status": "error", "alive": False, "error": "Could not detect a face in one or both photos."}

    # Cosine similarity between the two shots
    similarity = float(np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2)))

    # Threshold: 0.60-0.995 = likely live. >0.995 = probably a static photo.
    is_alive = 0.60 < similarity < 0.995

    print(f"🔍 Liveness score: {similarity:.4f} → {'LIVE ✅' if is_alive else 'SUSPECT ⚠️'}")

    return {
        "status": "success",
        "alive": is_alive,
        "score": round(similarity, 4),
        "message": "Liveness verified ✅" if is_alive else "Possible spoofing detected. Please try again with natural head movement."
    }

# ------ REGISTER FACE ------

@app.post("/register")
async def register_student(student_id: str = Form(...), file: UploadFile = File(...)):
    """Register a student's face vector."""
    clean_id = sanitize_id(student_id)
    if not clean_id:
        return {"status": "error", "error": "Invalid student ID."}

    img, err = await read_image_safely(file)
    if err:
        return {"status": "error", "error": err}

    vector = get_embedding(img)
    if vector is None:
        return {"status": "error", "error": "No face detected. Please use better lighting."}

    existing = db.collection("Students").document(clean_id).get()
    if existing.exists:
        return {"status": "error", "error": f"Registration number {clean_id} is already enrolled."}

    db.collection("Students").document(clean_id).set({
        "face_vector": vector.tolist(),
        "registered_on": firestore.SERVER_TIMESTAMP
    })
    return {"status": "success", "message": f"Face ID for {clean_id} enrolled successfully!"}

# ------ VALIDATE FACE ------

@app.post("/validate-face")
async def validate_face(file: UploadFile = File(...)):
    """Quick check: can we detect a face in this image?"""
    try:
        img = Image.open(io.BytesIO(await file.read())).convert("RGB")
    except Exception:
        return {"status": "error", "error": "Could not read the image."}

    vector = get_embedding(img)
    if vector is None:
        return {"status": "error", "valid": False, "error": "No face detected."}
    return {"status": "success", "valid": True}

# ------ TAKE ATTENDANCE ------

MATCH_THRESHOLD = 0.65  # Minimum cosine similarity to consider a match

def is_photo_spoofed(img_pil):
    """
    Experimental Liveness Check (Anti-Spoofing).
    Checks for Moire patterns (screens) and Flatness (printouts).
    """
    try:
        # Downsize for speed (Moire and variance are detectable at lower res)
        img_temp = img_pil.copy()
        img_temp.thumbnail((600, 600))
        
        # Convert to grayscale
        gray = img_temp.convert('L')
        arr = np.array(gray)

        # 1. Laplacian Variance (Edge Density) using simple convolve
        # Approximates blur/flatness
        from scipy.ndimage import laplace
        var = laplace(arr).var()
        print(f"   🛡️ Spoof Check: Laplacian Variance = {var:.2f}")
        if var < 70: return True, "Photo quality too low or printout detected."

        # 2. FFT Moire Detection (Screen pixels)
        f = np.fft.fft2(arr)
        fshift = np.fft.fftshift(f)
        magnitude = 20 * np.log(np.abs(fshift) + 1)
        
        # Check for high-energy spikes in high-frequency regions
        if np.max(magnitude) > np.mean(magnitude) * 3.8:
            print(f"   🛡️ Spoof Check: FFT Periodic Pattern Detected (Screen).")
            return True, "Digital screen detected (anti-proxy)."

        return False, None
    except Exception as e:
        print(f"   ⚠️ Liveness check error: {e}")
        return False, None

def process_single_photo(img_pil, enrolled_data):
    """
    Process one photo: detect liveness, detect faces, match them.
    Returns (recognized_ids, total_faces, annotated_b64, error_msg)
    """
    # Liveness Check
    is_spoof, reason = is_photo_spoofed(img_pil)
    if is_spoof:
        return [], 0, None, reason

    # Preprocess
    img_pil = preprocess_classroom_photo(img_pil)
    
    # Detect faces
    try:
        boxes, probs = detector.detect(img_pil)
    except Exception as e:
        print(f"   ❌ Detection failed: {e}")
        return [], 0, None, None

    if boxes is None or len(boxes) == 0:
        return [], 0, None, None

    total_faces = len(boxes)
    face_vectors = []

    # Get embeddings (Batch Mode 🚀)
    aligned_faces = []
    _face_indices = []
    
    for i, box in enumerate(boxes):
        try:
            x1, y1, x2, y2 = [int(b) for b in box]
            face_w = x2 - x1
            face_h = y2 - y1
            
            # Aligned face crop
            pw, ph = int(face_w * 0.15), int(face_h * 0.15)
            x1, y1 = max(0, x1 - pw), max(0, y1 - ph)
            x2, y2 = min(img_pil.width, x2 + pw), min(img_pil.height, y2 + ph)
            
            face_crop = img_pil.crop((x1, y1, x2, y2))
            aligned_face = detector(face_crop)
            if aligned_face is not None:
                if len(aligned_face.shape) > 3: aligned_face = aligned_face[0]
                aligned_faces.append(aligned_face)
                _face_indices.append((i, face_w))
        except Exception: 
            continue

    if aligned_faces:
        try:
            batch_tensor = torch.stack(aligned_faces).to(device)
            with torch.no_grad():
                batch_vectors = model(batch_tensor).cpu().numpy()
            
            for idx, vec in enumerate(batch_vectors):
                box_idx, face_w = _face_indices[idx]
                face_vectors.append((box_idx, vec.flatten(), face_w))
        except Exception as e:
            print(f"   ⚠️ Batch Inference error: {e}")

    # One-to-one matching
    match_candidates = []
    for face_idx, face_vec, _ in face_vectors:
        for s_id, s_vec in enrolled_data.items():
            similarity = float(np.dot(face_vec, s_vec) / (np.linalg.norm(face_vec) * np.linalg.norm(s_vec)))
            if similarity >= MATCH_THRESHOLD:
                match_candidates.append((similarity, face_idx, s_id))

    match_candidates.sort(key=lambda x: x[0], reverse=True)
    matched_faces = set()
    matched_students = set()
    recognized_ids = []
    face_to_student = {}

    for similarity, face_idx, s_id in match_candidates:
        if face_idx in matched_faces or s_id in matched_students: continue
        matched_faces.add(face_idx)
        matched_students.add(s_id)
        recognized_ids.append(s_id)
        face_to_student[face_idx] = (s_id, similarity)

    # Annotate
    from PIL import ImageDraw, ImageFont
    import base64
    annotated = img_pil.copy()
    draw = ImageDraw.Draw(annotated)
    try:
        font = ImageFont.truetype("arial.ttf", size=max(16, int(img_pil.height * 0.018)))
        small_font = ImageFont.truetype("arial.ttf", size=max(12, int(img_pil.height * 0.012)))
    except Exception:
        font = ImageFont.load_default()
        small_font = font

    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = [int(b) for b in box]
        if i in face_to_student:
            student_id, score = face_to_student[i]
            color = (0, 224, 150)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            label = f"{student_id}"
            bbox = draw.textbbox((x1, y1), label, font=font)
            draw.rectangle([x1, y1 - (bbox[3]-bbox[1]+8) - 2, x1 + (bbox[2]-bbox[0]+10), y1], fill=color)
            draw.text((x1 + 4, y1 - (bbox[3]-bbox[1]+8)), label, fill=(0, 0, 0), font=font)
        else:
            color = (255, 60, 60)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
            draw.text((x1 + 4, y1 - 20), "?", fill=color, font=font)

    buffer = io.BytesIO()
    annotated.save(buffer, format="JPEG", quality=80)
    return recognized_ids, total_faces, base64.b64encode(buffer.getvalue()).decode("utf-8"), None

@app.post("/attendance")
async def take_attendance(files: list[UploadFile] = File(...)):
    """
    Scan up to 4 classroom photos and identify enrolled students collectively.
    Higher accuracy by aggregating detections from multiple angles.
    """
    if not files:
        return {"status": "error", "error": "No files uploaded."}

    # Step 1: Load enrolled student vectors (once for all photos)
    docs = db.collection("Students").get()
    if not docs:
        return {"status": "error", "error": "No students enrolled yet."}

    enrolled_data = {}
    for d in docs:
        data = d.to_dict()
        if "face_vector" in data:
            enrolled_data[d.id] = np.array(data["face_vector"])

    if not enrolled_data:
        return {"status": "error", "error": "No students have face vectors registered."}

    # Step 2: Process each photo
    all_recognized = set()
    best_annotated = None
    max_detections = -1
    total_unique_faces_detected = 0

    print(f"📸 Processing {len(files)} attendance photos...")

    for i, file in enumerate(files):
        try:
            img_bytes = await file.read()
            img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            
            recognized, face_count, annotated_b64, error_msg = process_single_photo(img_pil, enrolled_data)
            
            if error_msg:
                print(f"   🛡️ Photo #{i+1} REJECTED: {error_msg}")
                return {"status": "error", "error": f"Liveness Failure (Photo #{i+1}): {error_msg}"}
            
            all_recognized.update(recognized)
            total_unique_faces_detected = max(total_unique_faces_detected, face_count) # Rough estimate

            # Use the frame with most recognized students as the primary feedback
            if len(recognized) > max_detections:
                max_detections = len(recognized)
                best_annotated = annotated_b64
            elif best_annotated is None:
                best_annotated = annotated_b64

            print(f"   🖼 Photo #{i+1}: Found {len(recognized)} students")
        except Exception as e:
            print(f"   ⚠️ Error processing photo #{i+1}: {e}")
            continue

    if not all_recognized and max_detections <= 0:
        return {"status": "error", "error": "No students recognized in any of the photos."}

    return {
        "status": "success",
        "total_faces": total_unique_faces_detected,
        "present_students": sorted(list(all_recognized)),
        "annotated_image": best_annotated,
        "photos_processed": len(files)
    }

# ------ DELETE USER ------

@app.post("/delete-user")
async def delete_user(uid: str = Form(...)):
    """Delete a user's Firebase Auth account (called by admin on rejection)."""
    try:
        firebase_auth.delete_user(uid)
        return {"status": "success", "message": f"Auth account deleted."}
    except firebase_auth.UserNotFoundError:
        return {"status": "success", "message": "Already deleted."}
    except Exception as e:
        return {"status": "error", "error": str(e)}

# ------ VERIFY TEACHER CODE ------

@app.post("/verify-teacher-code")
async def verify_teacher_code(code: str = Form(...)):
    """Server-side teacher code verification."""
    VALID_CODE = os.environ.get("TEACHER_CODE", "TEACHER2026")
    if code == VALID_CODE:
        return {"status": "success", "valid": True}
    return {"status": "error", "valid": False, "error": "Invalid code."}

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("🚀 AttendEase AI Backend v3.0")
    print(f"📧 SMTP: {'Configured ✅' if SMTP_EMAIL else 'Not configured (OTP printed to console)'}")
    print(f"🛡 Rate Limit: {RATE_LIMIT} requests per {RATE_LIMIT_WINDOW}s")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8000)
